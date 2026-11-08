import "server-only";

/*
   Deleting master data.

   Almost every foreign key in this schema is `ON DELETE CASCADE`, which is
   the right answer for referential integrity and the wrong one for a
   business rule: deleting a vehicle would take its bookings, trips and
   maintenance history with it, silently, because the database was told to
   tidy up rather than to object. So a delete action counts what points at
   the row first and refuses while anything does.

   The rule the product follows: a record with no history is a mistake and
   can be removed; a record with history is a fact and is retired instead —
   deactivated, marked inactive, or left alone. Employees are the strongest
   case and have no delete at all; see `setUserStatusAction`.
*/

export type Dependency = { n: number; label: string };

/**
 * The refusal, or null when nothing is in the way.
 *
 * `label` is singular: "booking", "invoice", "leave request". The plural is
 * added here so twenty call sites do not each get it slightly wrong.
 */
export function stillInUse(
  dependencies: Dependency[],
  alternative = "Retire it instead if it is no longer in use."
): string | null {
  const blocking = dependencies.filter((d) => d.n > 0);
  if (blocking.length === 0) return null;
  const list = blocking
    .map((d) => `${d.n} ${d.label}${d.n === 1 ? "" : "s"}`)
    .join(", ");
  return `This cannot be deleted while ${list} still ${
    blocking.length === 1 && blocking[0].n === 1 ? "refers" : "refer"
  } to it — removing it would take that history with it. ${alternative}`;
}

/** `COUNT(*)` from a one-row result, as the guards above want it. */
export function countOf(rows: unknown[]): number {
  return Number((rows[0] as { n: number | string } | undefined)?.n ?? 0);
}
