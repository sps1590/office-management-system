#!/usr/bin/env node
/**
 * Static column check: does every column the SQL references actually exist in
 * the schema? Catches the class of bug that only shows up when a query runs
 * (payslips.status), including on write paths that are hard to reach by hand.
 *
 * Checks three shapes:
 *   SELECT/WHERE  alias.column, via the alias map built from FROM/JOIN
 *   INSERT INTO t (col, col, …)
 *   UPDATE t SET col = …, col = …
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const SRC = join(ROOT, "src");
const SCHEMA_DIR = join(SRC, "lib", "schema");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(full);
  }
  return out;
}

// --- schema: table -> Set(columns) -----------------------------------------
const tables = new Map();
for (const file of await walk(SCHEMA_DIR)) {
  const text = await readFile(file, "utf8");

  const ct = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\)`/g;
  let m;
  while ((m = ct.exec(text))) {
    const [, table, body] = m;
    const cols = new Set();
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line || line.startsWith("--")) continue;
      if (/^(CONSTRAINT|UNIQUE|PRIMARY KEY|CHECK|FOREIGN KEY)\b/i.test(line)) continue;
      const col = line.split(/\s+/)[0];
      if (/^[a-z_][a-z0-9_]*$/.test(col)) cols.add(col);
    }
    tables.set(table, cols);
  }

  const alter = /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/gi;
  while ((m = alter.exec(text))) {
    if (!tables.has(m[1])) tables.set(m[1], new Set());
    tables.get(m[1]).add(m[2]);
  }
}

// --- scan queries -----------------------------------------------------------
const files = (await walk(SRC)).filter((f) => !f.includes(join("lib", "schema")));
const problems = [];
let statements = 0;

const SKIP_ALIAS = new Set(["excluded", "information_schema", "pg_indexes", "pg_catalog"]);

for (const file of files) {
  const text = await readFile(file, "utf8");
  const re = /\b(?:db|sql)`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(text))) {
    const sql = m[1];
    const line = text.slice(0, m.index).split("\n").length;
    statements += 1;
    if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) continue;

    const flat = sql.replace(/\$\{[^}]*\}/g, "?");

    // alias -> table, from FROM/JOIN clauses
    const aliases = new Map();
    const fj = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z_][a-z0-9_]*)?/gi;
    let a;
    while ((a = fj.exec(flat))) {
      const [, table, alias] = a;
      if (!tables.has(table)) continue;
      aliases.set(table, table);
      if (alias && !/^(on|where|set|group|order|limit|using|left|right|inner|join|as)$/i.test(alias)) {
        aliases.set(alias, table);
      }
    }

    // alias.column references
    const ref = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g;
    let r;
    while ((r = ref.exec(flat))) {
      const [, alias, col] = r;
      if (SKIP_ALIAS.has(alias.toLowerCase())) continue;
      const table = aliases.get(alias);
      if (!table) continue;
      if (!tables.get(table).has(col)) {
        problems.push({ file, line, kind: "select", detail: `${alias}.${col} -> ${table} has no column "${col}"` });
      }
    }

    // INSERT INTO t (cols)
    const ins = /INSERT INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
    while ((a = ins.exec(flat))) {
      const [, table, list] = a;
      if (!tables.has(table)) continue;
      for (const c of list.split(",").map((s) => s.trim().toLowerCase())) {
        if (!/^[a-z_][a-z0-9_]*$/.test(c)) continue;
        if (!tables.get(table).has(c)) {
          problems.push({ file, line, kind: "insert", detail: `INSERT ${table} has no column "${c}"` });
        }
      }
    }

    // UPDATE t SET col = …
    const upd = /UPDATE\s+([a-z_][a-z0-9_]*)[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|$)/gi;
    while ((a = upd.exec(flat))) {
      const [, table, setBody] = a;
      if (!tables.has(table)) continue;
      // Split on commas at paren depth 0 so CASE/function args don't confuse it.
      let depth = 0, cur = "";
      const parts = [];
      for (const ch of setBody) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const col = p.trim().split(/\s*=/)[0].trim().toLowerCase();
        if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;
        if (!tables.get(table).has(col)) {
          problems.push({ file, line, kind: "update", detail: `UPDATE ${table} has no column "${col}"` });
        }
      }
    }
  }
}

console.log(`checked ${statements} statements against ${tables.size} tables`);
if (problems.length === 0) {
  console.log("every referenced column exists. OK");
} else {
  const seen = new Set();
  console.log(`\n${problems.length} problem(s):\n`);
  for (const p of problems) {
    const key = p.detail + p.file + p.line;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${relative(ROOT, p.file)}:${p.line}  [${p.kind}]  ${p.detail}`);
  }
  process.exitCode = 1;
}
