# Changelog

Every change to this repository, newest first. Dates are absolute.
Status of the project as a whole lives in [PROGRESS.md](PROGRESS.md).

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
