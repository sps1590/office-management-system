"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { distanceMeters } from "@/lib/geo";
import { nextDocNumber } from "@/lib/sequence";
import { audit, notify } from "@/lib/audit";
import type { ActionState } from "@/lib/types";

const nullable = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const nullableUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

const nullableCoord = (bound: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= -bound && v <= bound),
      `Must be between -${bound} and ${bound}`
    );

/* --- clients -------------------------------------------------------------- */

const clientSchema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(160),
  industry: nullable(80),
  contactPerson: nullable(120),
  email: nullable(160),
  phone: nullable(32),
  address: nullable(400),
  latitude: nullableCoord(90),
  longitude: nullableCoord(180),
  status: z.enum(["lead", "prospect", "active", "inactive", "churned"]),
  source: nullable(80),
  ownerId: nullableUuid,
});

export async function createClientAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("crm", "create");
  const parsed = clientSchema.safeParse({
    name: formData.get("name") ?? "",
    industry: formData.get("industry") ?? "",
    contactPerson: formData.get("contactPerson") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    latitude: formData.get("latitude") ?? "",
    longitude: formData.get("longitude") ?? "",
    status: formData.get("status") || "lead",
    source: formData.get("source") ?? "",
    ownerId: formData.get("ownerId") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();
  const code = await nextDocNumber(user.tenant_id, "client", "CLT");

  await db`
    INSERT INTO clients (tenant_id, client_code, name, industry, contact_person, email,
                         phone, address, latitude, longitude, owner_id, status, source)
    VALUES (${user.tenant_id}, ${code}, ${d.name}, ${d.industry}, ${d.contactPerson},
            ${d.email}, ${d.phone}, ${d.address}, ${d.latitude}, ${d.longitude},
            ${d.ownerId ?? user.id}, ${d.status}, ${d.source})
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "client.created",
    entity: "client",
    summary: `Added client ${d.name}`,
  });
  revalidatePath("/clients");
  return {
    success: `${d.name} added as ${code}.${
      d.latitude == null
        ? " Add coordinates later so field visits to this client can be verified."
        : ""
    }`,
  };
}

/* --- deals ---------------------------------------------------------------- */

const dealSchema = z.object({
  title: z.string().trim().min(2, "Give the deal a name").max(200),
  clientId: nullableUuid,
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  stageId: z.string().uuid("Choose a stage"),
  leadSource: nullable(80),
  ownerId: nullableUuid,
  expectedCloseDate: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  description: nullable(600),
});

export async function createDealAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("crm", "create");
  const parsed = dealSchema.safeParse({
    title: formData.get("title") ?? "",
    clientId: formData.get("clientId") ?? "",
    value: formData.get("value") || 0,
    stageId: formData.get("stageId"),
    leadSource: formData.get("leadSource") ?? "",
    ownerId: formData.get("ownerId") ?? "",
    expectedCloseDate: formData.get("expectedCloseDate") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  const stage = await db`
    SELECT id FROM pipeline_stages
     WHERE id = ${d.stageId} AND tenant_id = ${user.tenant_id}
  `;
  if (stage.length === 0) return { error: "That stage does not exist." };

  await db`
    INSERT INTO deals (tenant_id, client_id, title, description, value, currency, stage_id,
                       lead_source, owner_id, expected_close_date, status)
    VALUES (${user.tenant_id}, ${d.clientId}, ${d.title}, ${d.description}, ${d.value},
            ${user.tenant.currency}, ${d.stageId}, ${d.leadSource},
            ${d.ownerId ?? user.id}, ${d.expectedCloseDate}, 'open')
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "deal.created",
    entity: "deal",
    summary: `Created deal "${d.title}"`,
  });
  revalidatePath("/deals");
  return { success: `Deal "${d.title}" added to the pipeline.` };
}

/**
 * Moves a deal to another stage. Landing on a stage flagged won or lost closes
 * the deal, so the board and the deal's status can never disagree.
 */
