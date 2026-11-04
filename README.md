# Office Management System (OMS)

Enterprise-grade, multi-tenant office management SaaS: Human Resources, Fleet
& Vehicle Logistics, Procurement & Supply Chain, Finance, CRM / Sales & Field
Operations, Facilities, Task Execution, and an IT/MIS executive dashboard with
a live operations map backed by a GPS telemetry engine.

Built from *Master Software Requirements Specification v2.0*, kept in
[`docs/`](docs/).

| | |
|---|---|
| **Status** | See [PROGRESS.md](PROGRESS.md) — the living source of truth |
| **Plan** | [docs/PLAN.md](docs/PLAN.md) |
| **Requirements** | [docs/SRS.md](docs/SRS.md) |
| **History** | [CHANGELOG.md](CHANGELOG.md) |
| **Mobile / GPS scope** | [docs/MOBILE.md](docs/MOBILE.md) |
| **Deployment** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |

## Stack

Next.js 16 (App Router, Server Components, Server Actions) · React 19 ·
TypeScript strict · Postgres on Neon via the serverless HTTP driver ·
Tailwind CSS v4 design tokens · deployed on Vercel.

Eight runtime dependencies total. No ORM, no auth library, no chart library,
no date library — see [docs/PLAN.md](docs/PLAN.md#2-technology-decisions) for
why.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL
npm run dev
```

The schema is created and migrated automatically on the first request — there
is no separate migration step. `src/lib/schema.ts` holds an idempotent list of
statements that both builds a fresh database and brings an existing one up to
date on every cold start.

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run check:tenancy` | **Run before any commit touching SQL.** Fails if a query on a tenant-scoped table omits `tenant_id` |
| `npm run docs:schema` | Regenerate `docs/DATABASE.md` from `src/lib/schema.ts` |
| `npm run docs:srs` | Regenerate `docs/SRS.md` from the Word SRS |

## Architecture at a glance

```
src/
  app/
    (auth)/          login, register a company
    (app)/           the signed-in application, one folder per module
    platform/        Super Admin — every tenant, subscriptions
    api/telemetry/   device enrolment + coordinate ingest (mobile clients)
    tracker/         foreground PWA GPS tracker
  lib/
    schema.ts        idempotent DDL, the single schema definition
    db.ts            Neon client, schema bootstrap, seed data
    auth.ts          sessions, password checks
    permissions.ts   RBAC gates: requirePermission / requireOwner / …
    <module>.ts      read queries for one module
    actions/*.ts     Server Actions — all mutations
  components/        shared UI primitives and forms
```

Every query against tenant data filters by `tenant_id` taken from the session.
Every mutating action re-checks its own permission. Those two rules are the
multi-tenant isolation boundary; `npm run check:tenancy` enforces the first
mechanically.

## Roles

Ten seeded system roles, matching SRS section 2: Super Admin (platform
operator, granted only through the `PLATFORM_ADMIN_IDENTIFIERS` environment
variable), Company Admin, IT & MIS Manager, Procurement & Supply Chain
Manager, HR Manager, Finance Manager, Fleet Manager, Sales & Field Team,
Driver, Employee. Each role carries an editable permission matrix.

## Licence

Proprietary. © 2026 Shahriar Parvez.
