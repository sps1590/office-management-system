@AGENTS.md

# Office Management System — project instructions

Multi-tenant office management SaaS (Next.js 16 App Router + Postgres via
Neon, deployed on Vercel), built from the SRS in `docs/`.

**Read [PROGRESS.md](PROGRESS.md) first** — it is the living source of truth
for what is built, what is not, and the decisions made with the user.
Update PROGRESS.md's "What's built" table and add a dated
[CHANGELOG.md](CHANGELOG.md) entry whenever you land a feature or schema
change. Update this file too if a convention below changes. Do not let these
drift stale.

## Coding structure

- Server-only data access lives in `src/lib/*.ts` (`db.ts`, `auth.ts`,
  `permissions.ts`, and one module file per feature area). Mutations happen
  only in `src/lib/actions/*.ts`, marked `"use server"`.
- Server Components by default. Add `"use client"` only to interactive leaves
  (forms, map, kanban, command palette, theme toggle) — never to a page that
  merely displays data.
- One round-trip per page: a page calls a single `src/lib` function that runs
  its queries with `Promise.all`. Never issue a query inside a loop; use a
  join, a `GROUP BY`, or `= ANY($1)` instead.
- Aggregates are computed in SQL (`COUNT(*) FILTER (WHERE …)`, `SUM`,
  `GROUP BY`), never by pulling rows into JS and reducing.
- Client forms follow the existing pattern: `useActionState` bound to a server
  action, the shared `SubmitButton`, and the `.card` / `.input` / `.label` /
  `.btn-*` classes from `globals.css`. Do not introduce a second form styling
  approach or a form library.
- **Every uncontrolled form spreads `usePreservedForm(state)` onto its
  `<form>`.** React empties an uncontrolled form once its action completes,
  refusals included, so without it one invalid field discards everything the
  person typed. `AutoForm` already does this, so a screen built on `AutoForm`
  needs nothing.
- **A success message belongs in the toast, a refusal next to the control.**
  An action that succeeds usually changes a record's status, which renders a
  different set of buttons — the control unmounts in the same commit that
  carried its success, so anything rendered from its own state is never seen.
  `ActionButton` already raises successes through `toast()`; a refusal leaves
  the record alone, so it stays inline where it was caused.
- **Time belongs to the tenant, never to the server.** `tenants.timezone`
  decides every wall clock, and it is passed explicitly — `const tz =
  user.tenant.timezone` at the top of a page, exactly as `currency` is.
  `formatDate` / `formatDateTime` / `formatTime` / `isoDate` all require it.
  A `datetime-local` value goes through `zonedToSql()` before it reaches a
  TIMESTAMPTZ; a bare `new Date("…T…")` would read the server's clock.
- **A DATE is a calendar day, not an instant.** It stays a `YYYY-MM-DD`
  string from the driver (`db.ts` sets the parser for OID 1082) all the way
  to the screen, and no zone is ever applied to it. Pushing one through a
  zone is how 09 Nov becomes 08 Nov for a tenant west of the server.
- **Never ask the database what day it is.** `CURRENT_DATE` and `now()::date`
  are the database session's day, which is UTC on Neon — not the company's.
  A counter meaning "today", "this month", "this year" or "overdue" takes its
  boundary from `calendarBounds(timeZone)`: a `YYYY-MM-DD` to compare a DATE
  column, an instant to compare a TIMESTAMPTZ one. A DATE written as "now"
  takes `isoDate(user.tenant.timezone)`. Bucketing a TIMESTAMPTZ by month is
  the one thing that stays in SQL, as
  `date_trunc('month', timezone(${timeZone}, col))`, because which month an
  instant falls in depends on the zone. A rolling window (`now() - INTERVAL
  '15 minutes'`) is a duration and needs no zone — but then do not label it
  "today".
- **A refusal that knows the way out offers it.** When an action can compute
  the alternative it is refusing in favour of — the next free window for a
  double-booked room — it returns `suggestions: [{ label, values }]` and
  `AutoForm` draws them as buttons that fill the named inputs. Do not write a
  message telling someone to work the answer out themselves.
- **A new `nextDocNumber` kind is a new entry in its union, not the nearest
  existing one.** Reusing another kind's sequence silently shares a counter
  and collides with whatever `provision.ts` seeded — that is how every
  company's first employee came to clash with its admin's `EMP-00001`.
