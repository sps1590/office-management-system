# Changelog

Every change to this repository, newest first. Dates are absolute.
Status of the project as a whole lives in [PROGRESS.md](PROGRESS.md).

## 2026-11-07 — Security headers, and a name that should not have shipped

Found by driving the deployed site in a browser, signed out.

### Every response now carries security headers

Nothing was setting any. `poweredByHeader: false` was the only hardening in
`next.config.ts`, and neither `vercel.json` nor a middleware added more, so
production answered with Vercel's HSTS and nothing else.

- **`X-Frame-Options: DENY`** and **`Content-Security-Policy:
  frame-ancestors 'none'`.** Any site could put the sign-in page in an
  invisible iframe and harvest clicks on it. The CSP carries that one
  directive deliberately: a full policy needs a nonce on every inline script
  Next.js emits, and a half-written one fails in production rather than at
  build time, while `frame-ancestors` restricts no resource and is safe
  alone.
- **`Referrer-Policy: strict-origin-when-cross-origin`.** This one is the
  map's doing. Tiles come from OpenStreetMap and place lookups from
  Nominatim, both from the browser, so with no policy the full URL of
  whatever page the person was on — `/employees/<id>`, a payslip, a
  client — went to a third-party tile server with every tile. It now sends
  the origin and no path.
- **`X-Content-Type-Options: nosniff`**, and a **`Permissions-Policy`** that
  keeps geolocation (the location picker and the PWA tracker both need it,
  from this origin only) and denies camera, microphone, payment, USB and the
  motion sensors the product never uses.

### The signup page carried the operator's own name

`RegisterForm.tsx` had `placeholder="Shahriar Parvez"` on the full-name
field, so every company that ever registered saw a stranger's personal name
in the box. It is a format hint now. The company and phone placeholders
beside it were always generic.

### Checked and found correct

Worth recording, because the point of the sweep was to find the opposite.
All 34 protected routes redirect to `/login` when signed out, `/platform`
included. Telemetry ingest answers 401 to a missing and to an invalid token
with one generic message either way, and 405 to a `GET`. And
`/api/telemetry/enroll`, which takes an email and a password and so is a
second sign-in door, is rate limited on the same bucket as the web login,
checked before the user lookup, with the same generic refusal — it is not a
way around the sign-in limiter.

## 2026-11-07 — The first automated tests

61 tests in 8 files, run with `npm test`. They exercise the product's own
`src/lib` modules — the real Server Actions, the real SQL, the real permission
layer — against a throwaway Neon branch. Nothing in `src/` is mocked and no
database call is faked. How to run it and what it does not cover are in
[docs/TESTING.md](docs/TESTING.md).

This is the answer to the project's largest standing risk. The four defects
found earlier the same day had all been "verified" by reading code, and one of
them meant the GPS feature had never stored a row.

### The test database never touches the live one

NMCP is a live tenant in the production branch. Three independent things keep
the suite away from it, and all three have to fail before a test could reach
real data:

- `scripts/test-branch.mjs` creates the branch with `--schema-only`. An
  ordinary Neon branch is a copy-on-write clone and would carry every
  production row into the test database; a schema-only branch carries the 63
  tables and no rows at all, so nothing of a real company's is present.
- The suite reads `TEST_DATABASE_URL` from `.env.test`, never `DATABASE_URL`,
  and never loads `.env.local`. A working connection string cannot be picked
  up by accident.
- `assertThrowawayDatabase()` refuses any database holding a tenant whose slug
  is not the suite's own, and runs before the first write. That interlock is
  itself tested, by planting such a tenant in the test branch.

Each test provisions its own company through `provisionTenant` — the same
function registering a company runs — so a test tenant has the real role
copies, accounts, leave types, pipeline stages and `EMP-00001` admin. Both
defects of the `EMP-00001` kind were properties of a *freshly provisioned*
tenant; a fixture would have had neither. Tenants are dropped afterwards and a
global sweep removes anything a crashed run left behind.

### Covered

The four regressions of this morning first, each confirmed by reverting its
fix and watching the test go red:

- **Telemetry ingest.** A batch is stored, a replayed batch changes the row
  count by nothing, two points sharing an instant collapse to one, and every
  row is attributed from the token rather than the payload. Reverting the
  `WHERE device_id IS NOT NULL` on the `ON CONFLICT` fails 6 of 7 tests with
  42P10.
- **Geofenced check-in.** `require_geofenced_checkin` defaults FALSE and a new
  company can check somebody in with no fence anywhere; settings refuses to
  turn the requirement on with no active office or warehouse fence; the
  geofence toggle and delete both refuse to remove the last one while it is
  on, and allow it once the requirement is off. Reverting the column default
  fails 3 tests; reverting the three action guards fails 4.
- **The checkbox refusal.** `AutoForm`'s checkbox branch renders its
  `FieldError`, in the field-error style, beside its own control.
- **The pasted coordinate.** `LocationPicker` carries `step="any"` on both
  inputs, and a 14-decimal paste reaches the database rounded to the column's
  `NUMERIC(10,7)` — about a centimetre, the only precision in those digits
  that means anything.

Then the invariants most expensive to get wrong:

- **Tenant isolation.** Two companies with a row each in eleven tables. Every
  list read run as one returns none of the other's, checked on a marker in the
  row rather than on a count. Detail reads and the geofence write actions,
  given the other company's real row id, answer "not found" rather than
  obliging. A company admin is refused the platform views.
