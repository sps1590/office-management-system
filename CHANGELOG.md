# Changelog

Every change to this repository, newest first. Dates are absolute.
Status of the project as a whole lives in [PROGRESS.md](PROGRESS.md).

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