- **A latitude and a longitude are picked on a map, not typed.** A form that
  takes a point uses `AutoForm`'s `location` field (`name` is the latitude
  input, `lngName` the longitude, `radiusName` previews a ring) — never a pair
  of bare number inputs, which sends somebody to a mapping site to copy two
  numbers back. Coordinate inputs take `step="any"`: a real paste from Google
  Maps has fourteen decimals, and any other `step` makes the browser refuse
  the correct value. `NUMERIC(10,7)` rounds to about a centimetre on the way
  in, which is the only precision that means anything.
- **`ON CONFLICT` against a partial unique index must repeat the predicate.**
  `location_logs` is unique on `(device_id, log_timestamp) WHERE device_id IS
  NOT NULL`, so the clause reads `ON CONFLICT (device_id, log_timestamp) WHERE
  device_id IS NOT NULL`. Without the `WHERE`, Postgres cannot infer which
  index is meant and raises `42P10` on every call — which is how the whole GPS
  ingest answered 500 from the day it was written until 2026-11-07.
- **Many nullable columns insert better from JSON than from arrays.** A
  multi-row insert normally uses `unnest(...)` of parallel arrays, but a
  Postgres array literal has to spell every null out, while a JSON object just
  omits the key. `jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS
  t(col TYPE, …)` is the safer shape once most columns are optional.
- Validate every new action input with `zod`, in a schema declared next to the
  action. No hand-parsed `FormData`.
- Colours come from the CSS custom properties in `globals.css` and must work
  in both light and dark themes. No hard-coded hex values in components.
- New dependencies need a reason recorded in `docs/PLAN.md`. The brief asked
  for the most optimised design; prefer a few lines of own code over a package.

## Tests

- `npm test` runs `vitest` against a **throwaway Neon branch**, never the
  production one. `npm run test:branch:create` makes it; see
  [docs/TESTING.md](docs/TESTING.md) for the three guards that keep the suite
  off the live database and the full list of what it does not cover.
- **A test that has not been watched to fail is not a test.** Revert the code
  it covers, confirm it goes red, restore. Everything in `tests/regressions/`
  has been through that, and TESTING.md records which reverts fail which
  tests. A test that cannot fail reports safety that is not there, which is
  worse than no test at all.
- **Nothing in `src/` is mocked.** Only the five request-scoped modules that
  cannot exist outside a request are stubbed (`server-only`, `next/headers`,
  `next/cache`, `next/navigation`, `next/dynamic`), and the reason for each is
  at the top of `vitest.config.ts`. Do not reach for a mock of a `src/lib`
  function: if the real one cannot run in a test, that is worth knowing.
- **A test builds its own company through `provisionTenant`**, the function
  real signup runs — never a hand-written fixture. Both `EMP-00001` collisions
  and the geofence dead end were properties of a *freshly provisioned* tenant,
  which a fixture would not have reproduced. `createTestTenant()` in
  `tests/helpers/world.ts` does it; drop the tenant in `afterAll`.
- **A replayed anything needs a fixed instant**, captured once, not
  `Date.now()` per call. The first idempotency test here recomputed its
  timestamps and so was not replaying a batch at all — it would have passed
  whatever `ON CONFLICT` did.
- Do not change product behaviour to make a test pass. If a test uncovers a
  real defect, fix it deliberately and write it up in
  [CHANGELOG.md](CHANGELOG.md).
- Keep TESTING.md's "What is NOT covered" honest and current. Overstating
  coverage is the specific habit that let the four defects of 2026-11-07
  through.

## Hosting

- Functions run in `sin1` (Singapore), beside the Neon database in
  `ap-southeast-1`, pinned by `regions` in `vercel.json`. That file overrides
  the project's dashboard region without changing it, so Vercel's settings
  page still reads `iad1` — the deployment is the truth, and
  `x-vercel-id: <edge>::<function region>::…` proves it on any response. Keep
  the two regions together: splitting them put ~230 ms on every query and was
  the cause of every latency complaint in this project's history.

## Neon tooling

- The `neon` and `neon-postgres` agent skills are vendored in
  `.claude/skills/`. Use them for anything touching Neon itself — project and
  branch creation, connection-string choice, branching workflows, egress and
  autoscaling. They are the vendor's own guidance and outrank general
  Postgres instinct.
