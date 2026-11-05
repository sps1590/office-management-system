"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, isCompanyAdmin, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { postJournal } from "@/lib/ledger";
import { nextDocNumber } from "@/lib/sequence";
import { audit, notify, notifyRoles } from "@/lib/audit";
import { isoDate, zonedToSql } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

const nullable = (max = 200) =>
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

/* --- vendors -------------------------------------------------------------- */

const vendorSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(160),
  contactPerson: nullable(120),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
  phone: nullable(32),
  address: nullable(400),
  category: nullable(80),
  rating: z.coerce.number().min(0).max(5).default(0),
  paymentTerms: nullable(120),
});

export async function createVendorAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("vendors", "create");
  const parsed = vendorSchema.safeParse({
    companyName: formData.get("companyName") ?? "",
    contactPerson: formData.get("contactPerson") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    category: formData.get("category") ?? "",
    rating: formData.get("rating") || 0,
    paymentTerms: formData.get("paymentTerms") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const code = await nextDocNumber(user.tenant_id, "vendor", "VEN");

  await db`
    INSERT INTO vendors (tenant_id, company_name, vendor_code, contact_person, email,
                         phone, address, category, rating, payment_terms, status)
    VALUES (${user.tenant_id}, ${d.companyName}, ${code}, ${d.contactPerson}, ${d.email},
            ${d.phone}, ${d.address}, ${d.category}, ${d.rating}, ${d.paymentTerms}, 'active')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "vendor.created",
    entity: "vendor",
    summary: `Added vendor ${d.companyName}`,
  });
  revalidatePath("/vendors");
  return { success: `${d.companyName} added as ${code}.` };
}

export async function updateVendorAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("vendors", "edit");
  const parsed = z
    .object({
      vendorId: z.string().uuid(),
      rating: z.coerce.number().min(0).max(5),
      status: z.enum(["active", "inactive", "blacklisted"]),
    })
    .safeParse({
      vendorId: formData.get("vendorId"),
      rating: formData.get("rating") || 0,
      status: formData.get("status") || "active",
    });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const updated = await db`
    UPDATE vendors SET rating = ${parsed.data.rating}, status = ${parsed.data.status}
     WHERE id = ${parsed.data.vendorId} AND tenant_id = ${user.tenant_id}
    RETURNING company_name
  `;
  if (updated.length === 0) return { error: "Vendor not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "vendor.updated",
    entity: "vendor",
    entityId: parsed.data.vendorId,
    summary: `Rated ${(updated[0] as { company_name: string }).company_name} ${parsed.data.rating}/5 (${parsed.data.status})`,
  });
  revalidatePath("/vendors");
  return { success: "Vendor updated." };
}

/* --- warehouses and inventory --------------------------------------------- */

export async function createWarehouseAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("inventory", "create");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Name is required").max(120),
      code: nullable(20),
      address: nullable(300),
      latitude: z
        .string()
        .trim()
        .transform((v) => (v === "" ? null : Number(v)))
        .nullable()
        .refine((v) => v === null || (v >= -90 && v <= 90), "Latitude must be between -90 and 90"),
      longitude: z
        .string()
        .trim()
        .transform((v) => (v === "" ? null : Number(v)))
        .nullable()
        .refine(
          (v) => v === null || (v >= -180 && v <= 180),
          "Longitude must be between -180 and 180"
        ),
    })
    .safeParse({
      name: formData.get("name") ?? "",
      code: formData.get("code") ?? "",
      address: formData.get("address") ?? "",
      latitude: formData.get("latitude") ?? "",
      longitude: formData.get("longitude") ?? "",
    });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM warehouses WHERE tenant_id = ${user.tenant_id} AND name = ${d.name}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { name: ["A warehouse with that name already exists."] } };
  }

  await db`
    INSERT INTO warehouses (tenant_id, name, code, address, latitude, longitude)
    VALUES (${user.tenant_id}, ${d.name}, ${d.code}, ${d.address}, ${d.latitude}, ${d.longitude})
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "warehouse.created",
    entity: "warehouse",
    summary: `Added warehouse ${d.name}`,
  });
  revalidatePath("/inventory");
  return { success: `Warehouse "${d.name}" added.` };
}

const itemSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(40),
  itemName: z.string().trim().min(2, "Item name is required").max(160),
  category: nullable(80),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  currentStock: z.coerce.number().min(0).max(100_000_000).default(0),
  reorderLevel: z.coerce.number().min(0).max(100_000_000).default(0),
  reorderQuantity: z.coerce.number().min(0).max(100_000_000).default(0),
  unitCost: z.coerce.number().min(0).max(100_000_000).default(0),
  warehouseId: nullableUuid,
  binLocation: nullable(40),
});

export async function createInventoryItemAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("inventory", "create");
  const parsed = itemSchema.safeParse({
    sku: formData.get("sku") ?? "",
    itemName: formData.get("itemName") ?? "",
    category: formData.get("category") ?? "",
    unit: formData.get("unit") || "pcs",
    currentStock: formData.get("currentStock") || 0,
    reorderLevel: formData.get("reorderLevel") || 0,
    reorderQuantity: formData.get("reorderQuantity") || 0,
    unitCost: formData.get("unitCost") || 0,
    warehouseId: formData.get("warehouseId") ?? "",
    binLocation: formData.get("binLocation") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const clash = await db`
    SELECT 1 FROM inventory_items WHERE tenant_id = ${user.tenant_id} AND sku = ${d.sku}
  `;
  if (clash.length > 0) {
    return { fieldErrors: { sku: ["That SKU already exists."] } };
  }

  const inserted = await db`
    INSERT INTO inventory_items (tenant_id, sku, item_name, category, unit, current_stock,
                                 reorder_level, reorder_quantity, unit_cost, warehouse_id,
                                 bin_location)
    VALUES (${user.tenant_id}, ${d.sku}, ${d.itemName}, ${d.category}, ${d.unit},
            ${d.currentStock}, ${d.reorderLevel}, ${d.reorderQuantity}, ${d.unitCost},
            ${d.warehouseId}, ${d.binLocation})
    RETURNING id
  `;
  const itemId = (inserted[0] as { id: string }).id;

  // Opening stock is recorded as a movement, so the ledger of movements always
  // explains the current balance rather than starting from an unexplained number.
  if (d.currentStock > 0) {
    await db`
      INSERT INTO stock_movements (tenant_id, inventory_item_id, warehouse_id, movement_type,
                                   quantity, unit_cost, reference_type, note, created_by)
      VALUES (${user.tenant_id}, ${itemId}, ${d.warehouseId}, 'in', ${d.currentStock},
              ${d.unitCost}, 'opening', 'Opening balance', ${user.id})
    `;
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "inventory.created",
    entity: "inventory_item",
    entityId: itemId,
    summary: `Added item ${d.itemName} (${d.sku})`,
  });
  revalidatePath("/inventory");
  return { success: `${d.itemName} added.` };
}

const adjustSchema = z.object({
  itemId: z.string().uuid("Choose an item"),
  movementType: z.enum(["in", "out", "adjustment"]),
  quantity: z.coerce.number().positive("Enter a quantity above zero").max(100_000_000),
  batchNumber: nullable(40),
  note: nullable(300),
});

/** Stock in, stock out, or a counted correction. */
export async function adjustStockAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("inventory", "edit");
  const parsed = adjustSchema.safeParse({
    itemId: formData.get("itemId"),
    movementType: formData.get("movementType") || "in",
    quantity: formData.get("quantity"),
    batchNumber: formData.get("batchNumber") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT id, item_name, unit, current_stock::float AS current_stock,
           unit_cost::float AS unit_cost, warehouse_id
      FROM inventory_items
     WHERE id = ${d.itemId} AND tenant_id = ${user.tenant_id}
  `;
  const item = rows[0] as
    | {
        id: string;
        item_name: string;
        unit: string;
        current_stock: number;
        unit_cost: number;
        warehouse_id: string | null;
      }
    | undefined;
  if (!item) return { error: "Item not found." };

  // "adjustment" sets the counted figure; in/out move by the quantity given.
  const newStock =
    d.movementType === "adjustment"
      ? d.quantity
      : d.movementType === "in"
        ? item.current_stock + d.quantity
        : item.current_stock - d.quantity;

  if (newStock < 0) {
    return {
      fieldErrors: {
        quantity: [
          `Only ${item.current_stock} ${item.unit} in stock — issuing ${d.quantity} would go negative.`,
        ],
      },
    };
  }

  await db`
    INSERT INTO stock_movements (tenant_id, inventory_item_id, warehouse_id, movement_type,
                                 quantity, unit_cost, batch_number, note, created_by)
    VALUES (${user.tenant_id}, ${d.itemId}, ${item.warehouse_id}, ${d.movementType},
            ${d.quantity}, ${item.unit_cost}, ${d.batchNumber}, ${d.note}, ${user.id})
  `;
  await db`
    UPDATE inventory_items SET current_stock = ${newStock}
     WHERE id = ${d.itemId} AND tenant_id = ${user.tenant_id}
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "inventory.adjusted",
    entity: "inventory_item",
    entityId: d.itemId,
    summary: `${d.movementType} ${d.quantity} ${item.unit} of ${item.item_name} (now ${newStock})`,
  });
  revalidatePath("/inventory");
  return { success: `${item.item_name} is now ${newStock} ${item.unit}.` };
}

