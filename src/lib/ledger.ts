import "server-only";
import { getDb } from "./db";

/**
 * Double-entry posting used by every money movement in the system.
 *
 * Accounts are resolved by their stable `key` (see provision.ts), never by
 * name or code, so renaming or renumbering an account cannot break posting.
 * A posting whose debits and credits do not balance is refused rather than
 * written, because an unbalanced journal is unrecoverable by hand later.
 */
export type PostingLine = {
  accountKey: string;
  debit?: number;
  credit?: number;
  memo?: string | null;
};

export async function postJournal(
  tenantId: string,
  entry: {
    date: string;
    description: string;
    source: string;
    sourceId?: string | null;
    createdBy?: string | null;
    lines: PostingLine[];
  }
): Promise<string | null> {
  const db = await getDb();

  const totalDebit = entry.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(
      `Refusing to post an unbalanced entry: debits ${totalDebit}, credits ${totalCredit}`
    );
  }
  if (totalDebit === 0) return null; // nothing to record

  const accountRows = await db`
    SELECT key, id FROM accounts
     WHERE tenant_id = ${tenantId} AND key = ANY(${entry.lines.map((l) => l.accountKey)})
  `;
  const ids = new Map(
    (accountRows as { key: string; id: string }[]).map((r) => [r.key, r.id])
  );
  for (const line of entry.lines) {
    if (!ids.has(line.accountKey)) {
      // A missing account means the chart of accounts was edited away from the
      // keys the code posts to. Surface it rather than silently skipping.
      throw new Error(`Chart of accounts is missing the "${line.accountKey}" account`);
    }
  }

  const inserted = await db`
    INSERT INTO journal_entries (tenant_id, entry_date, description, source, source_id, created_by)
    VALUES (${tenantId}, ${entry.date}, ${entry.description}, ${entry.source},
            ${entry.sourceId ?? null}, ${entry.createdBy ?? null})
    RETURNING id
  `;
  const entryId = (inserted[0] as { id: string }).id;

  for (const line of entry.lines) {
    await db`
      INSERT INTO journal_lines (tenant_id, journal_entry_id, account_id, debit, credit, memo)
      VALUES (${tenantId}, ${entryId}, ${ids.get(line.accountKey)},
              ${line.debit ?? 0}, ${line.credit ?? 0}, ${line.memo ?? null})
    `;
  }
  return entryId;
}

/** Trial balance: one row per account with its net movement. */
export async function trialBalance(tenantId: string, from?: string, to?: string) {
  const db = await getDb();
  const rows = await db`
    SELECT a.id, a.code, a.name, a.type,
           COALESCE(SUM(jl.debit), 0)::float  AS debit,
           COALESCE(SUM(jl.credit), 0)::float AS credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.tenant_id = ${tenantId}
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE a.tenant_id = ${tenantId}
       AND (${from ?? null}::date IS NULL OR je.entry_date >= ${from ?? null}::date)
       AND (${to ?? null}::date IS NULL OR je.entry_date <= ${to ?? null}::date)
     GROUP BY a.id, a.code, a.name, a.type
     ORDER BY a.code
  `;
  return rows as unknown as {
    id: string;
    code: string;
    name: string;
    type: string;
    debit: number;
    credit: number;
  }[];
}

/** Profit and loss for a period, derived from the journal. */
export async function incomeStatement(tenantId: string, from: string, to: string) {
  const db = await getDb();
  const rows = await db`
    SELECT a.type, a.name, a.code,
           COALESCE(SUM(jl.credit - jl.debit), 0)::float AS net
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a         ON a.id = jl.account_id
     WHERE jl.tenant_id = ${tenantId}
       AND a.type IN ('income','expense')
       AND je.entry_date BETWEEN ${from} AND ${to}
     GROUP BY a.type, a.name, a.code
     ORDER BY a.code
  `;
  const lines = rows as unknown as {
    type: string;
    name: string;
    code: string;
    net: number;
  }[];
  const income = lines.filter((l) => l.type === "income").reduce((s, l) => s + l.net, 0);
  // Expense accounts are debit-natured, so their "net credit" is negative.
  const expense = lines
    .filter((l) => l.type === "expense")
    .reduce((s, l) => s - l.net, 0);
  return { lines, income, expense, profit: income - expense };
}

export async function recentJournal(tenantId: string, limit = 40) {
  const db = await getDb();
  const rows = await db`
    SELECT je.id, je.entry_date, je.description, je.source,
           COALESCE(SUM(jl.debit), 0)::float AS amount,
           u.full_name AS created_by_name
      FROM journal_entries je
      LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id
      LEFT JOIN users u          ON u.id = je.created_by
     WHERE je.tenant_id = ${tenantId}
     GROUP BY je.id, je.entry_date, je.description, je.source, u.full_name
     ORDER BY je.entry_date DESC, je.id DESC
     LIMIT ${limit}
  `;
  return rows as unknown as {
    id: string;
    entry_date: string;
    description: string;
    source: string;
    amount: number;
    created_by_name: string | null;
  }[];
}

export async function journalLines(tenantId: string, entryId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT jl.debit::float AS debit, jl.credit::float AS credit, jl.memo,
           a.code, a.name
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
     WHERE jl.tenant_id = ${tenantId} AND jl.journal_entry_id = ${entryId}
     ORDER BY jl.debit DESC
  `;
  return rows as unknown as {
    debit: number;
    credit: number;
    memo: string | null;
    code: string;
    name: string;
  }[];
}

export async function listAccounts(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, code, key, name, type, is_active, sort_order
      FROM accounts WHERE tenant_id = ${tenantId}
     ORDER BY code
  `;
  return rows as unknown as {
    id: string;
    code: string;
    key: string | null;
    name: string;
    type: string;
    is_active: boolean;
    sort_order: number;
  }[];
}
