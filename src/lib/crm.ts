import "server-only";
import { getDb } from "./db";

export type Client = {
  id: string;
  client_code: string | null;
  name: string;
  industry: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  source: string | null;
  deal_count: number;
  open_value: number;
};

export type Deal = {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  value: number;
  stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  probability: number;
  lead_source: string | null;
  owner_id: string | null;
  owner_name: string | null;
  expected_close_date: string | null;
  status: string;
  closed_at: string | null;
  activity_count: number;
};

export async function listClients(
  tenantId: string,
  filters: { q?: string; status?: string; ownerId?: string } = {}
): Promise<Client[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT c.id, c.client_code, c.name, c.industry, c.contact_person, c.email, c.phone,
           c.address, c.latitude::float AS latitude, c.longitude::float AS longitude,
           c.owner_id, c.status, c.source,
           o.full_name AS owner_name,
           (SELECT COUNT(*)::int FROM deals d
             WHERE d.client_id = c.id AND d.tenant_id = ${tenantId}) AS deal_count,
           COALESCE((SELECT SUM(d.value) FROM deals d
             WHERE d.client_id = c.id AND d.tenant_id = ${tenantId}
               AND d.status = 'open'), 0)::float AS open_value
      FROM clients c
      LEFT JOIN users o ON o.id = c.owner_id
     WHERE c.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR c.name ILIKE ${q} OR c.contact_person ILIKE ${q}
            OR c.industry ILIKE ${q} OR c.email ILIKE ${q})
       AND (${filters.status ?? null}::text IS NULL OR c.status = ${filters.status ?? null})
       AND (${filters.ownerId ?? null}::uuid IS NULL OR c.owner_id = ${filters.ownerId ?? null}::uuid)
     ORDER BY c.name
  `;
  return rows as unknown as Client[];
}

export async function clientOptions(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, name, latitude::float AS latitude, longitude::float AS longitude
      FROM clients WHERE tenant_id = ${tenantId}
     ORDER BY name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  }[];
}

export async function listStages(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, key, name, sort_order, probability, is_won, is_lost, color
      FROM pipeline_stages WHERE tenant_id = ${tenantId}
     ORDER BY sort_order
  `;
  return rows as unknown as {
    id: string;
    key: string;
    name: string;
    sort_order: number;
    probability: number;
    is_won: boolean;
    is_lost: boolean;
    color: string;
  }[];
}

export async function listDeals(
  tenantId: string,
  filters: { status?: string; ownerId?: string; clientId?: string } = {}
): Promise<Deal[]> {
  const db = await getDb();
  const rows = await db`
    SELECT d.id, d.title, d.client_id, d.value::float AS value, d.stage_id,
           d.lead_source, d.owner_id, d.expected_close_date, d.status, d.closed_at,
           c.name AS client_name,
           s.name AS stage_name, s.color AS stage_color, s.probability,
           o.full_name AS owner_name,
           (SELECT COUNT(*)::int FROM deal_activities a
             WHERE a.deal_id = d.id AND a.tenant_id = ${tenantId}) AS activity_count
      FROM deals d
      LEFT JOIN clients c         ON c.id = d.client_id
      LEFT JOIN pipeline_stages s ON s.id = d.stage_id
      LEFT JOIN users o           ON o.id = d.owner_id
     WHERE d.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR d.status = ${filters.status ?? null})
       AND (${filters.ownerId ?? null}::uuid IS NULL OR d.owner_id = ${filters.ownerId ?? null}::uuid)
       AND (${filters.clientId ?? null}::uuid IS NULL OR d.client_id = ${filters.clientId ?? null}::uuid)
     ORDER BY s.sort_order NULLS LAST, d.value DESC
     LIMIT 400
  `;
  return rows as unknown as Deal[];
}