- **The approval chain's two halves.** Nobody may decide a request they
  raised, *and* resolution skips a stage landing on the requester and falls
  back to a company admin other than them — for leave and for purchase
  orders. Including the single-active-user case: the order is released with a
  `po.auto_approved` audit row, that stops the moment a second user exists,
  and a non-admin is refused it outright.
- **Document numbers.** One counter per kind, no kind advancing another's, the
  `employee` sequence starting where provisioning left it, and a company
  adding its first employee without colliding with its admin.

### Not covered

[docs/TESTING.md](docs/TESTING.md) has the full list, and it is long. No page
or route is rendered; there is no browser and no DOM; payroll, the ledger,
invoicing, CRM, fleet and facilities have no test of their own; the whole
timezone discipline is untested. This suite is a floor, not a safety net.

### Also

- `npm run verify` runs `npm run check` then `npm test`, which is the single
  command to use before a commit. No git hook: the suite needs the network,
  and a commit touching only a document should not pay for it.
- `vitest` is the project's first test dependency. The reasoning against
  `node:test` is recorded in [docs/PLAN.md](docs/PLAN.md), as CLAUDE.md
  requires. Dev-only; the production bundle is unchanged at eight runtime
  dependencies.
- No product behaviour was changed to make a test pass. The suite found no new
  defect — it did find one in itself: the first idempotency test recomputed its
  timestamps per call, so it was not replaying a batch at all and would have
  passed whatever `ON CONFLICT` did. It now uses a fixed instant, and that is
  written down in TESTING.md as the trap it is.

## 2026-11-07 — GPS ingest fixed, and coordinates picked on a map

Four defects, all found by exercising the product rather than reading it.

### Telemetry ingest answered 500 to every request

`ingestPoints` wrote `ON CONFLICT (device_id, log_timestamp) DO NOTHING`,
but that unique index is *partial* — `WHERE device_id IS NOT NULL` — and
Postgres will not infer a partial index as the conflict arbiter unless the
statement repeats its predicate. Every batch raised 42P10, so the GPS feature
the SRS calls complete had never written a single row. The clause now carries
the predicate, and the first real track went in: eight points accepted,
replayed unchanged, and drawn on the live map with the fence around it.

The same insert ran one statement per point inside a loop. Over Neon's HTTP
driver each statement is a separate request, so a 500-point flush from an
offline device was 500 round trips; it is now one `jsonb_to_recordset`
insert. JSON rather than parallel `unnest` arrays because most of these
columns are nullable and a JSON object just omits the key.

### A new company could not check anybody in

`require_geofenced_checkin` defaulted to TRUE while a new tenant has no
geofences, so every check-in was refused — and the refusal said the person was
outside the office rather than that no office existed. It defaults to FALSE
now, which also suits the written-policy-first note this feature already
carries. Two guards keep the state from coming back: settings refuses to turn
the requirement on with no active office or warehouse fence, and the geofence
toggle refuses to deactivate the last one while the requirement is on. A
migration releases any company already stuck.

### A coordinate pasted from a mapping site was rejected

The geofence form carried `step="0.0000001"`, so the browser refused
`23.81024858290594` — what Google Maps actually gives you — with "please
enter a valid value" and two numbers either side of it. Coordinate inputs now
use `step="any"` and let `NUMERIC(10,7)` round, which it does to about a
centimetre.

### A mistyped geofence could not be corrected

Disabling a fence keeps its name, and the name is unique per company, so an
admin who put the centre in the wrong place could neither fix it nor reuse
the name — a dead end on the mistake most likely to be made. Geofences can
be deleted now, behind `tracking.delete` and a confirmation that says the
alert history goes with it; attendance rows survive, because that reference
is ON DELETE SET NULL. The same guard as disabling applies: the last active
office fence cannot go while check-in requires one.

### A refusal aimed at a checkbox went nowhere

`AutoForm`'s checkbox branch rendered no `FieldError`, so any
`fieldErrors` entry for a checkbox was silently dropped. It renders one now.

### Picking a point on a map

Typing latitude and longitude meant leaving the product, finding the place in
a mapping site, right-clicking and copying two numbers back — for geofences,
client sites, warehouses and delivery destinations alike. `AutoForm` gained a
`location` field type backed by a new `LocationPicker`: click the map, drag
the pin, search a place name against OpenStreetMap's geocoder, or take the
device's own position. The ring previews the radius live as it is typed.

Leaflet was already a dependency for the operations map, so nothing new was
added; the picker is loaded with `next/dynamic` so forms without a map do not
carry it. The ring takes its colour from `--primary` through a stylesheet
rule that outranks Leaflet's inline attribute, so it follows the theme into
dark mode without a line of JavaScript.

## 2026-11-06 — Functions moved to Singapore, beside the database

Batching removed the needless round trips; this removes the cost of the ones
that are left. The Neon database is in `ap-southeast-1` and the functions were
in `iad1` (Washington), so every query a page made crossed the Pacific at
about 230 ms. `vercel.json` now pins `regions: ["sin1"]`, which puts the
functions in the same city as the data.

No data moved and nothing was migrated: it is a config line and a redeploy.
The trade is that a visitor far from Singapore now pays the distance instead
of the database — the right way round for an office in Dhaka, and reversible
by editing one line.

### Measured on production, all three paths, through the whole day's work

| | `iad1`, unbatched | `iad1`, batched | `sin1`, batched |
| --- | --- | --- | --- |
| Registering a company | ~45 s | 5.4 s | **1.0 s** |
| First sign-in after idle | 35 s | 3.0 s | **1.06 s** |
| Warm sign-in | 1.5 s | 1.3 s | **1.04 s** |

