# PROGRESS — Office Management System (OMS)

**The living source of truth for this repository.** Read this first. Anyone
(human or agent) picking the project up should be able to tell from this file
alone what exists, what does not, and why decisions were made.

- Requirements: [docs/SRS.md](docs/SRS.md) (generated from the Word SRS in
  `docs/`) — authoritative.
- Plan and scope boundaries: [docs/PLAN.md](docs/PLAN.md).
- Database reference: [docs/DATABASE.md](docs/DATABASE.md) (generated).
- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Mobile / GPS scope: [docs/MOBILE.md](docs/MOBILE.md).
- Tests — how to run them, and what they do not cover:
  [docs/TESTING.md](docs/TESTING.md).
- Dated history of changes: [CHANGELOG.md](CHANGELOG.md).
- Conventions an agent must follow: [CLAUDE.md](CLAUDE.md).

Last updated: **2026-11-07**

---

## Current state

| Phase | Area | Status |
|---|---|---|
| 0 | Foundation: folder, docs, scaffold, Tailwind tokens | **Done** |
| 1 | Data core, identity, RBAC | **Done** |
| 2 | App shell and design system | **Done** |
| 3 | HR, attendance, leave, payroll | **Done** |
| 4 | Fleet and vehicle management | **Done** |
| 5 | Procurement and supply chain | **Done** |
| 6 | Sales, CRM, field operations | **Done** |
| 7 | Finance, facilities, tasks | **Done** |
| 8 | IT/MIS, GPS engine, governance | **Done** |
| 9 | Ship: GitHub, Neon, Vercel | **Done** — database live, project deployed |
| 10 | Automated tests | **Started 2026-11-07** — 154 tests, the known defects, three invariants, bulk import, the timesheet, the leave calendar and the password-reset flow; most of the product still uncovered |

`npm run build` is clean. `npm run check` reports **394 SQL statements across
128 files, 61 of 65 tables tenant-scoped, every tenant-scoped query filtering
by `tenant_id`**, and **every referenced column existing in the schema**.
`npm test` runs **154 tests in 14 files** against a throwaway Neon branch, green
in ~50 s. `npm run verify` is both, and is the command to run before a commit.

### Exercised on the running product, 2026-11-07

A throwaway company was registered and driven through the UI rather than read.
It found four defects, all now fixed and re-tested: telemetry ingest answered
500 to every request (a partial unique index that `ON CONFLICT` could not
infer), a new company could not check anybody in (the geofence requirement
defaulted on with no geofence to satisfy it), a coordinate pasted from a
mapping site was refused by `step="0.0000001"`, and a refusal aimed at a
checkbox was never rendered. All 34 static signed-in routes returned 200 with no
error boundary (the four `[id]` routes need a record to address).
**The live map was seen with data on it for the first time** — eight
ingested points, a person marker, the fence circle and the four
counters. The tenant was deleted afterwards; NMCP has 2 users and no stray
rows.

### Swept in a browser, signed out, 2026-11-07

The deployed site was driven from Chrome with no session. All 34 protected
routes redirect to `/login`; the telemetry endpoints answer 401 to a missing
or invalid token and 405 to a `GET`; the console is silent on every public
page; and `/api/telemetry/enroll`, which accepts a password, shares the web
sign-in's rate-limit bucket rather than bypassing it. Three real findings
came out of it, all fixed the same day: no response carried any security
header (see [CHANGELOG.md](CHANGELOG.md)); the signup form's full-name
placeholder was a real person's name; and — found by being locked out of
NMCP while trying to sign in for the rest of the sweep — the product had no
password reset of any kind.

### Swept in a browser, signed in, 2026-11-07

The same deployment was then driven from Chrome as NMCP's company admin,
read-only: nothing was created, changed or deleted in the tenant.