/* --- purchase orders ------------------------------------------------------ */

const poSchema = z.object({
  vendorId: z.string().uuid("Choose a vendor"),
  warehouseId: nullableUuid,
  orderDate: z.string().min(10),
  expectedDate: nullableDate,
  taxAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  shippingAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  terms: nullable(600),
  notes: nullable(600),
});

/**
 * Creates a draft purchase order with its line items.
 *
 * Line inputs arrive as parallel arrays from the repeated rows in the form.
 * Blank rows are dropped, so the buyer can leave spare rows empty.
 */
export async function createPurchaseOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("procurement", "create");
  const parsed = poSchema.safeParse({
    vendorId: formData.get("vendorId"),
    warehouseId: formData.get("warehouseId") ?? "",
    orderDate: formData.get("orderDate") || isoDate(user.tenant.timezone),
    expectedDate: formData.get("expectedDate") ?? "",
    taxAmount: formData.get("taxAmount") || 0,
    shippingAmount: formData.get("shippingAmount") || 0,
    terms: formData.get("terms") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  const vendor = await db`
    SELECT company_name, status FROM vendors
     WHERE id = ${d.vendorId} AND tenant_id = ${user.tenant_id}
  `;
  const v = vendor[0] as { company_name: string; status: string } | undefined;
  if (!v) return { error: "Vendor not found." };
  if (v.status === "blacklisted") {
    return { error: `${v.company_name} is blacklisted and cannot be ordered from.` };
  }

  const descriptions = formData.getAll("itemDescription").map(String);
  const quantities = formData.getAll("itemQuantity").map(String);
  const prices = formData.getAll("itemUnitPrice").map(String);
  const itemIds = formData.getAll("itemInventoryId").map(String);

  const lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    inventoryItemId: string | null;
  }[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i]?.trim();
    const quantity = Number(quantities[i] ?? 0);
    const unitPrice = Number(prices[i] ?? 0);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({
      description: description.slice(0, 300),
      quantity,
      unitPrice: Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0,
      inventoryItemId: /^[0-9a-f-]{36}$/i.test(itemIds[i] ?? "") ? itemIds[i] : null,
    });
  }
  if (lines.length === 0) {
    return { error: "Add at least one line with a description and a quantity." };
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = subtotal + d.taxAmount + d.shippingAmount;
  const poNumber = await nextDocNumber(user.tenant_id, "po", settings.po_prefix);

  // Tiers that apply to this value: every threshold at or below the total.
  const tiers = settings.po_approval_tiers
    .filter((t) => total >= t.amount)
    .sort((a, b) => a.amount - b.amount);
  const totalTiers = Math.max(1, tiers.length);

  const inserted = await db`
    INSERT INTO purchase_orders (tenant_id, po_number, vendor_id, warehouse_id, requested_by,
                                 order_date, expected_date, subtotal, tax_amount,
                                 shipping_amount, total_amount, currency, status,
                                 current_tier, total_tiers, terms, notes)
    VALUES (${user.tenant_id}, ${poNumber}, ${d.vendorId}, ${d.warehouseId}, ${user.id},
            ${d.orderDate}, ${d.expectedDate}, ${subtotal}, ${d.taxAmount},
            ${d.shippingAmount}, ${total}, ${user.tenant.currency}, 'draft',
            1, ${totalTiers}, ${d.terms}, ${d.notes})
    RETURNING id
  `;
  const poId = (inserted[0] as { id: string }).id;

  for (const [i, line] of lines.entries()) {
    await db`
      INSERT INTO purchase_order_items (tenant_id, purchase_order_id, inventory_item_id,
                                        description, quantity, unit_price, line_total, sort_order)
      VALUES (${user.tenant_id}, ${poId}, ${line.inventoryItemId}, ${line.description},
              ${line.quantity}, ${line.unitPrice}, ${line.quantity * line.unitPrice}, ${i})
    `;
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "po.created",
    entity: "purchase_order",
    entityId: poId,
    summary: `Drafted ${poNumber} for ${v.company_name} — ${lines.length} line(s)`,
  });

  revalidatePath("/procurement");
  redirect(`/procurement/${poId}`);
}