export async function moveDealAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("crm", "edit");
  const parsed = z
    .object({ dealId: z.string().uuid(), stageId: z.string().uuid() })
    .safeParse({
      dealId: formData.get("dealId"),
      stageId: formData.get("stageId"),
    });
  if (!parsed.success) return { error: "Invalid request." };
  const db = await getDb();

  const stageRows = await db`
    SELECT id, name, is_won, is_lost FROM pipeline_stages
     WHERE id = ${parsed.data.stageId} AND tenant_id = ${user.tenant_id}
  `;
  const stage = stageRows[0] as
    | { id: string; name: string; is_won: boolean; is_lost: boolean }
    | undefined;
  if (!stage) return { error: "Stage not found." };

  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";

  const updated = await db`
    UPDATE deals
       SET stage_id = ${stage.id}, status = ${status},
           closed_at = ${status === "open" ? null : new Date().toISOString()},
           updated_at = now()
     WHERE id = ${parsed.data.dealId} AND tenant_id = ${user.tenant_id}
    RETURNING title, value::float AS value
  `;
  if (updated.length === 0) return { error: "Deal not found." };
  const deal = updated[0] as { title: string; value: number };

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "deal.moved",
    entity: "deal",
    entityId: parsed.data.dealId,
    summary: `Moved "${deal.title}" to ${stage.name}`,
    meta: { status, value: deal.value },
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { success: `Moved to ${stage.name}.` };
}

const activitySchema = z.object({
  dealId: nullableUuid,
  clientId: nullableUuid,
  activityType: z.enum(["call", "email", "meeting", "note", "visit", "demo", "proposal"]),
  subject: nullable(200),
  body: nullable(1000),
});

export async function logActivityAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("crm", "create");
  const parsed = activitySchema.safeParse({
    dealId: formData.get("dealId") ?? "",
    clientId: formData.get("clientId") ?? "",
    activityType: formData.get("activityType") || "note",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  if (!d.dealId && !d.clientId) {
    return { error: "Pick a deal or a client to log this against." };
  }
  const db = await getDb();

  await db`
    INSERT INTO deal_activities (tenant_id, deal_id, client_id, user_id, activity_type,
                                 subject, body)
    VALUES (${user.tenant_id}, ${d.dealId}, ${d.clientId}, ${user.id}, ${d.activityType},
            ${d.subject}, ${d.body})
  `;
  revalidatePath("/deals");
  return { success: "Activity logged." };
}

/* --- field visits --------------------------------------------------------- */

const visitSchema = z.object({
  clientId: nullableUuid,
  dealId: nullableUuid,
  purpose: z.string().trim().min(3, "Say what the visit is for").max(200),
  plannedFor: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  userId: nullableUuid,
});

export async function planVisitAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requirePermission("field", "create");
  const parsed = visitSchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    dealId: formData.get("dealId") ?? "",
    purpose: formData.get("purpose") ?? "",
    plannedFor: formData.get("plannedFor") ?? "",
    userId: formData.get("userId") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const d = parsed.data;
  const db = await getDb();

  // Only someone who can edit the module may assign a visit to another person.
  const assignee =
    d.userId && hasPermission(user, "field", "edit") ? d.userId : user.id;
  if (assignee !== user.id) {
    const owned = await db`
      SELECT 1 FROM users WHERE id = ${assignee} AND tenant_id = ${user.tenant_id}
    `;
    if (owned.length === 0) return { error: "Invalid assignee." };
  }

  const inserted = await db`
    INSERT INTO field_visits (tenant_id, user_id, client_id, deal_id, purpose, planned_for, status)
    VALUES (${user.tenant_id}, ${assignee}, ${d.clientId}, ${d.dealId}, ${d.purpose},
            ${d.plannedFor}, 'planned')
    RETURNING id
  `;
  if (assignee !== user.id) {
    await notify({
      tenantId: user.tenant_id,
      userId: assignee,
      title: "Field visit assigned",
      body: d.purpose,
      link: "/field-visits",
      entity: "field_visit",
      entityId: (inserted[0] as { id: string }).id,
    });
  }
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "visit.planned",
    entity: "field_visit",
    summary: `Planned visit: ${d.purpose}`,
  });
  revalidatePath("/field-visits");
  return { success: "Visit planned." };
}

/**
 * Proof of presence (SRS 3.2). Checking in stamps the coordinate and compares
 * it with the client's recorded location; `verified` and the distance are set
 * by the server, so a rep cannot assert they were on site.
 */
