# Deployment

Target: **Neon** (Postgres) + **Vercel** (hosting) + **GitHub**
(`sps1590/office-management-system`).

There is no migration step. `src/lib/schema/` is an ordered list of idempotent
statements that runs once per server process on the first request, so pointing
the app at an empty database is all it takes to create one.

---

## 1. This deployment is already provisioned

Done on 2026-11-05. This section records what was actually run, so it can be
reproduced or repaired.

| Thing | Value |
|---|---|
| Vercel team | `sps-a983` (SPS) |
| Vercel project | `office-management-system` |
| Neon org | `org-fragrant-queen-99830599` — **managed by Vercel** |
| Neon resource | `office-management-system-db`, region `sin1` (Singapore) |
| GitHub | `sps1590/office-management-system`, connected for push-to-deploy |
| **Production URL** | `https://office-management-system-sps-a983.vercel.app` |

### Two things to know about the URL

**Do not use `https://office-management-system.vercel.app`.** That bare
subdomain belongs to an unrelated create-react-app owned by someone else —
`.vercel.app` subdomains are global and first-come-first-served. It returns
`200` for every path, so a smoke test pointed at it will appear to pass while
testing a stranger's site. The team-scoped URL above is this project's.

**Vercel Deployment Protection is currently ON**, so every request to the
production URL redirects to Vercel SSO and the app is unreachable by the
public. The deployment itself is healthy — verified with
`npx vercel curl <url>`, which authenticates using the CLI session:

```bash
npx -y vercel@latest curl https://office-management-system-sps-a983.vercel.app/
```

To open it to the public: Vercel dashboard → the project → **Settings** →
**Deployment Protection** → turn **Vercel Authentication** off for Production.
Leaving it on for Preview deployments is sensible; leaving it on for Production
means nobody can sign up.

**The important constraint:** the Neon organisation is managed through the
Vercel integration, so the Neon CLI cannot create projects in it —
`neon projects create` fails with
`action restricted; reason:"organization is managed by Vercel"`. Databases must
be provisioned from the Vercel side, which also means Vercel owns the
connection env vars and injects them into every deployment. That is a feature,
not a workaround: there is no connection string to copy by hand.

## 2. Reproducing it from scratch

One browser sign-in is needed; everything else is scripted.

```bash
npx -y vercel@latest login
```

Create and link the project. This also connects the GitHub remote it finds in
`git remote -v`, so push-to-deploy needs no dashboard step:

```bash
npx -y vercel@latest link --yes --project office-management-system --scope sps-a983
```

Provision Postgres through the Neon marketplace integration. It creates the
database, connects it to all three environments and pulls the vars into
`.env.local`:

```bash
npx -y vercel@latest integration add neon --name office-management-system-db --meta region=sin1
```

That writes `DATABASE_URL` (pooled, `sslmode=require`) plus
`DATABASE_URL_UNPOOLED`, the `PG*` set and the `POSTGRES_*` set. This app uses
`DATABASE_URL` only; the rest are the integration's conventions for other
frameworks and can be ignored.

Add the two variables the integration does not manage:

```bash
printf '%s' 'you@example.com' | npx -y vercel@latest env add PLATFORM_ADMIN_IDENTIFIERS production
```

Repeat for `preview` and `development`, and for `TELEMETRY_TOKEN_SECRET`
(any long random string — generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).

## 3. Build the schema

The schema is created on the first request that actually reads the database.
Note that **loading the landing page or `/login` is not enough**: with no
session cookie, `getSessionUser()` returns before it opens a connection. Either
register a company through the UI, or poke an endpoint that always queries:

```bash
curl -X POST http://localhost:3001/api/telemetry/locations -H "Authorization: Bearer $(node -e "console.log('x'.repeat(48))")" -H "Content-Type: application/json" -d "{\"latitude\":23.81,\"longitude\":90.41}"
```

It answers `401` once the schema exists, which is the success signal here. The
first call takes 10–15 seconds while 62 tables, 158 indexes and 521 constraints
are created; afterwards it is milliseconds.

Then verify:

```bash
npm run check
```

```bash
npm run build
```

## 4. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection string |
| `PLATFORM_ADMIN_IDENTIFIERS` | no | Comma-separated emails that get Super Admin at `/platform`. Unset means nobody has it. Re-applied on every cold start, so removing an email revokes it |
| `TELEMETRY_TOKEN_SECRET` | no | Reserved for signing mobile tracking tokens. Tokens are currently random and stored as SHA-256 hashes, so this is not yet read |
| `NEXT_PUBLIC_APP_URL` | no | Public base URL, used in the PWA manifest |

Never commit a filled-in `.env.local`; `.gitignore` already excludes it.

## 5. First-run checklist

1. Open the deployment URL → the landing page appears.
2. **Register your company** → you become its Company Admin, and the workspace
   is created with ten roles, a chart of accounts, leave types and a sales
   pipeline.
3. **Company settings** → set the work start time, standard day, overtime
   multiplier and the purchase-order approval thresholds.
4. **GPS & geofences** → create an office geofence at your real coordinates,
   then turn on "require a location inside an office geofence to check in" if
   you want attendance gated by location.
5. **Employees** → add staff. Each gets a temporary password shown to you once;
   pass it to them directly and have them change it under *My profile*.
6. **Users & roles** → assign roles and adjust the permission matrix.
7. Open `/tracker` on a phone and press **Start tracking** → positions appear
   on the live operations map within a minute.

## 6. Verifying the deployment

```bash
npm run build
```

```bash
npm run check:tenancy
```

The second one must print *"every tenant-scoped query filters by tenant_id"*.
It is the mechanical check on the multi-tenant isolation boundary and should be
run before every commit that touches SQL.

Smoke test against the live URL: register a company, check in on the
dashboard, raise a purchase order and submit it for approval, create an
invoice, then confirm the trial balance on `/finance` is balanced.

## 7. Operating notes

- **Cold starts** run the schema statement list and the platform seeds. That
  costs a few hundred milliseconds on the first request after an idle period,
  and nothing afterwards.
- **Neon free tier** suspends compute when idle; the first request after that
  takes a second or two to wake it.
- **Backups**: Neon keeps point-in-time history on its own schedule. The audit
  log in-app is a record of changes, not a backup.
- **Telemetry growth** is the only table that grows without bound. A device
  reporting every 60 seconds for a 10-hour shift writes ~600 rows a day. The
  retention purge on `/tracking` applies the tenant's retention limit.
