# Deployment

Target: **Neon** (Postgres) + **Vercel** (hosting) + **GitHub**
(`sps1590/office-management-system`).

There is no migration step. `src/lib/schema/` is an ordered list of idempotent
statements that runs once per server process on the first request, so pointing
the app at an empty database is all it takes to create one.

---

## 1. What needs a human, and why

Creating a Neon project and a Vercel project both require authorising against
those accounts. That authorisation cannot be automated from here — it is one
browser click each, and everything after it is scripted.

Run these two commands in a terminal **in the project folder**. Each opens a
browser page; approve it within 60 seconds.

```bash
npx neonctl auth
```

```bash
npx vercel login
```

## 2. Create the database

```bash
npx neonctl projects create --name office-management-system --region-id aws-ap-southeast-1
```

Then take the **pooled** connection string — the host containing `-pooler` —
which keeps serverless functions from exhausting connections:

```bash
npx neonctl connection-string --pooled
```

Put it in `.env.local` for local work:

```
DATABASE_URL="postgresql://…-pooler.…neon.tech/neondb?sslmode=require"
PLATFORM_ADMIN_IDENTIFIERS="sps1590@gmail.com"
TELEMETRY_TOKEN_SECRET="<a long random string>"
```

Check it locally before deploying — the first request creates every table:

```bash
npm run dev
```

Open `http://localhost:3000`, register a company, and the schema is built.

## 3. Create the Vercel project and deploy

```bash
npx vercel link --yes --project office-management-system
```

```bash
npx vercel env add DATABASE_URL production
```

Repeat `vercel env add` for `PLATFORM_ADMIN_IDENTIFIERS` and
`TELEMETRY_TOKEN_SECRET`, then:

```bash
npx vercel --prod
```

Afterwards, connect the GitHub repository in the Vercel dashboard
(Project → Settings → Git) so each push to `main` deploys automatically.

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
