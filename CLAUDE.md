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
- Validate every new action input with `zod`, in a schema declared next to the
  action. No hand-parsed `FormData`.
- Colours come from the CSS custom properties in `globals.css` and must work
  in both light and dark themes. No hard-coded hex values in components.
- New dependencies need a reason recorded in `docs/PLAN.md`. The brief asked
  for the most optimised design; prefer a few lines of own code over a package.

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
- Run `npm run check:tenancy` before every commit that touches SQL. It fails
  if a query on a tenant-scoped table omits `tenant_id`. Add a
  `-- tenancy-ok: <reason>` comment only for a deliberate exception, such as
  the login lookup that happens before any tenant is known.
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
- Schema changes in `src/lib/schema.ts` must stay idempotent (`CREATE ... IF
  NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` then
  re-add). There is no separate migration runner: the same statement list
  creates a fresh database and migrates the deployed one on every cold start.