export async function checkInVisitAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const visitId = String(formData.get("visitId") ?? "");
  const lat = Number(formData.get("latitude") ?? NaN);
  const lng = Number(formData.get("longitude") ?? NaN);
  const db = await getDb();

  const rows = await db`
    SELECT fv.id, fv.user_id, fv.status, c.latitude::float AS client_lat,
           c.longitude::float AS client_lng, c.name AS client_name
      FROM field_visits fv
      LEFT JOIN clients c ON c.id = fv.client_id
     WHERE fv.id = ${visitId} AND fv.tenant_id = ${user.tenant_id}
  `;
  const visit = rows[0] as
    | {
        id: string;
        user_id: string;
        status: string;
        client_lat: number | null;
        client_lng: number | null;
        client_name: string | null;
      }
    | undefined;
  if (!visit) return { error: "Visit not found." };
  if (visit.user_id !== user.id && !hasPermission(user, "field", "edit")) {
    return { error: "This visit is assigned to someone else." };
  }
  if (visit.status !== "planned") return { error: "This visit is already under way." };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Location is required to check in. Allow location access and retry." };
  }

  let verified = false;
  let distance: number | null = null;
  if (visit.client_lat != null && visit.client_lng != null) {
    distance = Math.round(
      distanceMeters(
        { latitude: lat, longitude: lng },
        { latitude: visit.client_lat, longitude: visit.client_lng }
      )
    );
    // 500 m allows for GPS drift in a built-up area and for a client address
    // pin that sits on the street rather than inside the building.
    verified = distance <= 500;
  }

  await db`
    UPDATE field_visits
       SET checked_in_at = now(), check_in_lat = ${lat}, check_in_lng = ${lng},
           status = 'in_progress', verified = ${verified},
           verification_distance_m = ${distance}
     WHERE id = ${visitId} AND tenant_id = ${user.tenant_id}
  `;
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "visit.checked_in",
    entity: "field_visit",
    entityId: visitId,
    summary: `Checked in at ${visit.client_name ?? "a visit"}${
      distance != null ? ` (${distance} m from the recorded address)` : ""
    }`,
    meta: { lat, lng, verified, distance },
  });

  revalidatePath("/field-visits");
  return {
    success:
      distance == null
        ? "Checked in. This client has no recorded coordinates, so the visit cannot be verified."
        : verified
          ? `Checked in and verified — ${distance} m from the recorded address.`
          : `Checked in, but ${distance} m from the recorded address, so it is flagged unverified.`,
  };
}

export async function checkOutVisitAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const visitId = String(formData.get("visitId") ?? "");
  const outcome = String(formData.get("outcome") ?? "").slice(0, 200) || null;
  const notes = String(formData.get("notes") ?? "").slice(0, 1000) || null;
  const lat = Number(formData.get("latitude") ?? NaN);
  const lng = Number(formData.get("longitude") ?? NaN);
  const db = await getDb();

  const rows = await db`
    SELECT id, user_id, status, client_id, deal_id, purpose FROM field_visits
     WHERE id = ${visitId} AND tenant_id = ${user.tenant_id}
  `;
  const visit = rows[0] as
    | {
        id: string;
        user_id: string;
        status: string;
        client_id: string | null;
        deal_id: string | null;
        purpose: string;
      }
    | undefined;
  if (!visit) return { error: "Visit not found." };
  if (visit.user_id !== user.id && !hasPermission(user, "field", "edit")) {
    return { error: "This visit is assigned to someone else." };
  }
  if (visit.status !== "in_progress") return { error: "This visit is not in progress." };

  await db`
    UPDATE field_visits
       SET checked_out_at = now(),
           check_out_lat = ${Number.isFinite(lat) ? lat : null},
           check_out_lng = ${Number.isFinite(lng) ? lng : null},
           outcome = ${outcome}, notes = ${notes}, status = 'completed'
     WHERE id = ${visitId} AND tenant_id = ${user.tenant_id}
  `;

  // The visit becomes a CRM activity so the client's history is complete
  // without the rep writing it twice.
  await db`
    INSERT INTO deal_activities (tenant_id, deal_id, client_id, user_id, activity_type,
                                 subject, body)
    VALUES (${user.tenant_id}, ${visit.deal_id}, ${visit.client_id}, ${user.id}, 'visit',
            ${visit.purpose}, ${outcome ?? notes})
  `;

  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "visit.completed",
    entity: "field_visit",
    entityId: visitId,
    summary: `Completed visit: ${visit.purpose}`,
  });
  revalidatePath("/field-visits");
  return { success: "Visit closed and logged against the client." };
}