/** Moves a draft into the approval chain, creating one row per applicable tier. */
export async function submitPurchaseOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("procurement", "create");
  const poId = String(formData.get("poId") ?? "");
  const db = await getDb();
  const settings = await getSettings(user.tenant_id);

  const rows = await db`
    SELECT id, po_number, status, total_amount::float AS total_amount
      FROM purchase_orders WHERE id = ${poId} AND tenant_id = ${user.tenant_id}
  `;
  const po = rows[0] as
    | { id: string; po_number: string; status: string; total_amount: number }
    | undefined;
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "draft") return { error: "Only a draft can be submitted." };

  const tiers = settings.po_approval_tiers
    .filter((t) => po.total_amount >= t.amount)
    .sort((a, b) => a.amount - b.amount);

  await db`DELETE FROM po_approvals WHERE purchase_order_id = ${poId} AND tenant_id = ${user.tenant_id}`;

  let tierNumber = 0;
  const notified: string[] = [];
  for (const tier of tiers.length > 0 ? tiers : [{ amount: 0, role: "company_admin" }]) {
    const approverRows = await db`
      SELECT u.id FROM users u
        JOIN roles r ON r.id = u.role_id
       WHERE u.tenant_id = ${user.tenant_id} AND u.status = 'active' AND r.key = ${tier.role}
       ORDER BY u.created_at
       LIMIT 1
    `;
    const approverId = (approverRows[0] as { id: string } | undefined)?.id ?? null;
    // Nobody approves the order they raised themselves -- decide() enforces
    // that too, so a tier resolving to the requester would park the order in
    // "pending" with an approver who is refused at the point of clicking.
    // Skip it and let the next tier handle it, as the leave chain does. The
    // common case is the procurement manager, who both raises orders and
    // holds tier 1.
    if (!approverId || approverId === user.id || notified.includes(approverId)) continue;
    tierNumber += 1;
    notified.push(approverId);
    await db`
      INSERT INTO po_approvals (tenant_id, purchase_order_id, approver_id, approver_role,
                                tier, threshold_amount, decision)
      VALUES (${user.tenant_id}, ${poId}, ${approverId}, ${tier.role}, ${tierNumber},
              ${tier.amount}, 'pending')
    `;
  }

  // Every applicable tier resolved to nobody but the requester, which is the
  // normal state of a young company: the default tiers name
  // procurement_manager and finance_manager, and nobody holds those roles
  // until staff are hired. Fall back to a company admin other than the
  // requester, the same "never un-approvable" rule the leave chain applies.
  if (tierNumber === 0) {
    const adminRows = await db`
      SELECT u.id FROM users u
        JOIN roles r ON r.id = u.role_id
       WHERE u.tenant_id = ${user.tenant_id} AND u.status = 'active'
         AND r.key = 'company_admin' AND u.id <> ${user.id}
       ORDER BY u.created_at
       LIMIT 1
    `;
    const fallbackId = (adminRows[0] as { id: string } | undefined)?.id ?? null;
    if (fallbackId) {
      tierNumber = 1;
      notified.push(fallbackId);
      await db`
        INSERT INTO po_approvals (tenant_id, purchase_order_id, approver_id, approver_role,
                                  tier, threshold_amount, decision)
        VALUES (${user.tenant_id}, ${poId}, ${fallbackId}, 'company_admin', 1, 0, 'pending')
      `;
    }
  }

  // There is genuinely nobody else to ask: a company whose only active user is
  // the person raising the order. Approving it on submission is the honest
  // answer -- it grants no power they do not already have, since a company
  // admin can edit the approval tiers and assign themselves any role, and the
  // alternative is an order that can never leave "pending". It is recorded as
  // an unapproved auto-release in the audit log, and stops happening the
  // moment a second user exists.
  if (tierNumber === 0) {
    if (!isCompanyAdmin(user)) {
      return {
        error:
          "No approver could be found for this value. Ask your administrator to assign the approval roles in Company settings.",
      };
    }
    await db`
      UPDATE purchase_orders
         SET status = 'approved', current_tier = 1, total_tiers = 1
       WHERE id = ${poId} AND tenant_id = ${user.tenant_id}
    `;
    await audit({
      tenantId: user.tenant_id,
      userId: user.id,
      action: "po.auto_approved",
      entity: "purchase_order",
      entityId: poId,
      summary: `${po.po_number} released without approval — no other active user could approve it`,
    });
    revalidatePath(`/procurement/${poId}`);
    revalidatePath("/procurement");
    return {
      success:
        "Approved on submission — you are the only active user, so there was nobody else to approve it. Add a second user to get a real approval chain.",
    };
  }

  await db`
    UPDATE purchase_orders
       SET status = 'pending', current_tier = 1, total_tiers = ${tierNumber}
     WHERE id = ${poId} AND tenant_id = ${user.tenant_id}
  `;
  await notify({
    tenantId: user.tenant_id,
    userId: notified[0],
    title: "Purchase order to approve",
    body: `${po.po_number} — ${user.tenant.currency} ${po.total_amount.toLocaleString()} awaits tier 1 of ${tierNumber}.`,
    kind: "approval",
    severity: "high",
    link: `/procurement/${poId}`,
  });
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "po.submitted",
    entity: "purchase_order",
    entityId: poId,
    summary: `Submitted ${po.po_number} for ${tierNumber}-tier approval`,
  });

  revalidatePath(`/procurement/${poId}`);
  revalidatePath("/procurement");
  return { success: `Submitted — ${tierNumber} approval tier(s).` };
}