The cold/warm gap has essentially closed: three consecutive sign-in attempts
measured 1.06, 1.03 and 1.05 seconds. What remains in that second is mostly
the browser's own trip to the edge, not the database.

### Worth knowing
The region lives in `vercel.json`, which overrides the project's dashboard
setting without changing it — so Vercel's project page still reads `iad1`
while deployments run in `sin1`. The deployment is the truth, and the
`x-vercel-id` response header shows it: `bom1::sin1::…`, edge PoP then
function region. The repo is the single source for this, the way the schema
and the settings already are.

## 2026-11-06 — Registering a company in four round trips instead of 45

The last of the slow paths. `provisionTenant` made 45 writes, each its own
HTTP request, each ~230 ms from `iad1` to `ap-southeast-1`: one tenant, 9
roles, a department, the admin, a profile, a department update, a doc
sequence, 5 leave types, 17 accounts and 6 pipeline stages, strictly one after
another.

Every repeated insert is now a single statement that reads its rows from
`unnest` of array parameters -- still the Neon tagged template, still fully
parameterised, no SQL built by string. The result runs in four waves:

1. the tenant, for its id;
2. roles, department, settings and subscription, concurrently;
3. the admin, who needs a role and a department to exist;
4. profile, department head, doc sequence, leave types, accounts and stages.

### The waves are the old ordering, kept
The function's docstring promised that a failure part-way leaves a company
merely missing some defaults, never an orphaned user. Running everything at
once would have broken that: a failed leave-types insert would have aborted
before the admin was created, leaving a company nobody could sign in to --
strictly worse than before. So wave 2 holds only what the first login needs
and wave 4 holds what can be re-seeded by hand.

### Verified by diffing against a tenant the old code built
A throwaway company registered through the form, then every provisioned table
compared row for row with NMCP, which the sequential code had created:

| | |
| --- | --- |
| roles, accounts, leave types, pipeline stages | identical |
| settings, subscription | identical |
| admin | EMP-00001, company_admin, Management, permanent, joined today |

Counts alone would not have caught a mis-mapped `unnest` column, which is why
the comparison is on values. The throwaway tenant was deleted afterwards.

## 2026-11-06 — The schema stops re-applying itself on every cold start

Turning off Vercel Authentication finally made the deployed app measurable
from outside, and the first sign-in after an idle period took **35 seconds**
against **1.5 seconds** warm. Not the Pacific crossing in general: it was
`ensureSchema()`. The statement list cannot be batched, because the Neon HTTP
driver has no multi-statement transaction, so a cold start spent 140-odd
sequential round trips to Singapore re-applying a schema that was already
there before it would answer the first request. The first person to sign in
each morning concluded the app was broken.

The statement list is still the only migration mechanism, and it still both
creates a fresh database and migrates a deployed one. It just runs when it has
something to do. `db.ts` hashes the statements, the subscription plans and the
system role templates into a fingerprint and `schema_state` records the one
the database is at; a cold start reads it in a single query and, on a match,
applies nothing.

There is no version number to remember to bump — change any statement and the
hash moves with it. What a hash cannot see is the database being altered
underneath us, so `SCHEMA_REFRESH=1` forces the full run and repairs it.

Two things deliberately still run on every cold start: `syncPlatformAdmins()`,
because `PLATFORM_ADMIN_IDENTIFIERS` can change while the schema does not, and
`pruneEphemeral()`. Three round trips, not a hundred and forty.

### Measured
Locally, Bangladesh to Singapore, timing the first sign-in of a freshly
started process:

| Cold start | First request | `schema_state.applied_at` |
| --- | --- | --- |
| nothing recorded yet | 12.2 s | written |
| fingerprint matches | **2.1 s** | untouched |
| `SCHEMA_REFRESH=1` | 12.2 s | rewritten |

The untouched timestamp is the proof it skipped rather than re-applied
quickly. The production saving is larger, since each of those round trips is
~230 ms from `iad1` rather than ~25 ms from Dhaka.

### Also
`schema_state` is a new table, non-tenant-scoped, which `check:tenancy` works
out for itself from the absence of a `tenant_id` column — 59 of 63 tables
scoped, every scoped query still filtered.

## 2026-11-06 — Counters now count the company's day, not the database's

The previous entry fixed how a wall clock is stored and rendered, and left one
thing behind: the aggregate queries that asked Postgres what day it is.
`CURRENT_DATE` is the *database session's* day, which on Neon is UTC. So a
Dhaka office read yesterday's figures until 06:00 and a Toronto one tomorrow's
after 19:00. An invoice due today was already counted overdue; a deal won on
the 1st landed in last month's total; "on leave today" named the wrong day for
part of every day.

### How the boundaries are decided now
`calendarBounds(timeZone)` in `src/lib/utils.ts` returns the company's own
`today`, `monthStart`, `yearStart` and `year` as calendar days, plus the
instants at which its day, week, month and year began. A query comparing a
DATE takes the calendar day; one comparing a TIMESTAMPTZ takes the instant.
Both are computed once per request, so a page of twelve concurrent queries can
no longer straddle midnight the way twelve separate `CURRENT_DATE` calls could.

