# Testing

The suite runs the product's own `src/lib` modules — the real Server Actions,
the real SQL, the real permission layer — against a **throwaway Neon branch**.
Nothing in `src/` is mocked and no database call is faked.

That is deliberate. Every one of the four defects found on 2026-11-07 had
already been "verified" by reading the code, and one of them (GPS ingest
answering 42P10 to every request) could only ever have been caught by a
statement actually reaching Postgres.

```bash
npm run test:branch:create   # once: create the branch, write .env.test
npm test                     # run the suite
npm run verify               # npm run check && npm test — before a commit
```

---

## Before a commit

```bash
npm run verify
```

That is `npm run check` (the tenancy and column static checks) followed by
`npm test`. CLAUDE.md asks for `check:tenancy` before any commit touching SQL;
`verify` is the one command that does that and runs the suite too.

There is no git hook. Adding one would also run the suite on commits that
touch only a document, and the suite needs network access to Singapore —
`npm run verify` is a deliberate step, not a surprise.

---

## The test database

**The suite must never reach the production branch.** It holds NMCP, a live
tenant with real people's attendance, salaries and locations in it.

Three independent things keep it away, and all three have to fail before a
test could touch real data:

1. **The branch carries no rows.** `scripts/test-branch.mjs` creates it with
   `neon branches create --schema-only`. An ordinary Neon branch is a
   copy-on-write clone and would carry every production row into the test
   database; a schema-only branch carries the 63 tables and nothing else. So
   there is no real company's data present for a test to read or delete.
2. **The suite reads a different variable.** It reads `TEST_DATABASE_URL` from
   `.env.test`, never `DATABASE_URL`, and never loads `.env.local` at all. A
   working connection string cannot be picked up by accident.
3. **The interlock.** Before anything runs, `assertThrowawayDatabase()` in
   `tests/helpers/env.ts` refuses any database that already holds a tenant
   whose slug does not start with `vitest-`. On the production branch that
   tenant is NMCP, and the suite stops before its first write.

The interlock is itself tested (`tests/harness.test.ts`), by planting such a
tenant in the test branch and watching the check refuse.

### Creating it

```bash
npm run test:branch:create
```

Creates a schema-only branch named `test` off `main` in the project named by
`NEON_PROJECT_ID`, then writes `.env.test` with its **direct** (non-pooled)
connection string — Neon's own guidance is that migrations do not go through
the pooler, and this suite applies the schema. If the branch already exists it
is reused rather than recreated.

The schema is applied by the product's own applier: `getDb()` fingerprints the
statement list and runs it when the database does not match. A fresh
schema-only branch has no `schema_state` row, so the full statement list runs
on the first `npm test` (about 14 seconds) and is a single fingerprint query
on every run after that. `SCHEMA_REFRESH=1` forces a re-run.

### Tearing it down

```bash
npm run test:branch:delete
```

Deletes the branch and removes `.env.test`. The script refuses to delete the
project's default branch.

Nothing survives a run even without deleting the branch: every test tenant is
dropped in `afterAll`, and the global teardown sweeps any `vitest-%` tenant
left behind by a crashed run. `ON DELETE CASCADE` takes everything with it, so
the branch is empty between runs.

`npm run test:ci` creates the branch if `.env.test` is missing and then runs
the suite — the form for a clean checkout.

---

## How a test acts as a user

Each test provisions its own company through `provisionTenant`, the same
function registering a company runs. So a test tenant has the real nine role
copies, seventeen accounts, five leave types, six pipeline stages, settings
row and `EMP-00001` admin. That matters: the `EMP-00001` collision and the
geofence dead end were both properties of a *freshly provisioned* tenant, and
a hand-built fixture would have had neither.

`signInAs(userId, tenantId)` writes a real `sessions` row and hands its id to
the `next/headers` stub. `requireUser()` then resolves it exactly as it does
in a request — session row, role join, expanded permission matrix, tenant
timezone.

Three modules are replaced, and only because they cannot exist outside a
request. They are listed with their reasons at the top of `vitest.config.ts`:
`server-only` (empty), `next/headers` (holds one session id), `next/cache`
(no-op), `next/navigation` (`redirect()` throws a `RedirectError` a test can
assert on), `next/dynamic` (placeholder).

---

## What is covered

61 tests in 8 files.

### The four regressions of 2026-11-07

Each was checked by reverting its fix and confirming the test goes red.