- `.mcp.json` registers Neon's hosted MCP server over OAuth. Approve it when
  Claude Code prompts, then authorise in the browser; no API key is stored in
  the repo. Prefer the Neon CLI (`npx neon@latest …`) over the MCP server when
  both can do the job — it covers more, including Functions deploys.
- The skills were vendored by direct fetch with SHA-256 verification against
  `https://neon.com/.well-known/agent-skills`, not by the CLI, so there is no
  `skills-lock.json` and `neon skills status` will not see them. To refresh,
  re-fetch from that registry or let `npx neon@latest skills -s neon -y` take
  over management.

## Security rules

- Every query touching tenant data must filter by `tenant_id` taken from the
  session user (`requireUser()` / `requirePermission()` / `requireCompanyAdmin()`)
  — never from client-submitted form data, a URL param or a request body.
  This is the multi-tenant isolation boundary; getting it wrong leaks one
  company's data to another.
- Every mutating Server Action must re-check permissions itself
  (`requirePermission(module, action)`), even though the UI already hides
  controls the user cannot use. Page-level hiding is UX only, never
  enforcement.
- **Any approval chain must satisfy both halves of the rule, or it dead-ends.**
  Nobody may decide a request they raised — and because of that, resolving an
  approver must *skip* a stage that lands on the requester and fall back to a
  company admin other than them, the way `leave.ts` and
  `submitPurchaseOrderAction` both do. Enforcing only the refusal, without the
  skip, parks the record in `pending` with an approver who is refused the
  moment they click: the shape of the two bugs fixed on 2026-11-05. When no
  approver can exist at all because the company has one active user, release
  the record and write an audit row rather than leaving it unactionable.
- **A credential is never built from `Math.random()`.** Temporary passwords,
  tokens and anything else somebody authenticates with come from
  `generateTempPassword()` or `node:crypto` directly. V8's generator is a
  predictable PRNG, and `createEmployeeAction` shipped temporary passwords
  out of it until 2026-11-07.
- **Nobody resets their own password from an admin screen.** `/me` changes a
  password and demands the current one; `resetUserPasswordAction` does not,
  so it refuses when the target is the caller. Without that, anyone who found
  an unlocked laptop could take the account over permanently, locking out its
  owner. A reset also deletes the target's sessions, because the other reason
  to reset is that the account was already taken.
- Run `npm run verify` (`npm run check` then `npm test`) before every commit.
  `check:tenancy` fails if a query on a tenant-scoped table omits `tenant_id`;
  add a `-- tenancy-ok: <reason>` comment only for a deliberate exception,
  such as the login lookup that happens before any tenant is known.
- Managing users, roles and the permission matrix is restricted to
  `role_key IN ('company_admin')` through `requireCompanyAdmin()` — hard-coded,
  never driven by the configurable permission matrix itself. Letting
  permissions govern access to editing permissions allows privilege escalation.
- Super Admin (the SaaS operator, who can see every tenant at `/platform`) is
  granted only through the `PLATFORM_ADMIN_IDENTIFIERS` env var, never through
  the UI or the permission matrix. Platform-wide queries live only in
  `src/lib/platform.ts` and are reached only via `requirePlatformAdmin()`.
- Suspended tenants (`tenants.status = 'suspended'`) are blocked in
  `requireUser()` and at login. Sign-in and signup are rate limited in
  Postgres (`src/lib/rate-limit.ts`); keep login errors generic so they never
  reveal whether an account exists.
- Passwords are always bcrypt-hashed (`bcryptjs`, cost 10) and never logged,
  returned to a client, or stored anywhere else.
- Telemetry ingest (`/api/telemetry/*`) authenticates with a device token
  whose SHA-256 hash is stored in `device_registrations`. Derive `tenant_id`
  and `user_id` from the token, never from the request body, and rate-limit
  per device.
- All SQL goes through the Neon tagged template (`` sql`...` ``) or
  `sql.query(text)` for schema DDL — never string-concatenate user input into
  a query.
- Schema changes in `src/lib/schema/` must stay idempotent (`CREATE ... IF
  NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` then
  re-add). There is no separate migration runner: the same statement list
  creates a fresh database and migrates the deployed one. It is applied when
  it has *changed* — `db.ts` fingerprints the statements, plans and role
  templates and records that in `schema_state`, so an unchanged schema costs
  one query on a cold start instead of 140-odd round trips. Nothing to bump
  by hand: edit any statement and the fingerprint moves. `SCHEMA_REFRESH=1`
  forces the full run, for a database changed out of band.