export async function decidePurchaseOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({
      poId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      comments: nullable(400),
    })
    .safeParse({
      poId: formData.get("poId"),
      decision: formData.get("decision"),
      comments: formData.get("comments") ?? "",
    });
  if (!parsed.success) return { error: "Invalid request." };
  const { poId, decision, comments } = parsed.data;
  const db = await getDb();

  const rows = await db`
    SELECT po.id, po.po_number, po.status, po.current_tier, po.total_tiers,
           po.requested_by, po.total_amount::float AS total_amount,
           v.company_name AS vendor_name
      FROM purchase_orders po
      JOIN vendors v ON v.id = po.vendor_id
     WHERE po.id = ${poId} AND po.tenant_id = ${user.tenant_id}
  `;
  const po = rows[0] as
    | {
        id: string;
        po_number: string;
        status: string;
        current_tier: number;
        total_tiers: number;
        requested_by: string;
        total_amount: number;
        vendor_name: string;
      }
    | undefined;
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "pending") return { error: "That order is not awaiting approval." };

  const tierRows = await db`
    SELECT id, approver_id FROM po_approvals
     WHERE tenant_id = ${user.tenant_id} AND purchase_order_id = ${poId}
       AND tier = ${po.current_tier}
  `;
  const tier = tierRows[0] as { id: string; approver_id: string | null } | undefined;
  if (!tier) return { error: "This order has no pending approval tier." };

  if (tier.approver_id !== user.id && !hasPermission(user, "procurement", "approve")) {
    return { error: "This tier is waiting on someone else." };
  }
  if (po.requested_by === user.id && tier.approver_id !== user.id) {
    return { error: "You cannot approve an order you raised." };
  }

  await db`
    UPDATE po_approvals
       SET decision = ${decision}, comments = ${comments}, decided_at = now(),
           approver_id = ${tier.approver_id ?? user.id}
     WHERE id = ${tier.id} AND tenant_id = ${user.tenant_id}
  `;

  if (decision === "rejected") {
    await db`UPDATE purchase_orders SET status = 'rejected'
              WHERE id = ${poId} AND tenant_id = ${user.tenant_id}`;
    await notify({
      tenantId: user.tenant_id,
      userId: po.requested_by,
      title: "Purchase order declined",
      body: `${po.po_number} was declined${comments ? `: ${comments}` : "."}`,
      severity: "high",
      link: `/procurement/${poId}`,
    });
  } else if (po.current_tier >= po.total_tiers) {
    await db`UPDATE purchase_orders SET status = 'approved'
              WHERE id = ${poId} AND tenant_id = ${user.tenant_id}`;
    await notify({
      tenantId: user.tenant_id,
      userId: po.requested_by,
      title: "Purchase order approved",
      body: `${po.po_number} for ${po.vendor_name} is fully approved.`,
      link: `/procurement/${poId}`,
    });
  } else {
    const next = po.current_tier + 1;
    await db`UPDATE purchase_orders SET current_tier = ${next}
              WHERE id = ${poId} AND tenant_id = ${user.tenant_id}`;
    const nextRows = await db`
      SELECT approver_id FROM po_approvals
       WHERE tenant_id = ${user.tenant_id} AND purchase_order_id = ${poId} AND tier = ${next}
    `;
    const nextApprover = (nextRows[0] as { approver_id: string | null } | undefined)?.approver_id;
    if (nextApprover) {
      await notify({
        tenantId: user.tenant_id,
        userId: nextApprover,
        title: "Purchase order to approve",
        body: `${po.po_number} reached tier ${next} of ${po.total_tiers}.`,
        kind: "approval",
        severity: "high",
        link: `/procurement/${poId}`,
      });
    }
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: `po.${decision}`,
    entity: "purchase_order",
    entityId: poId,
    summary: `${decision === "approved" ? "Approved" : "Declined"} ${po.po_number} at tier ${po.current_tier}/${po.total_tiers}`,
  });

  revalidatePath(`/procurement/${poId}`);
  revalidatePath("/procurement");
  return { success: decision === "approved" ? "Approved." : "Declined." };
}