All 34 static signed-in routes answer 200 with no error marker, between
170 ms and 680 ms. An employee page and its edit form answer 200; an id that
belongs to nobody answers 404, not 500, and discloses nothing.
`/payroll/[id]` and `/procurement/[id]` are still unexercised because no
payslip or purchase order exists yet to address. Eight protected routes
answer 307 to `/login` with the cookie withheld, and the telemetry endpoints
still answer 401 to an absent or unknown device token.

The console stayed silent across every page — no errors, no warnings, no
hydration mismatch. That silence was itself verified: a deliberate
`console.log` was planted and read back, so an empty console means an empty
console and not a detached reader. The only third-party host the browser
contacts is `tile.openstreetmap.org`, and Nominatim when somebody searches
for a place.

The interactive leaves were exercised. Clicking the geofence map fills
`centerLat` / `centerLng` with seven decimals under `step="any"`; the place
search resolved "Banani, Dhaka" and recentred the map with its radius ring.
The command palette opens on Ctrl+K and filters. The theme toggle cycles
system → light → dark, and dark survives navigation with no flash, because
the server renders it. Layout holds from 1294 px down to 375 px with no
horizontal scroll anywhere: wide tables scroll inside `.table-wrap` instead
of breaking the page. List filters, empty states and a `' OR 1=1--` search
term all behave — the last returns nothing, because the tagged template
parameterised it.

The headers added earlier the same day are live, confirmed on production:
`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
`nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, the
`Permissions-Policy` allow-list, HSTS for two years with `preload`, and no
`X-Powered-By`. `x-vercel-id: bom1::sin1::…` confirms the function still runs
in Singapore beside the database. A dashboard load is 49 ms to first byte and
591 ms to `load`, transferring 14 KB.