Twelve query functions gained the zone as an argument — `financeStats`,
`cashFlowTrend`, `fleetStats`, `bookingStats`, `fleetCostTrend`, `leaveStats`,
`crmStats`, `visitStats`, `assetStats`, `taskStats`, `procurementStats`,
`spendByVendor` — along with `trackingStats` and `listDevices`. Required, not
optional, so the compiler found all 29 call sites.

### Bucketing, not just comparing
`fleetCostTrend` buckets trip costs by month from a TIMESTAMPTZ, so *which*
month a trip falls in depends on the zone: that one still truncates in SQL, now
as `date_trunc('month', timezone($zone, t.started_at))`. The maintenance side
reads a DATE and needs no conversion. A boundary comes from JS; bucketing a
column stays in SQL.

### Overdue in the browser, too
Seven pages decided "overdue" in JavaScript with
`new Date(row.due_date).getTime() < Date.now()` — a calendar day parsed as UTC
midnight against the server's instant, which flagged a bill due today as
overdue for several hours each morning. They compare `YYYY-MM-DD` strings
against the company's today now, which is both correct and cheaper. It also
cleared eight of the fourteen `react-hooks/purity` lint errors, since the
comparison no longer calls `Date.now()` during render.

### Dates written as "now"
`completed_date`, `received_date`, `returned_on`, `assigned_on` and
`recorded_on` were written as `CURRENT_DATE`, and provisioning set a new
company's `trial_ends_on` and its admin's `date_of_joining` the same way.
Registering at 01:00 in Dhaka recorded a joining date of the day before. All
now take the company's day. `stock_movements` keeps `created_at`, an instant,
and needed nothing — `npm run check:columns` caught an attempt to add a
calendar day it does not have.

### "Today" now means today
`active_today`, `points_today` and `deviations_today` counted a rolling 24
hours while the UI called them "today". On an operations board that is a
different number: with one coordinate logged at 05:00Z and another at 20:00Z,
the rolling window said two and the company's day said one. They count from
the company's midnight now, and the two labels that honestly said "24h" were
relabelled to match.

### Verified
Against a throwaway tenant on the real database, seeded with rows that
straddle the boundary, read twice without changing a single row — once as
America/Los_Angeles (where it was still 05 Nov) and once as Asia/Dhaka (where
it was already the 6th):

| Counter | Los Angeles | Dhaka |
| --- | --- | --- |
| Invoices overdue | BDT 500, one row flagged | BDT 1,500, two rows flagged |
| Bills overdue | BDT 0 | BDT 700, row flagged |
| Tasks overdue | 0 | 1 |
| Vehicle documents expiring within 30 days | 0 | 1 |
| Deals won this month | BDT 1K | BDT 10K |
| On leave today | 1 | 0 |

All 17 pages touched returned 200 in both zones. `npm run check` reports 345
statements, every tenant-scoped query filtered and every column present; the
build is clean and lint is down to 6 errors from 14, all pre-existing.