/**
 * Receives an approved order: adds the goods to stock, records a movement per
 * line, writes the vendor's price history, and posts the payable to the ledger.
 */
export async function receivePurchaseOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("procurement", "edit");
  const poId = String(formData.get("poId") ?? "");
  const db = await getDb();

  const rows = await db`
    SELECT po.id, po.po_number, po.status, po.vendor_id, po.warehouse_id,
           po.total_amount::float AS total_amount, po.subtotal::float AS subtotal
      FROM purchase_orders po
     WHERE po.id = ${poId} AND po.tenant_id = ${user.tenant_id}
  `;
  const po = rows[0] as
    | {
        id: string;
        po_number: string;
        status: string;
        vendor_id: string;
        warehouse_id: string | null;
        total_amount: number;
        subtotal: number;
      }
    | undefined;
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "approved" && po.status !== "partially_received") {
    return { error: "Only an approved order can be received." };
  }

  const items = await db`
    SELECT id, inventory_item_id, description, quantity::float AS quantity,
           received_quantity::float AS received_quantity, unit_price::float AS unit_price
      FROM purchase_order_items
     WHERE tenant_id = ${user.tenant_id} AND purchase_order_id = ${poId}
  `;

  for (const line of items as unknown as {
    id: string;
    inventory_item_id: string | null;
    description: string;
    quantity: number;
    received_quantity: number;
    unit_price: number;
  }[]) {
    const outstanding = line.quantity - line.received_quantity;
    if (outstanding <= 0) continue;

    await db`
      UPDATE purchase_order_items SET received_quantity = quantity
       WHERE id = ${line.id} AND tenant_id = ${user.tenant_id}
    `;

    if (line.inventory_item_id) {
      await db`
        UPDATE inventory_items
           SET current_stock = current_stock + ${outstanding}, unit_cost = ${line.unit_price}
         WHERE id = ${line.inventory_item_id} AND tenant_id = ${user.tenant_id}
      `;
      await db`
        INSERT INTO stock_movements (tenant_id, inventory_item_id, warehouse_id, movement_type,
                                     quantity, unit_cost, reference_type, reference_id,
                                     note, created_by)
        VALUES (${user.tenant_id}, ${line.inventory_item_id}, ${po.warehouse_id}, 'in',
                ${outstanding}, ${line.unit_price}, 'purchase_order', ${poId},
                ${`Received on ${po.po_number}`}, ${user.id})
      `;
    }

    await db`
      INSERT INTO vendor_price_history (tenant_id, vendor_id, inventory_item_id, description,
                                        unit_price, purchase_order_id)
      VALUES (${user.tenant_id}, ${po.vendor_id}, ${line.inventory_item_id},
              ${line.description}, ${line.unit_price}, ${poId})
    `;
  }

  await db`
    UPDATE purchase_orders SET status = 'received', received_date = CURRENT_DATE
     WHERE id = ${poId} AND tenant_id = ${user.tenant_id}
  `;

  // Goods received but not yet paid: inventory up, accounts payable up.
  if (po.total_amount > 0) {
    await postJournal(user.tenant_id, {
      date: isoDate(user.tenant.timezone),
      description: `Goods received — ${po.po_number}`,
      source: "purchase_order",
      sourceId: poId,
      createdBy: user.id,
      lines: [
        { accountKey: "inventory", debit: po.total_amount },
        { accountKey: "accounts_payable", credit: po.total_amount },
      ],
    });
  }

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "po.received",
    entity: "purchase_order",
    entityId: poId,
    summary: `Received ${po.po_number} into stock`,
  });

  revalidatePath(`/procurement/${poId}`);
  revalidatePath("/inventory");
  return { success: "Received into stock and posted to accounts payable." };
}