One finding, unfixed and awaiting a decision: `/me` headlines **"Leave
remaining 146.0"**, which sums every leave type — and 112 of those days are
maternity leave. The number is honest (its own caption says "across 5 leave
types") but it is not the number anybody means when they ask how much leave
they have left, and it will read the same way for every employee in the
company.

### Verified against the live database, 2026-11-06

Counters were read twice from one throwaway tenant seeded with rows that
straddle a day boundary, without changing a row between reads: once with the
company on `America/Los_Angeles`, where it was still 05 Nov, and once on
`Asia/Dhaka`, where it was already the 6th. Overdue invoices went BDT 500 →
1,500, overdue bills BDT 0 → 700, overdue tasks 0 → 1, vehicle documents
expiring 0 → 1, deals won this month BDT 1K → 10K, and on-leave-today 1 → 0.
All 17 pages touched returned 200 in both zones. The tenant was deleted
afterwards; NMCP was not read or written.

### Verified against the live database, 2026-11-05

The schema has now executed against real Postgres: **62 tables, 158 indexes,
157 foreign keys, 521 check constraints**, 10 role templates and 3 subscription
plans seeded. A test company was registered end to end — provisioning wrote 9
role copies, 17 accounts, 5 leave types, 6 pipeline stages, a department, a
settings row, a subscription and the admin user with a bcrypt hash — then
deleted, confirming `ON DELETE CASCADE` cleans up completely and leaves the
platform role templates intact.

Deployed to production at
`https://office-management-system-sps-a983.vercel.app` (Ready in 36s). The
landing page and the telemetry API both verified there through
`npx vercel curl` — the serverless function reaches Neon and answers
correctly. **Vercel Deployment Protection is still ON**, so the public cannot
reach it yet; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the one setting
to change.

All 34 signed-in routes return 200 against live data. One real bug surfaced and
was fixed: `payslips` was missing the `status` and `paid_at` columns that
`payroll.ts` selected and the payroll action updated. `scripts/check-columns.mjs`
was added to catch that class of error statically, and reports clean across all
343 statements.

### Every write path executed, 2026-11-05

**70 mutations across all nine modules ran against live Postgres** through the
real Server Actions, in three seats — 59 as the company admin, 6 as an
employee, and 5 back as the admin approving what the employee raised — so
every approval chain was exercised in both directions. **The double-entry
ledger balanced after every posting**: 175,545.45 on each side over 14
auto-posted lines, then 280,945.45 on each side over 22 lines once the
approvals had posted.

That run found and fixed **two purchase-order dead ends**, both detailed in
[CHANGELOG.md](CHANGELOG.md): a new company could not submit any order below
500,000, and an order raised by the procurement manager could never be
approved by anyone. Neither was reachable by reading code or running the
build — both needed the SQL and the approval resolution to actually execute.

### Clicked through in a browser, 2026-11-05

The whole app was then driven through a real browser against a real company —
register, employee, vendor, client, deal, room, booking, and a two-line
purchase order from draft to received — which found **six defects above the
action layer** that neither the build, the static checks nor the write-path
harness could see. All six are fixed and listed in
[CHANGELOG.md](CHANGELOG.md); the two that mattered most were that **no
company could add its first employee** (an employee code drawn from the wrong
sequence collided with the admin's, and the unique violation crashed the page
rather than reporting itself) and that **every form emptied itself when a
submission was refused** (React resets an uncontrolled form after its action,
and nothing fed the values back).

One defect is documented but deliberately **not** fixed: times are written as
UTC from a `datetime-local` field and rendered in the server's zone rather
than the tenant's. See the changelog entry — it spans every timestamp in the
app and is its own piece of work.

### Verified on the deployed app, 2026-11-05

The fixes above were then re-tested in Chrome against the live Vercel
deployment, not only locally: a refused registration keeps what was typed,
and the first employee can be added. The smoke tenant was deleted afterwards.
That run surfaced the cross-region latency problem recorded under
"Known gaps and risks".

## What's built

**Foundation**
- 64-table Postgres schema in `src/lib/schema/`, one ordered list of idempotent
  statements that both creates a fresh database and migrates a deployed one on
  cold start. 69 reviewed indexes. UUID primary keys, per the SRS.
- `docs/DATABASE.md` generated from that schema (`npm run docs:schema`), and
  `docs/SRS.md` generated from the Word brief (`npm run docs:srs`), so neither
  document can drift.
- `scripts/check-tenancy.mjs`: derives the tenant-scoped table list from the
  schema and fails the build if a query omits `tenant_id`.
- **Neon agent tooling** (added 2026-11-04): the `neon` and `neon-postgres`
  agent skills are vendored into `.claude/skills/`, and `.mcp.json` registers
  Neon's hosted MCP server at `https://mcp.neon.tech/mcp` over OAuth — URL
  only, no credential in the repo. See the CHANGELOG entry for how to refresh
  them and which of Neon's eight skills were deliberately left out.

**Identity and access**
- Cookie sessions with bcrypt (cost 10), Postgres-backed rate limiting on
  sign-in and signup, generic login errors, suspended-tenant lockout that also
  revokes live sessions.
- Ten SRS roles seeded as editable per-tenant permission matrices
  (23 modules × 5 actions). Role and permission editing hard-coded to the
  company admin; Super Admin only from `PLATFORM_ADMIN_IDENTIFIERS`.
- Company registration provisions roles, chart of accounts, leave types, sales
  pipeline, settings and approval tiers in one step.

**Modules** — every one has list, create, filter and the lifecycle actions:
- **HR**: directory with full profiles and salary structure, departments,
  geo-fenced check-in/out with the fence decision made server side, 8-hour and
  overtime computation from tenant settings, HR manual entry, configurable
  multi-stage leave approval with entitlement enforcement, payroll generation
  from attendance with approve-then-pay posting to the ledger.
- **Working patterns and the timesheet** (added 2026-11-07): the company's
  working week is set by ticking days on the settings screen, and named
  *shifts* override it for the people assigned to one — start, end, unpaid
  break, working days and an optional grace period, with a shift that crosses
  midnight counted as its real length. The attendance formula reads the
  person's shift for lateness, overtime and half-day, falling back to the
  company default when they have none. `/me` now shows a real monthly
  timesheet built from the calendar rather than from the records, so a day
  somebody never checked in appears as an absence instead of not appearing at
  all; rest days, public holidays and approved leave expect nothing, and days
  still to come are excluded from the totals.
- **Bulk import** (added 2026-11-07): `/employees` downloads a CSV template
  pre-filled with the company's own first department, role and shift, and
  takes it back filled in — up to 200 rows, matching department, role and
  shift by name and the line manager by email, resolved in a second pass so a
  manager listed further down the same file still links. `/leave` downloads
  an allotment sheet already carrying every active employee and every leave
  category with their current entitlement; a blank cell on the way back means
  "leave this category alone", which is not the same as a zero. Both report
  bad rows by the spreadsheet's own line number and write the good ones
  anyway. New accounts' temporary passwords are shown once and downloadable
  as a CSV, never stored in readable form.
- **Forgotten passwords** (added 2026-11-08): sign-in carries a *Forgot
  password?* link. `/forgot-password` emails a one-hour, single-use link
  whose SHA-256 alone is stored; `/reset-password` takes the new password
  and ends every other session that account had open. The form answers the
  same whether or not the address exists, is rate limited per address and
  per IP, and issuing a link invalidates the previous one. It needs an email
  provider configured to deliver anything — see "What's not built".
- **Leave calendar** (added 2026-11-08): `/leave` draws the month with the
  face of every person whose leave covers each day — initials where there is
  no photo, a ring in the leave category's colour, pending requests faded
  with an amber dot. Clicking a face opens the detail (department,
  designation, code, category, span, reason, approval stage) with no second
  query; clicking a day number opens that day's whole roster. Public holidays
  and the company's rest days are drawn, and the grid starts on the company's
  own first working day. Above it, a short table of who is away *today*, how
  many departments carry the gap, and the first day each person is back. The
  whole section sits behind the same permission as "All leave requests", so
  an ordinary employee still sees only their own.
- **Fleet**: registry with document-expiry warnings, requisition workflow
  (request → approve → start → close with odometer and fuel), maintenance
  schedule, running-cost chart. Trip closure updates the odometer and posts
  fuel and tolls.
- **Supply chain**: vendors with rating and blacklist, warehouses, inventory
  with reorder alerts and an append-only movement ledger, purchase orders with
  line items and value-threshold approval tiers, receipt into stock that writes
  vendor price history and posts accounts payable, logistics routes.
- **CRM and field**: clients with coordinates, pipeline kanban that closes a
  deal when it reaches a won or lost stage, activity log, weighted forecast,
  GPS-verified field visits that store the distance from the client's address.
- **Finance**: double-entry ledger with auto-posting from payroll, purchase
  receipts, invoices, payments, trip costs and expense claims; trial balance
  and profit-and-loss derived from the journal; multi-line invoices,
  purchase-order-aware bills, receipts and payments, expense claims with a
  two-step approve-then-reimburse treatment, manual journal entry.
- **Time**: every wall clock is stored and rendered through
  `tenants.timezone`, chosen from the IANA list in Settings and taken from the
  browser at registration; DATE columns stay zone-free calendar days. Every
  counter that means "today", "this month" or "overdue" is measured against
  the company's own calendar via `calendarBounds()`, not the database's UTC
  day, and a date written as "now" is the company's day.
- **Workplace**: meeting rooms whose overlap refusal names the clash and
  offers the room's next free windows as one-click alternatives, visitor register
  that notifies the host, asset register with chain-of-custody history,
  projects and tasks with GPS-stamped completion.
- **IT/MIS and GPS**: executive dashboard with an operational-bottleneck list,
  live operations map (Leaflet + OpenStreetMap, no API key) with route
  playback, device enrolment and revocation, circular geofences with
  assignment, enter/exit/deviation events with manager notifications,
  retention purge, audit log viewer, cross-module reports.
- **Telemetry API**: `POST /api/telemetry/enroll` and
  `POST /api/telemetry/locations` — batched, backdated, idempotent on
  (device, timestamp), rate limited per device, tenant and user derived from a
  hashed device token. `/tracker` PWA streams to the same endpoint.
- **Platform console** at `/platform`: every tenant, user counts, telemetry
  volume, suspend/reactivate, subscription plans.

**UI**
- Tailwind v4 design tokens with light/dark/system theming resolved before
  first paint. Collapsible grouped sidebar built from the user's permissions,
  command palette, notification centre, mobile drawer.
- Charts are hand-written inline SVG rendered on the server — area, bar, row
  bars, donut, sparkline — with native `<title>` tooltips and no client JS.
- One spec-driven `AutoForm` behind the straightforward CRUD screens, so
  validation, alerts, spacing and pending states cannot drift between modules.

**Tests** — [docs/TESTING.md](docs/TESTING.md)
- 154 `vitest` tests in 14 files running the real `src/lib` modules against a
  throwaway Neon branch. Nothing in `src/` is mocked; no database call is
  faked. Five request-scoped modules are stubbed because they cannot exist
  outside a request, and the reason for each is at the top of
  `vitest.config.ts`.
- `scripts/test-branch.mjs` creates and deletes that branch with the Neon CLI,
  `--schema-only` so it carries the schema and none of production's rows.
  Three independent guards keep the suite off the live database, and the
  interlock that refuses a database holding somebody else's tenant is itself
  tested.
- The four defects of 2026-11-07, each confirmed by reverting its fix and
  watching the test go red; tenant isolation across eleven tables and both
  write paths; both halves of the approval chain including the
  single-active-user release; and the document-number sequences.
- `npm run verify` = `npm run check && npm test`, the one command before a
  commit. Most of the product is still uncovered — see the risk note below,
  which says which parts.

## What's not built

- **Native MDM mobile app** — specified in [docs/MOBILE.md](docs/MOBILE.md),
  not built. The server half is complete and the PWA tracker works, but it
  reports only while its page is open. This was flagged before any code was
  written; see [docs/PLAN.md](docs/PLAN.md#explicit-scope-boundary--read-before-sign-off).
- **Email delivery is built but switched off.** `src/lib/email.ts` sends
  over Resend's HTTPS API, and the forgotten-password flow uses it — but it
  does nothing until `RESEND_API_KEY` and `EMAIL_FROM` are set on the Vercel
  project, with `APP_URL` beside them so reset links are not built from the
  request's `Host` header. Until then the form says so plainly instead of
  promising a link that will never arrive, and a company admin resets
  anybody else's password from `/users`. Delivering to arbitrary employees
  also needs a domain verified with the provider; the provider's own test
  sender only reaches the account owner. One case is still uncovered either
  way: a *sole* company admin who loses their own password with no mail
  configured needs the operator to reach the database. A second admin
  account avoids it entirely.
- **SMS delivery.** Notification rows are written and shown in the in-app
  notification centre; nothing sends a text.
- **Payment gateway.** Plans and subscriptions are modelled; nothing bills.
- **Polygon geofence editor.** The schema and the evaluation engine handle
  polygons; the UI creates circles only. The new map picker places a point,
  not a shape.
- **Attachment uploads.** Expense receipts and avatars have URL columns but no
  upload pipeline (Vercel Blob would be the natural fit).

## Decisions made with the user

| Date | Decision |
|---|---|
| 2026-11-04 | Repository is `https://github.com/sps1590/office-management-system` (user created it empty; we push to it). |
| 2026-11-04 | Database and Vercel to be set up as automatically as possible. Both turned out to need one browser sign-in each; everything after that is scripted in `docs/DEPLOYMENT.md`. |
| 2026-11-04 | Stack mirrors the user's proven farm-manager stack: Next.js 16 App Router, Neon over the serverless HTTP driver, Server Actions, own cookie session auth with bcrypt, Tailwind v4 tokens. No ORM, no auth library. |
| 2026-11-04 | UUID primary keys, because SRS section 4 specifies them. |
| 2026-11-04 | Hand-written SVG charts and a thin own Leaflet wrapper instead of a chart library and `react-leaflet` — the brief asked for the most optimised design. Eight runtime dependencies in total. |
| 2026-11-04 | The SRS requirement for silent background GPS on an MDM-deployed native app cannot be met by a web app. We built the complete server side plus a foreground PWA tracker, and specified the native client in `docs/MOBILE.md`. Flagged up front. |
| 2026-11-04 | User is on the Claude **Pro** plan, not Max. Work is paced against the 5-hour usage window and paused when it runs out. |

## Known gaps and risks

- **Latency is fixed; the fix has a trade.** Functions ran in `iad1`
  (Washington) against a database in `ap-southeast-1` (Singapore), so every
  query crossed the Pacific at ~230 ms: registering a company took ~45
  seconds and the first sign-in after an idle period 35. Three changes on
  2026-11-06 — a cold start no longer re-applies the schema, provisioning
  runs in four waves rather than 45 sequential writes, and `vercel.json`
  pins the functions to `sin1` — brought those to 1.0 s and 1.06 s, with a
  warm page at 1.04 s. The trade is that visitors far from Singapore now pay
  the distance instead of the database; right for an office in Dhaka, and one
  line to reverse. Note the Vercel dashboard still shows `iad1`, because
  `vercel.json` overrides the project setting without changing it.
- **The map has been seen with data on it** (2026-11-07), after the ingest bug
  above was fixed: eight points from an enrolled device drew a person marker,
  the geofence circle and the live counters. Route playback and clustering at
  scale are still only exercised by the code behind them — one device on one
  short track is not a crowd.
- **There is now a test suite, and what it does not cover is the risk.** 154
  tests (`npm test`) run the real `src/lib` modules against a throwaway Neon
  branch — see [docs/TESTING.md](docs/TESTING.md). They pin the four defects
  of 2026-11-07, each confirmed by reverting its fix and watching the test go
  red, plus tenant isolation across eleven tables, both halves of the approval
  chain, and the document-number sequences.

  What they do not reach is most of the product. **No page or route is
  rendered**, so nothing here would catch a broken screen — the 34 static
  signed-in routes returning 200 is still a manual check. There is no
  browser and no DOM: the two component tests assert on static markup,
  which proves the checkbox refusal is *in* the markup and the coordinate
  inputs carry `step="any"`, not that either works in front of a person.
  **Payroll, the double-entry ledger, invoicing, expense claims, CRM,
  fleet and facilities have no test of their own** — the ledger balancing
  after a posting is still only the hand check of 2026-11-05. And the
  whole `tenants.timezone` discipline is untested, so the day-boundary
  behaviour verified by hand on 2026-11-06 could regress silently. The
  suite is a floor under the four known defects and three invariants; it
  is not a safety net under a change anywhere else.
- **Two deliberate behaviours that look like bugs.** A sole company admin
  cannot *request* leave, because an approver chain needs somebody other than
  the requester — HR manual entry is the path for recording their own
  absence. And nobody can approve or reimburse their own expense claim. Both
  are separation-of-duties rules, not defects; a one-person company works
  around them through HR manual entry and the auto-release described in the
  changelog.
- **Employee location tracking is regulated.** Before enabling it the operator
  needs a written policy, employee notice and in many jurisdictions consent.
  The system supports a retention limit and a tracking time window; the policy
  is the operator's responsibility.
- **Neon HTTP driver has no multi-statement transactions**, so a few
  multi-write operations (tenant provisioning, purchase-order receipt) are
  sequential. Ordering is chosen so a partial failure is recoverable rather
  than corrupting, but it is not atomic.