export async function crmStats(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status = 'open')::int                          AS open_deals,
           COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)::float          AS open_value,
           COALESCE(SUM(value) FILTER (WHERE status = 'won'
             AND closed_at >= date_trunc('month', CURRENT_DATE)), 0)::float        AS won_month,
           COALESCE(SUM(value) FILTER (WHERE status = 'won'
             AND closed_at >= date_trunc('year', CURRENT_DATE)), 0)::float         AS won_year,
           COUNT(*) FILTER (WHERE status = 'won')::int                            AS won_count,
           COUNT(*) FILTER (WHERE status = 'lost')::int                           AS lost_count
      FROM deals WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    open_deals: number;
    open_value: number;
    won_month: number;
    won_year: number;
    won_count: number;
    lost_count: number;
  };
}

/** Open value per stage, for the pipeline funnel chart. */
export async function pipelineByStage(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT s.name AS label, s.color,
           COALESCE(SUM(d.value) FILTER (WHERE d.status = 'open'), 0)::float AS value
      FROM pipeline_stages s
      LEFT JOIN deals d ON d.stage_id = s.id AND d.tenant_id = ${tenantId}
     WHERE s.tenant_id = ${tenantId} AND s.is_won = FALSE AND s.is_lost = FALSE
     GROUP BY s.name, s.color, s.sort_order
     ORDER BY s.sort_order
  `;
  return rows as unknown as { label: string; color: string; value: number }[];
}

export async function dealActivities(tenantId: string, limit = 20) {
  const db = await getDb();
  const rows = await db`
    SELECT a.id, a.activity_type, a.subject, a.body, a.occurred_at,
           d.title AS deal_title, c.name AS client_name, u.full_name AS user_name
      FROM deal_activities a
      LEFT JOIN deals d   ON d.id = a.deal_id
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN users u   ON u.id = a.user_id
     WHERE a.tenant_id = ${tenantId}
     ORDER BY a.occurred_at DESC
     LIMIT ${limit}
  `;
  return rows as unknown as {
    id: string;
    activity_type: string;
    subject: string | null;
    body: string | null;
    occurred_at: string;
    deal_title: string | null;
    client_name: string | null;
    user_name: string | null;
  }[];
}

/* --- field visits --------------------------------------------------------- */

export type FieldVisit = {
  id: string;
  user_id: string;
  user_name: string;
  client_id: string | null;
  client_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
  purpose: string;
  planned_for: string | null;
  checked_in_at: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  checked_out_at: string | null;
  outcome: string | null;
  notes: string | null;
  status: string;
  verified: boolean;
  verification_distance_m: number | null;
};

export async function listFieldVisits(
  tenantId: string,
  filters: { userId?: string; status?: string } = {}
): Promise<FieldVisit[]> {
  const db = await getDb();
  const rows = await db`
    SELECT fv.id, fv.user_id, fv.client_id, fv.deal_id, fv.purpose, fv.planned_for,
           fv.checked_in_at, fv.check_in_lat::float AS check_in_lat,
           fv.check_in_lng::float AS check_in_lng, fv.checked_out_at,
           fv.outcome, fv.notes, fv.status, fv.verified,
           fv.verification_distance_m::float AS verification_distance_m,
           u.full_name AS user_name, c.name AS client_name, d.title AS deal_title
      FROM field_visits fv
      JOIN users u        ON u.id = fv.user_id
      LEFT JOIN clients c ON c.id = fv.client_id
      LEFT JOIN deals d   ON d.id = fv.deal_id
     WHERE fv.tenant_id = ${tenantId}
       AND (${filters.userId ?? null}::uuid IS NULL OR fv.user_id = ${filters.userId ?? null}::uuid)
       AND (${filters.status ?? null}::text IS NULL OR fv.status = ${filters.status ?? null})
     ORDER BY COALESCE(fv.checked_in_at, fv.planned_for, fv.created_at) DESC
     LIMIT 200
  `;
  return rows as unknown as FieldVisit[];
}

export async function visitStats(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status = 'planned')::int    AS planned,
           COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
           COUNT(*) FILTER (WHERE status = 'completed'
             AND checked_in_at >= date_trunc('month', CURRENT_DATE))::int AS completed_month,
           COUNT(*) FILTER (WHERE status = 'completed' AND verified = TRUE
             AND checked_in_at >= date_trunc('month', CURRENT_DATE))::int AS verified_month
      FROM field_visits WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    planned: number;
    in_progress: number;
    completed_month: number;
    verified_month: number;
  };
}