/* --- logistics ------------------------------------------------------------ */

const routeSchema = z.object({
  reference: nullable(80),
  purchaseOrderId: nullableUuid,
  assignedVehicleId: nullableUuid,
  driverId: nullableUuid,
  originWarehouseId: nullableUuid,
  destination: z.string().trim().min(2, "Destination is required").max(200),
  destinationLat: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (v >= -90 && v <= 90), "Latitude must be between -90 and 90"),
  destinationLng: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (v >= -180 && v <= 180), "Longitude must be between -180 and 180"),
  plannedDeparture: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  plannedArrival: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  notes: nullable(400),
});

export async function createLogisticsRouteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("logistics", "create");
  const parsed = routeSchema.safeParse({
    reference: formData.get("reference") ?? "",
    purchaseOrderId: formData.get("purchaseOrderId") ?? "",
    assignedVehicleId: formData.get("assignedVehicleId") ?? "",
    driverId: formData.get("driverId") ?? "",
    originWarehouseId: formData.get("originWarehouseId") ?? "",
    destination: formData.get("destination") ?? "",
    destinationLat: formData.get("destinationLat") ?? "",
    destinationLng: formData.get("destinationLng") ?? "",
    plannedDeparture: formData.get("plannedDeparture") ?? "",
    plannedArrival: formData.get("plannedArrival") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  await db`
    INSERT INTO logistics_routes (tenant_id, reference, purchase_order_id, assigned_vehicle_id,
                                  driver_id, origin_warehouse_id, destination,
                                  destination_lat, destination_lng, planned_departure,
                                  planned_arrival, notes, status)
    VALUES (${user.tenant_id}, ${d.reference}, ${d.purchaseOrderId}, ${d.assignedVehicleId},
            ${d.driverId}, ${d.originWarehouseId}, ${d.destination},
            ${d.destinationLat}, ${d.destinationLng},
            ${zonedToSql(d.plannedDeparture, user.tenant.timezone)},
            ${zonedToSql(d.plannedArrival, user.tenant.timezone)}, ${d.notes}, 'planned')
  `;
  if (d.driverId) {
    await notify({
      tenantId: user.tenant_id,
      userId: d.driverId,
      title: "Delivery assigned",
      body: `You have a delivery to ${d.destination}.`,
      link: "/logistics",
    });
  }
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "route.created",
    entity: "logistics_route",
    summary: `Planned delivery to ${d.destination}`,
  });
  revalidatePath("/logistics");
  return { success: "Route planned." };
}

export async function setRouteStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("logistics", "edit");
  const parsed = z
    .object({
      routeId: z.string().uuid(),
      status: z.enum(["planned", "in_transit", "delivered", "delayed", "cancelled"]),
    })
    .safeParse({
      routeId: formData.get("routeId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const { routeId, status } = parsed.data;
  const db = await getDb();

  const updated = await db`
    UPDATE logistics_routes
       SET status = ${status},
           actual_departure = CASE WHEN ${status} = 'in_transit' AND actual_departure IS NULL
                                   THEN now() ELSE actual_departure END,
           actual_arrival = CASE WHEN ${status} = 'delivered' THEN now() ELSE actual_arrival END
     WHERE id = ${routeId} AND tenant_id = ${user.tenant_id}
    RETURNING destination
  `;
  if (updated.length === 0) return { error: "Route not found." };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "route.status_changed",
    entity: "logistics_route",
    entityId: routeId,
    summary: `Delivery to ${(updated[0] as { destination: string }).destination} set to ${status}`,
  });
  revalidatePath("/logistics");
  return { success: `Marked ${status.replace(/_/g, " ")}.` };
}
