import { NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmail, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { enrolDevice } from "@/lib/telemetry";
import { allow, loginBucket } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

/**
 * POST /api/telemetry/enroll
 *
 * Called once by a mobile client at provisioning. Under MDM the credentials
 * arrive as managed app configuration, so nobody types them. Returns a
 * long-lived tracking token; only its hash is stored.
 *
 * This is the one place the system accepts a password outside the browser, so
 * it is rate limited on the same bucket as the web sign-in.
 */

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  device_id: z.string().trim().min(8).max(200),
  platform: z.enum(["android", "ios", "web"]).default("android"),
  model: z.string().trim().max(120).optional(),
  mdm_enrolled: z.boolean().optional(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid enrolment payload.", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400, headers: CORS }
    );
  }
  const d = parsed.data;

  if (!(await allow(loginBucket(d.email), 10, 600))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: CORS }
    );
  }

  const user = await findUserByEmail(d.email);
  // One generic answer for every failure mode, exactly as the web login does.
  if (!user || !verifyPassword(user, d.password) || user.status !== "active") {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401, headers: CORS });
  }

  const db = await getDb();
  const tenantRows = await db`
    SELECT status FROM tenants WHERE id = ${user.tenant_id}
  `;
  const status = (tenantRows[0] as { status: string } | undefined)?.status;
  if (status === "suspended" || status === "cancelled") {
    return NextResponse.json(
      { error: "This company's account is not active." },
      { status: 403, headers: CORS }
    );
  }

  const { token, intervalSeconds } = await enrolDevice({
    tenantId: user.tenant_id,
    userId: user.id,
    deviceId: d.device_id,
    platform: d.platform,
    model: d.model ?? null,
    mdmEnrolled: d.mdm_enrolled ?? false,
  });

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "device.enrolled",
    entity: "device_registration",
    summary: `Enrolled ${d.platform} device${d.mdm_enrolled ? " (MDM managed)" : ""}`,
    meta: { device_id: d.device_id, model: d.model },
  });

  return NextResponse.json(
    {
      tracking_token: token,
      user_id: user.id,
      tenant_id: user.tenant_id,
      interval_seconds: intervalSeconds,
      ingest_url: "/api/telemetry/locations",
    },
    { headers: CORS }
  );
}