| File | Covers | Reverting the fix fails |
|---|---|---|
| `tests/regressions/telemetry-ingest.test.ts` | `ingestPoints` stores a batch, replays idempotently, de-duplicates within a batch, attributes from the token | 6 of 7 tests (42P10) |
| `tests/regressions/geofenced-checkin.test.ts` | `require_geofenced_checkin` defaults FALSE; settings refuses to turn it on with no fence; toggle and delete refuse to remove the last one | 3 tests (column default), 4 tests (the three action guards) |
| `tests/regressions/autoform-checkbox.test.tsx` | `AutoForm`'s checkbox branch renders its `FieldError` | 2 of 5 tests |
| `tests/regressions/coordinate-precision.test.tsx` | `LocationPicker` uses `step="any"`; a 14-decimal paste is accepted and rounded to `NUMERIC(10,7)` | 1 test |

### The invariants most expensive to get wrong

- **Tenant isolation** (`tests/invariants/tenant-isolation.test.ts`, 17 tests).
  Two companies, each with a row in eleven tables. Every list read run as one
  returns none of the other's, checked on the marker in the row rather than on
  a count. Then the detail reads and the geofence write actions, given the
  other company's real row id, come back "not found" rather than obliging.
  And a company admin is refused the platform-wide views.
- **The approval chain's two halves**
  (`tests/invariants/approval-chain.test.ts`, 9 tests). Nobody may decide a
  request they raised, *and* resolution skips a stage landing on the requester
  and falls back to a company admin other than them — for leave and for
  purchase orders. Includes the single-active-user case, which releases the
  order with a `po.auto_approved` audit row, stops doing so the moment a
  second user exists, and refuses to do it at all for a non-admin.
- **Document numbers** (`tests/invariants/doc-numbers.test.ts`, 6 tests). One
  counter per kind, no kind advancing another's, the `employee` sequence
  starting where `provision.ts` left it, and a company adding its first
  employee without colliding with its admin's `EMP-00001`.

---

## What is NOT covered

Read this part. Overstating coverage is the habit that let the four defects
through, and this suite is a floor, not a safety net.

- **No page or route is rendered.** Nothing here would catch a broken page,
  a missing `Suspense` boundary, a hydration error or a layout fault. The 35
  routes returning 200 is still a manual check.
- **No browser, no DOM.** `AutoForm` and `LocationPicker` are rendered to
  static markup with `renderToStaticMarkup`, which runs the first render and
  no effects. That proves the checkbox refusal is *in the markup* and the
  coordinate inputs carry `step="any"`. It does not prove either is visible on
  screen, that `usePreservedForm` restores what someone typed, that the map
  places a pin, or that a browser accepts the paste — the actual browser
  behaviour that `step` controls is asserted on the attribute, not observed.
- **`useActionState` is replaced in the AutoForm test**, so the refusal state
  is injected rather than arriving from a submission. The branch is covered;
  the round trip through React's form handling is not.
- **Six of nine modules have no test of their own.** Payroll, the
  double-entry ledger, invoicing, expense claims, CRM pipeline movement,
  fleet maintenance, room bookings, assets and tasks are reached only
  incidentally, through the isolation test's seed rows. The ledger balancing
  after a posting — checked by hand on 2026-11-05 — is not checked here.
- **No timezone coverage.** The whole `tenants.timezone` discipline in
  CLAUDE.md — `calendarBounds`, `isoDate`, DATE columns staying strings — is
  exercised only in that one tenant is provisioned on `America/Los_Angeles`.
  The day-boundary behaviour verified by hand on 2026-11-06 has no test.
- **No concurrency beyond `nextDocNumber`.** Nothing tests two people acting
  on the same record at once.
- **Nothing runs against the deployed app.** The suite talks to a Neon branch
  from the local machine. Region pinning, cold starts and the telemetry HTTP
  endpoints' own auth and rate limiting are not exercised.
- **`npm run check:tenancy` does not scan `tests/`.** The suite's own SQL is
  not checked for tenant filters. It is test-only code that deletes by a
  tenant's own id.

---

## Adding a test

Put it in `tests/regressions/` if it pins a specific defect, or
`tests/invariants/` if it pins a rule. Then:

- Create your own tenant with `createTestTenant()` and drop it in `afterAll`.
  Never assume a row exists.
- Use unique emails: `users.email` is globally unique across tenants.
  `addUser()` already does this.
- A fixed instant, not `Date.now()` per call, if the test replays anything.
  The first version of the idempotency test here recomputed its timestamps and
  passed whatever `ON CONFLICT` did.
- **Check it fails.** Revert the code it covers and watch it go red. A test
  that cannot fail is worse than no test: it reports safety that is not there.