### Known limitation
Nothing date-shaped is left on the database's clock. The platform console
(`/platform`) stays in UTC by design — it spans every tenant, so it cannot
sort in mixed zones — and the genuinely rolling windows ("reporting now", "in
the last 24 hours", session and rate-limit expiry) are durations from the
present instant and carry no zone at all.

## 2026-11-06 — Every date and time is now the company's, not the server's

The app had been telling every company the server's time. A booking typed as
10:00 in Dhaka reached a TIMESTAMPTZ unqualified, so Postgres read it in the
session zone and stored 10:00 UTC — four in the afternoon, locally — and
`formatDateTime` then rendered it in whatever zone the *server* happened to
run in: UTC on Vercel, Asia/Dhaka on a laptop. Production and development
disagreed with each other and both disagreed with the office.

`tenants.timezone` now decides, and is threaded explicitly wherever a wall
clock is read or written, the way `money()` is already passed the tenant's
currency.

### Storing
- `zonedToInstant()` / `zonedToSql()` resolve a `datetime-local` value in the
  tenant's zone before it reaches the database. Applied to room bookings,
  vehicle bookings, field visits, logistics routes and HR's manual attendance
  entry — every place a typed clock becomes a TIMESTAMPTZ. The offset is
  resolved twice, since it depends on the instant and the instant on the
  offset, which also makes it right across a daylight-saving change.
- `computeLateMinutes()` builds the start of the shift from the company's
  calendar day in the company's zone. It used `setHours`, which read the
  server's clock: "work starts at 09:00" was nine o'clock in Washington.

### Rendering
- `formatDate`, `formatDateTime` and `formatTime` take the zone as a required
  argument, so the compiler finds every one of the 101 call sites rather than
  leaving one to drift back to the server's clock. `isoDate()` returns the
  calendar day where the company is; the year used for "this year" totals and
  the dashboard's date line come from the same place.
- **A DATE is never pushed through a zone.** The driver's default parser turns
  one into a `Date` at the *process's* midnight, which renders as the day
  before for any tenant west of the server — a leave request starting 09 Nov
  reading as 08 Nov in New York. The parser for OID 1082 now returns the raw
  `YYYY-MM-DD`, which is what every row type in the codebase already declared
  it to be, and `formatDate` ignores any zone passed for such a value. It is
  set on the shared pg-types registry: the HTTP driver takes a `types` option
  only per query and silently ignores the one given to the connection.
- The attendance trend's day axis ends on the company's today rather than
  `CURRENT_DATE`, which is the database's UTC day.
- The check-in widget and the field tracker are client components and had been
  using the *browser's* zone; both now take the company's.

### Choosing the zone
- Settings offers the 418 IANA zones as a list instead of a text box, with the
  current time there shown underneath, and the server refuses a zone it does
  not know rather than letting every page quietly fall back to UTC.
- Registration sends the browser's zone in a hidden field, validated
  server-side, so a company outside Bangladesh is not silently put on Dhaka
  time. The platform console stays in UTC and says so in the column header:
  one table spanning every tenant cannot sort in mixed zones.

### Found while verifying
`usePreservedForm` restored a refused form inside a `requestAnimationFrame`,
which never fires in a tab that is not painting — so the one case where
someone is most likely to lose their typing, submitting and then looking away,
was the case where the restore never ran. It is a `setTimeout` now.

### Verified
Against a throwaway tenant on the real database: 10:00 typed in Dhaka stored
as `04:00Z` and shown as 10:00; the same row re-read after switching the
company to `America/New_York` shown as 23:00 the previous day, unchanged in
the database. A manual attendance entry of 09:45–18:00 stored `14:45Z`–`23:00Z`
and computed 30 minutes late against a 09:00 start with 15 minutes' grace. A
DATE column rendered 05 Nov for a New York tenant rather than 04 Nov. The
free-slot suggestions read in the tenant's zone throughout. All 34 routes
returned 200. The test tenant was deleted afterwards.

### Known limitation
Aggregate counters that compare a DATE column against `CURRENT_DATE` — overdue
invoices and bills, "this month" totals, documents expiring within 30 days,
on-leave-today — still use the database's UTC day. They can therefore be a day
out for the few hours each day when the company's date and UTC's differ.
Correcting them means threading the zone into about twenty more query
functions for a counter that drifts by one; it is recorded here rather than
done.

## 2026-11-05 — A refused room booking now says when the room is free

Refusing an overlap with "already booked for part of that slot" left the next
attempt to guesswork: pick a time, submit, be refused again. The refusal now
carries the answer it already has.

- `findFreeSlots()` in `src/lib/workplace.ts` walks the gaps between a room's
  confirmed bookings over the next seven days and returns the first few
  windows long enough for the meeting that was asked for. The search runs
  over the company's working hours from `tenant_settings`
  (`work_start_time` + `standard_work_minutes`), widened on the requested day
  itself so an after-hours request is answered after hours, and skips
  `weekend_days` on later days — the first use the system makes of that
  setting. One suggestion comes out of each gap, at its earliest start, so a
  meeting can begin the moment the room empties.
- `bookRoomAction` now selects the clashing booking rather than `SELECT 1`,
  so the message names the time in the way: *"Mini Meeting Room is already
  booked 09:30–10:20. It is free at these times:"* — or says plainly that
  nothing that long is free in the next week.
- `ActionState` gained `suggestions`, a list of `{ label, values }`.
  `AutoForm` draws them as buttons under the error; a click writes the values
  into the inputs of those names and focuses the first, so a refusal that
  knows the answer costs one click instead of a re-type. It is generic, not
  room-specific: any action that can name a way out can offer one.
- Bookings are written from `datetime-local` inputs, which carry no zone, so
  every calculation reads and writes UTC components. A suggestion therefore
  round-trips back into the form as exactly the clock time its label names.
  (The separate, still-open issue — that `formatDateTime` renders the
  bookings table in the *server's* zone — is unchanged and unrelated.)

Verified end to end against a throwaway tenant on the real database, since
this is arithmetic that only shows its errors on real data: booking
09:30–10:20 then asking for 10:00–10:30 offered `09:00–09:30`,
`10:20–10:50` and `Mon 09 Nov, 09:00–09:30`; the middle one booked
back-to-back on one click. A nine-hour request against an eight-hour working
day produced the no-slot message and no buttons. A full Friday booking
offered `Sun 15 Nov` first, skipping both the booked Friday and the Saturday
weekend. Checked in light and dark themes and at 375 px, where the buttons
wrap without overflow. The test tenant was deleted afterwards.

## 2026-11-05 — Verified against production; found a cross-region latency problem

### Verified on the deployed app
Commit `75e64fc` was exercised in Chrome against
`https://office-management-system-sps-a983.vercel.app`, not just locally:
registration (including a deliberate validation failure), the dashboard, the
first employee, the users table and the permission matrix. The two fixes that
matter most behave in production exactly as they do locally — the refused
registration kept all five text fields and cleared only the passwords, and
**the first employee was created rather than crashing the page**. The smoke
tenant was deleted afterwards, leaving 0 tenants, users and accounts with the
10 role templates and 3 plans intact.

### Found, not fixed
- **The functions and the database are on opposite sides of the world.**
  Vercel runs this project's functions in `iad1` (Washington) — there is no
  `vercel.json`, so it takes the account default — while the Neon database is
  in `ap-southeast-1` (Singapore). Every query is a ~230 ms round trip. One
  warm API call carrying a single query measures ~400 ms to first byte, and
  **registering a company took about 45 seconds**, because provisioning
  issues roughly forty queries one after another. The Neon HTTP driver has no
  transactions, so those writes cannot be batched into one statement, which
  makes the latency multiply instead of amortise.

  Nothing about this is visible in development: a local server in Dhaka is
  close to Singapore, so the same registration takes a few seconds. It is a
  deployment topology problem, not a code one. Two ways out, both the
  owner's call — move the functions to `sin1` so they sit beside the
  database (best for users in Bangladesh, and it may need a paid plan), or
  move the Neon database to US East to sit beside the functions (free, and
  turns forty slow round trips into one). Parallelising the independent
  writes in `provision.ts` would cut the count either way.

## 2026-11-05 — Clicked through the UI; six defects above the action layer

The previous entry executed every Server Action but never rendered a form.
This one drove the real browser against a real company: register, add an
employee, a vendor, a client, a deal, a room, a booking, a purchase order,
receive it into stock. Everything found here was invisible to the build, to
both static checks and to the 70-write harness, because it lives in JSX, in
React's form behaviour, or in a sequence that only collides on a company's
first hire.

### Fixed
- **No company could add its first employee.** Provisioning gives the
  registering admin `EMP-00001` and seeds a `doc_sequences` row under kind
  `employee` so the next hire gets `EMP-00002`. `createEmployeeAction` drew
  from kind **`asset`** instead — a sequence that does not exist yet in a new
  tenant, so it returned `EMP-00001` a second time and the insert died on
  `users_tenant_employee_code_idx`. Not a handled error either: the unique
  violation propagated and the page rendered "This page couldn't load". Now
  draws from the `employee` kind, with `employee` added to the `nextDocNumber`
  union (its absence is why `asset` was reached for), and a typed-in duplicate
  code is reported against the field instead of crashing.
- **Every form emptied itself when a submission was refused.** React resets an
  uncontrolled form once its action completes, on a refusal as well as a
  success, and nothing fed the submitted values back as `defaultValue`. One
  bad field threw away everything typed — trivial on the login form, costly on
  the employee form and a purchase order with line items. `usePreservedForm`
  captures the values on submit and writes them back after the commit that
  carried the error; password fields are deliberately excluded. Wired into
  `AutoForm` (which backs most CRUD screens), the register, login, employee
  and geo forms. Controlled forms were never affected.
- **No lifecycle action could confirm itself.** `ActionButton` rendered its own
  success message, but a successful action changes the record's status, which
  renders a different set of buttons — so the button unmounted in the very
  commit that delivered its success, taking the message with it. Submitting a
  purchase order, cancelling a booking, approving anything: all silent. The
  message is now raised during the action, while the component is still alive,
  and shown by a `Toaster` in `AppShell`. Its queue lives in the module rather
  than in component state, because the server re-render that follows
  `revalidatePath` can remount the toaster — which is exactly when the
  confirmation is needed.
- **The approval trail contradicted the status badge.** An order released by
  the single-user auto-approve path writes no `po_approvals` row, so the trail
  fell through to "Not submitted for approval yet." directly beneath an
  **Approved** badge. It now explains the release instead, and keeps the old
  wording only for a draft or cancelled order.
- **"Last sign-in" on `/users` showed the date of joining.** A plain wrong
  field in JSX: `u.date_of_joining` under a "Last sign-in" header, so someone
  who had never signed in showed a date. `listEmployees` now selects
  `last_login_at` and the column renders it, with "Never" when it is null.
- **The finance donut was captioned with an unrelated figure.** "Balance by
  account type" carried `stats.receivable.outstanding` in its centre, labelled
  "receivable" — a reader saw "0 receivable" in the middle of a chart about
  asset and liability balances. It now shows the total posted.

### Verified in the browser
- Registration, dashboard, employee creation with a generated temporary
  password, vendor, client, deal, room, booking, a two-line purchase order
  through draft → submit → auto-approve → receive, and the ledger posting
  behind it: Inventory debit 29,375 against Accounts Payable credit 29,375,
  trial balance ✓.
- Client-side line-item arithmetic on the purchase-order form (21,000 + 6,500
  = 27,500 subtotal, 29,375 with tax and shipping) matches what was saved.
- The kanban moves a deal and closes it on a won stage; the room overlap guard
  refuses a clashing slot with a clear message; validation errors land on the
  right field and no longer empty the form.
- All 35 signed-in routes return 200, and `/platform` correctly redirects a
  non-platform admin away.
- Dark theme, the command palette and the mobile layout (375px, no horizontal
  overflow on any page checked) all hold up.
- The test tenant was deleted afterwards: 0 tenants, users, journal lines,
  orders, bookings and deals, with the 3 subscription plans intact.

### Known, not fixed
- **Times are stored and displayed inconsistently across timezones.** A
  `datetime-local` value is handed to Postgres as a bare timestamp, so a
  booking made at 10:00 is stored as 10:00 **UTC** regardless of where the
  person is; `formatDateTime` then renders it in the *server's* zone, not the
  tenant's. On Vercel both ends are UTC and it looks right, but booking 10:00
  on a machine in Asia/Dhaka displays as 16:00, and `tenants.timezone` is
  never consulted. Confirmed against the database (`start_time` came back as
  `10:00Z` for a 10:00 entry, session `TimeZone` is GMT). The fix spans every
  timestamp that is written or rendered, plus the attendance and tracking
  windows, so it is its own piece of work rather than a patch.

## 2026-11-05 — Every write path executed; two purchase-order dead ends fixed

### Fixed
- **A new company could not submit a purchase order at all.** The default
  approval tiers name `procurement_manager` (from 0) and `finance_manager`
  (from 50,000), and nobody holds those roles on a company's first day, so
  every applicable tier resolved to nobody and `submitPurchaseOrderAction`
  returned *"No approver could be found for this value."* Only orders above
  500,000 — the `company_admin` tier — went through, so small orders were
  blocked while large ones passed.
- **A purchase order raised by the procurement manager could never be
  approved.** The tier loop did not exclude the requester, so tier 1 resolved
  to the person who raised the order, while `decidePurchaseOrderAction`
  refuses with *"You cannot approve an order you raised."* The order was
  parked in `pending` with an approver who was refused at the point of
  clicking. This one hits an ordinary staffed company, not just a new one.

  Both are fixed in `submitPurchaseOrderAction` by giving it the rule the
  leave chain already had: skip a tier that resolves to the requester, then
  fall back to a company admin other than the requester. When there is
  genuinely nobody else — a company whose only active user is the admin who
  registered it — the order is approved on submission and recorded in the
  audit log as `po.auto_approved`, with a message saying so. That grants no
  power the admin did not have (they can edit the tiers and assign themselves
  any role), and the alternative is an order that can never leave `pending`.
- `AGENTS.md` held two copies of the Next.js agent block: the one written by
  hand when `CLAUDE.md` turned out to import a missing file, and the
  delimited one `next dev` writes and maintains. Only the delimited one is
  kept, so the working tree stops going dirty on every `next dev`.

### Verified against live Postgres — every write path, not just the reads
- A temporary harness called the real Server Actions server-side inside a
  request carrying a real session cookie, so permission checks, zod
  validation, the SQL and the ledger posting all ran exactly as they do from
  the UI. **70 write operations across all nine modules passed**, in three
  seats: 59 as the company admin, 6 as an employee, 5 back as the admin
  approving what the employee raised.
- **The double-entry ledger balanced after every posting**: 175,545.45 debits
  against 175,545.45 credits over 14 auto-posted lines after the admin phase,
  and 280,945.45 against 280,945.45 over 22 lines once the approvals had
  posted. Payroll, purchase receipt, trip fuel and tolls, invoices, payments
  and expense reimbursement all post, and all balance.
- Both directions of every approval chain were exercised with a real
  separation of duties — admin raises and employee approves, employee raises
  and admin approves — plus the day-one single-user case, where a 34,000
  order now submits, auto-approves and posts to accounts payable.
- The room-booking overlap guard was tested by booking the same slot twice;
  the clash is refused, which is the pass condition for that step.
- Deleting the five harness tenants afterwards left **0 tenants and the 3
  subscription plans intact**, confirming `ON DELETE CASCADE` again over far
  more data than the first run.

### Notes
- The harness was deleted rather than kept: reaching the approval paths needed
  a mode that swaps the session cookie to another user, and an impersonation
  endpoint must not exist in a shipped app, however it is guarded. The method
  is recorded here so it can be rebuilt: one route handler under
  `src/app/api/`, importing the actions and calling them with a constructed
  `FormData`, treating a thrown `NEXT_REDIRECT` digest as success.
- Two product behaviours are deliberate and were left alone, now documented in
  PROGRESS.md: a sole company admin cannot *request* leave (no approver can
  exist; HR manual entry covers recording their absence), and nobody can
  approve their own expense claim.
- A route folder named `__writetest` is not reachable: App Router treats a
  leading underscore as a private folder and excludes it from routing.

## 2026-11-05 — Database provisioned, deployed, first live run

### Fixed
- **`payslips` was missing `status` and `paid_at`**, which `src/lib/payroll.ts`
  selected (`ps.status`) and `setPayrollStatusAction` updated. `/payroll` and
  `/me` returned 500 with `column ps.status does not exist`. Added to the
  `CREATE TABLE` for fresh databases *and* as `ADD COLUMN IF NOT EXISTS` for
  the database that already existed. This is the first bug the TypeScript build
  could not have caught — it only appears when the SQL runs.
- `PermissionMatrix` mapped a fragment without a key, so React warned on
  `/users`. Now `<Fragment key={group.label}>`.

### Added
- `scripts/check-columns.mjs` and `npm run check:columns`: resolves every
  `alias.column`, `INSERT INTO t (…)` and `UPDATE t SET …` reference in the
  codebase against the schema. Written after the `payslips` bug to catch that
  class statically rather than by clicking. Reports clean across 340
  statements. `npm run check` now runs the tenancy and column checks together.

### Infrastructure
- Vercel project `office-management-system` created under team `sps-a983`, with
  the GitHub repo connected for push-to-deploy.
- Neon Postgres `office-management-system-db` provisioned in `sin1` through the
  Vercel marketplace integration, connected to production, preview and
  development. The Neon CLI **cannot** create projects in this org
  (`organization is managed by Vercel`), which is why it was done this way;
  `docs/DEPLOYMENT.md` has been rewritten accordingly.
- `PLATFORM_ADMIN_IDENTIFIERS` and `TELEMETRY_TOKEN_SECRET` set in all three
  environments.

### Verified against live Postgres
- Schema executed clean on the first attempt: 62 tables, 158 indexes, 157
  foreign keys, 521 check constraints, 10 role templates, 3 plans.
- End-to-end company registration: provisioning wrote 9 role copies, 17
  accounts, 5 leave types, 6 pipeline stages, a department, settings,
  subscription and the admin user (bcrypt). Deleting the tenant cascaded to
  zero rows everywhere while leaving the platform role templates intact.
- All 34 signed-in routes return 200 against live data.
- A note worth keeping: the landing page and `/login` do **not** create the
  schema, because `getSessionUser()` returns before opening a connection when
  there is no cookie. Registering, or any authenticated request, does.

## 2026-11-04 — Neon agent skills and MCP server

### Added
- `.claude/skills/neon/SKILL.md` and `.claude/skills/neon-postgres/SKILL.md`,
  fetched from `https://neon.com/.well-known/agent-skills` and verified
  against the registry's published SHA-256 digests (both matched).
- `.mcp.json` registering Neon's hosted MCP server:
  `{"neon": {"type": "http", "url": "https://mcp.neon.tech/mcp"}}`. OAuth, so
  no API key is written into a file git tracks — which is what Neon's own
  skill recommends for a project-level install. Endpoint verified live
  (returns 401 until authorised).
- `AGENTS.md`, which `CLAUDE.md` imported but which did not exist. `next dev`
  rewrites this file, so having it present is the steady state.
- `.neon` added to `.gitignore` ahead of `neon link`, which writes org,
  project and branch ids there as local state.
- A **Neon tooling** section in `CLAUDE.md` recording how the skills were
  installed and how to refresh them.

### Notes
- Four of Neon's eight published skills were installed deliberately as two:
  `neon` (the overview, which carries CLI and MCP setup) and `neon-postgres`
  (connections, schema, branching — what this project actually does).
  `neon-auth`, `neon-object-storage`, `neon-functions`, `neon-ai-gateway`,
  `neon-realtime` and `neon-postgres-agent-platforms` were left out: this app
  uses none of them, and every installed skill costs context in every
  session. Each is one fetch from the same registry if that changes.
- Installed by direct fetch rather than `npm i -g neon`, which the sandbox
  declined as external code. The skill document sanctions this path
  explicitly ("If the Neon CLI is not available, you can visit
  …/.well-known/agent-skills … and fetch them manually"). Consequence: no
  `skills-lock.json`, so `neon skills status` will not track them.
- Nothing pre-existing was changed. There was no `.claude/`, no `.mcp.json`
  and no MCP server configured at any scope before this.

## 2026-11-04 — v1.0 feature complete (not yet deployed)

### Added
- **Schema**: 62 tables and 69 indexes in `src/lib/schema/`, split by domain
  (platform, identity, HR, fleet, procurement, CRM, finance, workplace,
  telemetry) and aggregated into one ordered list of idempotent statements.
- **Identity**: cookie sessions, bcrypt, Postgres rate limiting, audit trail,
  notifications, ten SRS roles as editable permission matrices, tenant
  provisioning with reference data, atomic document numbering.
- **HR**: employee directory and profiles, departments, geo-fenced attendance
  with 8-hour and overtime computation, multi-stage leave approval, payroll.
- **Fleet**: registry, requisition workflow, trip logs, maintenance.
- **Supply chain**: vendors, warehouses, inventory with movement ledger,
  purchase orders with tiered approval, receipt into stock, logistics routes.
- **CRM and field**: clients, pipeline kanban, activities, GPS-verified visits.
- **Finance**: double-entry ledger with auto-posting, trial balance, P&L,
  invoices, bills, payments, expense claims.
- **Workplace**: meeting rooms, visitors, asset register, projects and tasks.
- **IT/MIS and GPS**: executive dashboard, live operations map with route
  playback, device enrolment, geofences with deviation alerts, retention purge,
  audit viewer, cross-module reports, platform operator console.
- **Telemetry API**: `/api/telemetry/enroll` and `/api/telemetry/locations`,
  plus the `/tracker` PWA that uses them.
- **UI**: Tailwind v4 token system with light/dark theming, app shell with
  permission-driven navigation and a command palette, server-rendered SVG
  chart set, one spec-driven form component behind the CRUD screens.
- **Tooling**: `scripts/check-tenancy.mjs` (derives tenant-scoped tables from
  the schema and fails on an unfiltered query) and
  `scripts/gen-schema-docs.mjs` (regenerates `docs/DATABASE.md`).
- **Docs**: `docs/DEPLOYMENT.md`, `docs/DATABASE.md`, and a rewritten
  `PROGRESS.md` recording what is and is not built.

### Verified
- `npm run build` clean across 41 routes.
- `npm run check:tenancy`: 340 SQL statements, 59 of 62 tables tenant-scoped,
  every tenant-scoped query filtering by `tenant_id`.

### Not done
- Neon database and Vercel project: each needs one browser authorisation from
  the account owner. Commands are in `docs/DEPLOYMENT.md`.
- Native MDM mobile app: specified in `docs/MOBILE.md`, deliberately out of
  scope for a web deliverable.

## 2026-11-04 — project start

### Added
- Project created at `projects/OfficeManagementSystem` from the
  *Master Office Management System SRS v2.0* brief.
- `docs/Master_Office_Management_System_SRS_v2.docx` — original requirements
  document kept in-repo for future reference.
- `scripts/extract-srs.py` and `docs/SRS.md` — the Word SRS rendered to
  markdown, regenerable with `npm run docs:srs` so the two cannot drift.
- `docs/PLAN.md` — scope reading of the SRS, technology decisions with
  rationale, nine implementation phases, engineering rules.
- `PROGRESS.md` — living status document.
- Next.js 16 / React 19 / TypeScript strict / Tailwind CSS v4 scaffold:
  `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
  `eslint.config.mjs`, `.gitignore`, `.env.example`.

### Decided
- Dependencies kept to eight runtime packages
  (`@neondatabase/serverless`, `bcryptjs`, `leaflet`, `lucide-react`, `next`,
  `react`, `react-dom`, `zod`). No ORM, no chart library, no auth library,
  no date library, no `clsx` — each replaced by a few lines of own code, per
  the brief's request for the most optimised design.
- UUID primary keys throughout, as specified in SRS section 4.
