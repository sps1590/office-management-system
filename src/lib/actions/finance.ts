"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { postJournal } from "@/lib/ledger";
import { nextDocNumber } from "@/lib/sequence";
import { audit, notify, notifyRoles } from "@/lib/audit";
import { isoDate } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

const nullable = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const nullableUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

const nullableDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

/* --- receivables ---------------------------------------------------------- */

const invoiceSchema = z.object({
  clientId: nullableUuid,
  dealId: nullableUuid,
  issueDate: z.string().min(10),
  dueDate: nullableDate,
  taxAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  discountAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  notes: nullable(600),
});

/**
 * Raises an invoice and posts it to the ledger immediately: receivable up,
 * sales revenue up. Payments received against it are posted separately when
 * the money arrives, which keeps revenue recognition and cash apart.
 */
export async function createInvoiceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("invoicing", "create");
  const parsed = invoiceSchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    dealId: formData.get("dealId") ?? "",
    issueDate: formData.get("issueDate") || isoDate(),
    dueDate: formData.get("dueDate") ?? "",
    taxAmount: formData.get("taxAmount") || 0,
    discountAmount: formData.get("discountAmount") || 0,
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  const descriptions = formData.getAll("lineDescription").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const prices = formData.getAll("lineUnitPrice").map(String);

  const lines: { description: string; quantity: number; unitPrice: number }[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i]?.trim();
    const quantity = Number(quantities[i] ?? 0);
    const unitPrice = Number(prices[i] ?? 0);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({
      description: description.slice(0, 300),
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0,
    });
  }
  if (lines.length === 0) {
    return { error: "Add at least one line with a description and a quantity." };
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal + d.taxAmount - d.discountAmount);
  const number = await nextDocNumber(user.tenant_id, "invoice", settings.invoice_prefix);

  const inserted = await db`
    INSERT INTO invoices (tenant_id, invoice_number, client_id, deal_id, issue_date, due_date,
                          subtotal, tax_amount, discount_amount, total_amount, currency,
                          status, notes, created_by)
    VALUES (${user.tenant_id}, ${number}, ${d.clientId}, ${d.dealId}, ${d.issueDate},
            ${d.dueDate}, ${subtotal}, ${d.taxAmount}, ${d.discountAmount}, ${total},
            ${user.tenant.currency}, 'sent', ${d.notes}, ${user.id})
    RETURNING id
  `;
  const invoiceId = (inserted[0] as { id: string }).id;

  for (const [i, line] of lines.entries()) {
    await db`
      INSERT INTO invoice_items (tenant_id, invoice_id, description, quantity, unit_price,
                                 line_total, sort_order)
      VALUES (${user.tenant_id}, ${invoiceId}, ${line.description}, ${line.quantity},
              ${line.unitPrice}, ${line.quantity * line.unitPrice}, ${i})
    `;
  }

  if (total > 0) {
    await postJournal(user.tenant_id, {
      date: d.issueDate,
      description: `Invoice ${number}`,
      source: "invoice",
      sourceId: invoiceId,
      createdBy: user.id,
      lines: [
        { accountKey: "accounts_receivable", debit: total },
        { accountKey: "sales_income", credit: total },
      ],
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "invoice.created",
    entity: "invoice",
    entityId: invoiceId,
    summary: `Raised invoice ${number} for ${user.tenant.currency} ${total.toLocaleString()}`,
  });

  revalidatePath("/invoices");
  return { success: `Invoice ${number} raised and posted to receivables.` };
}

/* --- payables ------------------------------------------------------------- */

const billSchema = z.object({
  vendorId: nullableUuid,
  purchaseOrderId: nullableUuid,
  billNumber: nullable(60),
  issueDate: z.string().min(10),
  dueDate: nullableDate,
  subtotal: z.coerce.number().min(0).max(1_000_000_000),
  taxAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  notes: nullable(600),
});

