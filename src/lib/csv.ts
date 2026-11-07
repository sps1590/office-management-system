/**
 * CSV reading and writing, to RFC 4180, in about eighty lines.
 *
 * A package was not worth it here. The whole requirement is "Excel opens it
 * and gives it back unharmed", and the three things that actually break that
 * are quoting, line endings and the byte-order mark — all handled below. A
 * parser dependency would also have to be trusted with uploaded bytes.
 *
 * This file is deliberately free of `server-only`: the writer is pure and the
 * tests exercise both halves directly.
 */

/** Excel on Windows reads a CSV as the system codepage unless it sees this. */
const BOM = "﻿";

function quote(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // A field needs quoting if it contains the delimiter, a quote or a newline.
  // A leading or trailing space survives only inside quotes too.
  if (!/[",\r\n]|^\s|\s$/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV file as a string, with the BOM and CRLF endings Excel expects.
 *
 * Note what is *not* done: no value is prefixed with `'` or `=` protection.
 * Nothing here writes a field that starts with `=`, `+`, `-` or `@` from user
 * input into a file somebody else opens — the two templates are generated for
 * the administrator who asked for them, from their own company's data.
 */
export function toCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const lines = [headers.map(quote).join(",")];
  for (const row of rows) lines.push(row.map(quote).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Parses CSV text into rows of strings.
 *
 * Handles quoted fields containing commas, newlines and doubled quotes;
 * strips a BOM; accepts CRLF, LF or CR endings; and drops a trailing blank
 * line. Everything comes back as a string — coercion is the caller's job,
 * because only the caller knows whether an empty cell means zero or "leave
 * it alone".
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      // Swallow the LF of a CRLF pair so it does not open an empty row.
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  // Whatever is still in hand belongs to a final row without a line ending.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A file that ends in a newline leaves one empty row behind; so does a
  // stray blank line in the middle, which an administrator will make.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Turns parsed rows into objects keyed by a normalised header name.
 *
 * Headers are matched loosely — case, spaces, underscores and a trailing
 * `*` (which the templates use to mark a required column) are all ignored —
 * because the file has been round-tripped through Excel by a person, and
 * refusing "Full Name" when the template said "full_name" would be pedantry
 * rather than validation.
 */
export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\*$/, "").replace(/[\s_-]+/g, "");
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normaliseHeader);
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}