export async function createBillAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("invoicing", "create");
  const parsed = billSchema.safeParse({
    vendorId: formData.get("vendorId") ?? "",
    purchaseOrderId: formData.get("purchaseOrderId") ?? "",
    billNumber: formData.get("billNumber") ?? "",
    issueDate: formData.get("issueDate") || isoDate(),
    dueDate: formData.get("dueDate") ?? "",
    subtotal: formData.get("subtotal") || 0,
    taxAmount: formData.get("taxAmount") || 0,
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  if (d.subtotal <= 0) {
    return { fieldErrors: { subtotal: ["Enter the bill amount."] } };
  }
  const db = await getDb();
  const total = d.subtotal + d.taxAmount;
  const number = d.billNumber ?? (await nextDocNumber(user.tenant_id, "bill", "BILL"));

  const clash = await db`
    SELECT 1 FROM bills WHERE tenant_id = ${user.tenant_id} AND bill_number = ${number}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { billNumber: ["A bill with that number already exists."] } };
  }

  const inserted = await db`
    INSERT INTO bills (tenant_id, bill_number, vendor_id, purchase_order_id, issue_date,
                       due_date, subtotal, tax_amount, total_amount, status, notes)
    VALUES (${user.tenant_id}, ${number}, ${d.vendorId}, ${d.purchaseOrderId}, ${d.issueDate},
            ${d.dueDate}, ${d.subtotal}, ${d.taxAmount}, ${total}, 'pending', ${d.notes})
    RETURNING id
  `;
  const billId = (inserted[0] as { id: string }).id;

  // A bill raised outside the purchase-order flow has not been posted yet, so
  // recognise the expense here. One linked to a received PO is already in the
  // ledger as inventory/payable, so posting again would double-count it.
  if (!d.purchaseOrderId && total > 0) {
    await postJournal(user.tenant_id, {
      date: d.issueDate,
      description: `Bill ${number}`,
      source: "bill",
      sourceId: billId,
      createdBy: user.id,
      lines: [
        { accountKey: "operating_expenses", debit: total },
        { accountKey: "accounts_payable", credit: total },
      ],
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "bill.created",
    entity: "bill",
    entityId: billId,
    summary: `Recorded bill ${number}`,
  });
  revalidatePath("/bills");
  return { success: `Bill ${number} recorded.` };
}

/* --- payments ------------------------------------------------------------- */

const paymentSchema = z.object({
  direction: z.enum(["in", "out"]),
  invoiceId: nullableUuid,
  billId: nullableUuid,
  amount: z.coerce.number().positive("Enter an amount above zero").max(1_000_000_000),
  method: z.enum(["cash", "bank", "cheque", "mobile", "card", "other"]),
  paidOn: z.string().min(10),
  reference: nullable(120),
  note: nullable(300),
});

/**
 * Records money in or out and updates the document it settles. Over-payment is
 * refused rather than silently accepted, because a negative outstanding
 * balance is almost always a typing error.
 */
export async function recordPaymentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("invoicing", "create");
  const parsed = paymentSchema.safeParse({
    direction: formData.get("direction") || "in",
    invoiceId: formData.get("invoiceId") ?? "",
    billId: formData.get("billId") ?? "",
    amount: formData.get("amount"),
    method: formData.get("method") || "bank",
    paidOn: formData.get("paidOn") || isoDate(),
    reference: formData.get("reference") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  if (d.direction === "in" && !d.invoiceId) {
    return { error: "Choose the invoice this receipt settles." };
  }
  if (d.direction === "out" && !d.billId) {
    return { error: "Choose the bill this payment settles." };
  }

  let docLabel = "";
  if (d.direction === "in") {
    const rows = await db`
      SELECT invoice_number, total_amount::float AS total, amount_paid::float AS paid
        FROM invoices WHERE id = ${d.invoiceId} AND tenant_id = ${user.tenant_id}
    `;
    const inv = rows[0] as
      | { invoice_number: string; total: number; paid: number }
      | undefined;
    if (!inv) return { error: "Invoice not found." };
    const outstanding = inv.total - inv.paid;
    if (d.amount > outstanding + 0.005) {
      return {
        fieldErrors: {
          amount: [`Only ${outstanding.toFixed(2)} is outstanding on ${inv.invoice_number}.`],
        },
      };
    }
    const newPaid = inv.paid + d.amount;
    await db`
      UPDATE invoices
         SET amount_paid = ${newPaid},
             status = ${newPaid >= inv.total - 0.005 ? "paid" : "partially_paid"}
       WHERE id = ${d.invoiceId} AND tenant_id = ${user.tenant_id}
    `;
    docLabel = inv.invoice_number;
  } else {
    const rows = await db`
      SELECT bill_number, total_amount::float AS total, amount_paid::float AS paid
        FROM bills WHERE id = ${d.billId} AND tenant_id = ${user.tenant_id}
    `;
    const bill = rows[0] as { bill_number: string; total: number; paid: number } | undefined;
    if (!bill) return { error: "Bill not found." };
    const outstanding = bill.total - bill.paid;
    if (d.amount > outstanding + 0.005) {
      return {
        fieldErrors: {
          amount: [`Only ${outstanding.toFixed(2)} is outstanding on ${bill.bill_number}.`],
        },
      };
    }
    const newPaid = bill.paid + d.amount;
    await db`
      UPDATE bills
         SET amount_paid = ${newPaid},
             status = ${newPaid >= bill.total - 0.005 ? "paid" : "partially_paid"}
       WHERE id = ${d.billId} AND tenant_id = ${user.tenant_id}
    `;
    docLabel = bill.bill_number;
  }

  await db`
    INSERT INTO payments (tenant_id, direction, invoice_id, bill_id, amount, method,
                          paid_on, reference, note, created_by)
    VALUES (${user.tenant_id}, ${d.direction}, ${d.invoiceId}, ${d.billId}, ${d.amount},
            ${d.method}, ${d.paidOn}, ${d.reference}, ${d.note}, ${user.id})
  `;

  await postJournal(user.tenant_id, {
    date: d.paidOn,
    description:
      d.direction === "in" ? `Receipt against ${docLabel}` : `Payment of ${docLabel}`,
    source: "payment",
    createdBy: user.id,
    lines:
      d.direction === "in"
        ? [
            { accountKey: "cash", debit: d.amount },
            { accountKey: "accounts_receivable", credit: d.amount },
          ]
        : [
            { accountKey: "accounts_payable", debit: d.amount },
            { accountKey: "cash", credit: d.amount },
          ],
  });

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `payment.${d.direction}`,
    entity: "payment",
    summary: `${d.direction === "in" ? "Received" : "Paid"} ${user.tenant.currency} ${d.amount.toLocaleString()} on ${docLabel}`,
  });

  revalidatePath("/invoices");
  revalidatePath("/bills");
  revalidatePath("/finance");
  return { success: "Payment recorded and posted." };
}

/* --- expense claims ------------------------------------------------------- */

const claimSchema = z.object({
  category: z.string().trim().min(2, "Pick a category").max(60),
  amount: z.coerce.number().positive("Enter an amount above zero").max(100_000_000),
  expenseDate: z.string().min(10),
  description: nullable(600),
});

export async function createExpenseClaimAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!hasPermission(user, "expenses", "create")) {
    return { error: "You do not have permission to submit a claim." };
  }
  const parsed = claimSchema.safeParse({
    category: formData.get("category") || "other",
    amount: formData.get("amount"),
    expenseDate: formData.get("expenseDate") || isoDate(),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const lat = Number(formData.get("latitude") ?? NaN);
  const lng = Number(formData.get("longitude") ?? NaN);
  const db = await getDb();
  const number = await nextDocNumber(user.tenant_id, "expense", "EXP");

  const inserted = await db`
    INSERT INTO expense_claims (tenant_id, user_id, claim_number, category, amount,
                                expense_date, description, latitude, longitude, status)
    VALUES (${user.tenant_id}, ${user.id}, ${number}, ${d.category}, ${d.amount},
            ${d.expenseDate}, ${d.description},
            ${Number.isFinite(lat) ? lat : null}, ${Number.isFinite(lng) ? lng : null},
            'pending')
    RETURNING id
  `;

  await notifyRoles(user.tenant_id, ["finance_manager", "company_admin"], {
    title: "Expense claim to verify",
    body: `${user.full_name} claimed ${user.tenant.currency} ${d.amount.toLocaleString()} for ${d.category}.`,
    kind: "approval",
    link: "/expenses",
    entity: "expense_claim",
    entityId: (inserted[0] as { id: string }).id,
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "expense.submitted",
    entity: "expense_claim",
    summary: `Submitted claim ${number} for ${d.category}`,
  });

  revalidatePath("/expenses");
  return { success: `Claim ${number} submitted for verification.` };
}

/**
 * Finance verifies a claim. Approval recognises the expense against payables;
 * reimbursement moves it out of payables into cash. Two steps, because a
 * company approves long before it pays.
 */
export async function decideExpenseClaimAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("expenses", "approve");
  const parsed = z
    .object({
      claimId: z.string().uuid(),
      decision: z.enum(["approved", "rejected", "reimbursed"]),
      comments: nullable(400),
    })
    .safeParse({
      claimId: formData.get("claimId"),
      decision: formData.get("decision"),
      comments: formData.get("comments") ?? "",
    });
  if (!parsed.success) return { error: "Invalid request." };
  const { claimId, decision, comments } = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT e.id, e.status, e.user_id, e.amount::float AS amount, e.category,
           e.claim_number, u.full_name
      FROM expense_claims e
      JOIN users u ON u.id = e.user_id
     WHERE e.id = ${claimId} AND e.tenant_id = ${user.tenant_id}
  `;
  const claim = rows[0] as
    | {
        id: string;
        status: string;
        user_id: string;
        amount: number;
        category: string;
        claim_number: string | null;
        full_name: string;
      }
    | undefined;
  if (!claim) return { error: "Claim not found." };
  if (claim.user_id === user.id) {
    return { error: "You cannot verify your own expense claim." };
  }

  const allowed: Record<string, string[]> = {
    pending: ["approved", "rejected"],
    approved: ["reimbursed"],
    rejected: [],
    reimbursed: [],
  };
  if (!allowed[claim.status]?.includes(decision)) {
    return { error: `A ${claim.status} claim cannot be set to ${decision}.` };
  }

  await db`
    UPDATE expense_claims
       SET status = ${decision}, approver_id = ${user.id}, comments = ${comments},
           decided_at = now(),
           reimbursed_on = ${decision === "reimbursed" ? isoDate() : null}
     WHERE id = ${claimId} AND tenant_id = ${user.tenant_id}
  `;

  if (decision === "approved") {
    await postJournal(user.tenant_id, {
      date: isoDate(),
      description: `Expense claim ${claim.claim_number ?? ""} — ${claim.category}`,
      source: "expense_claim",
      sourceId: claimId,
      createdBy: user.id,
      lines: [
        { accountKey: "reimbursement_expense", debit: claim.amount, memo: claim.full_name },
        { accountKey: "accounts_payable", credit: claim.amount },
      ],
    });
  } else if (decision === "reimbursed") {
    await postJournal(user.tenant_id, {
      date: isoDate(),
      description: `Reimbursed ${claim.full_name} — ${claim.claim_number ?? claim.category}`,
      source: "expense_claim",
      sourceId: claimId,
      createdBy: user.id,
      lines: [
        { accountKey: "accounts_payable", debit: claim.amount },
        { accountKey: "cash", credit: claim.amount },
      ],
    });
  }

  await notify({
    tenantId: user.tenant_id,
    userId: claim.user_id,
    title: `Expense claim ${decision}`,
    body: `${claim.claim_number ?? claim.category}: ${decision}${comments ? ` — ${comments}` : "."}`,
    link: "/expenses",
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `expense.${decision}`,
    entity: "expense_claim",
    entityId: claimId,
    summary: `${decision} ${claim.full_name}'s claim for ${claim.category}`,
  });

  revalidatePath("/expenses");
  return { success: `Claim ${decision}.` };
}

/* --- manual journal ------------------------------------------------------- */

const journalSchema = z.object({
  entryDate: z.string().min(10),
  description: z.string().trim().min(3, "Describe the entry").max(300),
  debitAccountId: z.string().uuid("Choose the account to debit"),
  creditAccountId: z.string().uuid("Choose the account to credit"),
  amount: z.coerce.number().positive("Enter an amount above zero").max(1_000_000_000),
  memo: nullable(300),
});

/** A simple two-sided manual entry, for anything the modules do not post. */
export async function createJournalEntryAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("finance", "create");
  const parsed = journalSchema.safeParse({
    entryDate: formData.get("entryDate") || isoDate(),
    description: formData.get("description") ?? "",
    debitAccountId: formData.get("debitAccountId"),
    creditAccountId: formData.get("creditAccountId"),
    amount: formData.get("amount"),
    memo: formData.get("memo") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  if (d.debitAccountId === d.creditAccountId) {
    return { error: "The debit and credit accounts must be different." };
  }
  const db = await getDb();

  const accounts = await db`
    SELECT id FROM accounts
     WHERE tenant_id = ${user.tenant_id}
       AND id = ANY(${[d.debitAccountId, d.creditAccountId]})
  `;
  if (accounts.length !== 2) return { error: "One of those accounts does not exist." };

  const inserted = await db`
    INSERT INTO journal_entries (tenant_id, entry_date, description, source, created_by)
    VALUES (${user.tenant_id}, ${d.entryDate}, ${d.description}, 'manual', ${user.id})
    RETURNING id
  `;
  const entryId = (inserted[0] as { id: string }).id;

  await db`
    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, memo)
    VALUES (${user.tenant_id}, ${entryId}, ${d.debitAccountId}, ${d.amount}, 0, ${d.memo})
  `;
  await db`
    INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, memo)
    VALUES (${user.tenant_id}, ${entryId}, ${d.creditAccountId}, 0, ${d.amount}, ${d.memo})
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "journal.created",
    entity: "journal_entry",
    entityId: entryId,
    summary: `Manual entry: ${d.description}`,
  });
  revalidatePath("/finance");
  return { success: "Journal entry posted." };
}
