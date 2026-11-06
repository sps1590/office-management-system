import "server-only";
import { getDb } from "./db";
import { calendarBounds } from "./utils";

/* --- vendors -------------------------------------------------------------- */

export type Vendor = {
  id: string;
  company_name: string;
  vendor_code: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  rating: number;
  payment_terms: string | null;
  status: string;
  order_count: number;
  total_spend: number;
};

export async function listVendors(
  tenantId: string,
  filters: { q?: string; status?: string } = {}
): Promise<Vendor[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT v.id, v.company_name, v.vendor_code, v.contact_person, v.email, v.phone,
           v.category, v.rating::float AS rating, v.payment_terms, v.status,
           (SELECT COUNT(*)::int FROM purchase_orders po
             WHERE po.vendor_id = v.id AND po.tenant_id = ${tenantId}) AS order_count,
           COALESCE((SELECT SUM(po.total_amount) FROM purchase_orders po
             WHERE po.vendor_id = v.id AND po.tenant_id = ${tenantId}
               AND po.status IN ('approved','partially_received','received')), 0)::float AS total_spend
      FROM vendors v
     WHERE v.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR v.company_name ILIKE ${q} OR v.contact_person ILIKE ${q}
            OR v.category ILIKE ${q})
       AND (${filters.status ?? null}::text IS NULL OR v.status = ${filters.status ?? null})
     ORDER BY v.company_name
  `;
  return rows as unknown as Vendor[];
}

export async function vendorOptions(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT id, company_name FROM vendors
     WHERE tenant_id = ${tenantId} AND status = 'active'
     ORDER BY company_name
  `;
  return rows as unknown as { id: string; company_name: string }[];
}

/* --- inventory ------------------------------------------------------------ */

export type InventoryItem = {
  id: string;
  sku: string;
  item_name: string;
  category: string | null;
  unit: string;
  current_stock: number;
  reorder_level: number;
  reorder_quantity: number;
  unit_cost: number;
  warehouse_id: string | null;
  warehouse_name: string | null;
  bin_location: string | null;
  is_active: boolean;
  stock_value: number;
};

export async function listInventory(
  tenantId: string,
  filters: { q?: string; warehouseId?: string; lowOnly?: boolean } = {}
): Promise<InventoryItem[]> {
  const db = await getDb();
  const q = filters.q?.trim() ? `%${filters.q.trim()}%` : null;
  const rows = await db`
    SELECT i.id, i.sku, i.item_name, i.category, i.unit,
           i.current_stock::float AS current_stock,
           i.reorder_level::float AS reorder_level,
           i.reorder_quantity::float AS reorder_quantity,
           i.unit_cost::float AS unit_cost,
           i.warehouse_id, i.bin_location, i.is_active,
           (i.current_stock * i.unit_cost)::float AS stock_value,
           w.name AS warehouse_name
      FROM inventory_items i
      LEFT JOIN warehouses w ON w.id = i.warehouse_id
     WHERE i.tenant_id = ${tenantId}
       AND (${q}::text IS NULL OR i.item_name ILIKE ${q} OR i.sku ILIKE ${q}
            OR i.category ILIKE ${q})
       AND (${filters.warehouseId ?? null}::uuid IS NULL OR i.warehouse_id = ${filters.warehouseId ?? null}::uuid)
       AND (${filters.lowOnly ?? false}::boolean = FALSE OR i.current_stock <= i.reorder_level)
     ORDER BY (i.current_stock <= i.reorder_level) DESC, i.item_name
  `;
  return rows as unknown as InventoryItem[];
}

export async function inventoryStats(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT COUNT(*)::int                                               AS items,
           COUNT(*) FILTER (WHERE current_stock <= reorder_level)::int  AS low_stock,
           COUNT(*) FILTER (WHERE current_stock = 0)::int               AS out_of_stock,
           COALESCE(SUM(current_stock * unit_cost), 0)::float           AS stock_value
      FROM inventory_items WHERE tenant_id = ${tenantId} AND is_active = TRUE
  `;
  return rows[0] as {
    items: number;
    low_stock: number;
    out_of_stock: number;
    stock_value: number;
  };
}

export async function listWarehouses(tenantId: string) {
  const db = await getDb();
  const rows = await db`
    SELECT w.id, w.name, w.code, w.address, w.latitude::float AS latitude,
           w.longitude::float AS longitude, w.is_active,
           (SELECT COUNT(*)::int FROM inventory_items i
             WHERE i.warehouse_id = w.id AND i.tenant_id = ${tenantId}) AS item_count
      FROM warehouses w
     WHERE w.tenant_id = ${tenantId}
     ORDER BY w.name
  `;
  return rows as unknown as {
    id: string;
    name: string;
    code: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    is_active: boolean;
    item_count: number;
  }[];
}

export async function stockMovements(tenantId: string, itemId?: string, limit = 60) {
  const db = await getDb();
  const rows = await db`
    SELECT sm.id, sm.movement_type, sm.quantity::float AS quantity,
           sm.reference_type, sm.batch_number, sm.note, sm.created_at,
           i.item_name, i.unit, u.full_name AS created_by_name
      FROM stock_movements sm
      JOIN inventory_items i ON i.id = sm.inventory_item_id
      LEFT JOIN users u      ON u.id = sm.created_by
     WHERE sm.tenant_id = ${tenantId}
       AND (${itemId ?? null}::uuid IS NULL OR sm.inventory_item_id = ${itemId ?? null}::uuid)
     ORDER BY sm.created_at DESC
     LIMIT ${limit}
  `;
  return rows as unknown as {
    id: string;
    movement_type: string;
    quantity: number;
    reference_type: string | null;
    batch_number: string | null;
    note: string | null;
    created_at: string;
    item_name: string;
    unit: string;
    created_by_name: string | null;
  }[];
}

/* --- purchase orders ------------------------------------------------------ */

export type PurchaseOrder = {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  warehouse_name: string | null;
  requester_name: string | null;
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  subtotal: number;
  tax_amount: number;
  shipping_amount: number;
  total_amount: number;
  status: string;
  current_tier: number;
  total_tiers: number;
  notes: string | null;
  item_count: number;
  awaiting_name: string | null;
  awaiting_id: string | null;
};

export async function listPurchaseOrders(
  tenantId: string,
  filters: { status?: string; vendorId?: string; awaitingUserId?: string } = {}
): Promise<PurchaseOrder[]> {
  const db = await getDb();
  const rows = await db`
    SELECT po.id, po.po_number, po.vendor_id, po.order_date, po.expected_date,
           po.received_date, po.subtotal::float AS subtotal,
           po.tax_amount::float AS tax_amount,
           po.shipping_amount::float AS shipping_amount,
           po.total_amount::float AS total_amount,
           po.status, po.current_tier, po.total_tiers, po.notes,
           v.company_name AS vendor_name,
           w.name AS warehouse_name,
           rq.full_name AS requester_name,
           (SELECT COUNT(*)::int FROM purchase_order_items pi
             WHERE pi.purchase_order_id = po.id) AS item_count,
           aw.full_name AS awaiting_name, aw.id AS awaiting_id
      FROM purchase_orders po
      JOIN vendors v          ON v.id = po.vendor_id
      LEFT JOIN warehouses w  ON w.id = po.warehouse_id
      LEFT JOIN users rq      ON rq.id = po.requested_by
      LEFT JOIN po_approvals pa
             ON pa.purchase_order_id = po.id AND pa.tier = po.current_tier
            AND po.status = 'pending'
      LEFT JOIN users aw      ON aw.id = pa.approver_id
     WHERE po.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR po.status = ${filters.status ?? null})
       AND (${filters.vendorId ?? null}::uuid IS NULL OR po.vendor_id = ${filters.vendorId ?? null}::uuid)
       AND (${filters.awaitingUserId ?? null}::uuid IS NULL
            OR (po.status = 'pending' AND pa.approver_id = ${filters.awaitingUserId ?? null}::uuid
                AND pa.decision = 'pending'))
     ORDER BY po.order_date DESC, po.po_number DESC
     LIMIT 200
  `;
  return rows as unknown as PurchaseOrder[];
}

export async function getPurchaseOrder(tenantId: string, poId: string) {
  const db = await getDb();
  const [header, items, approvals] = await Promise.all([
    db`
      SELECT po.*, po.subtotal::float AS subtotal, po.tax_amount::float AS tax_amount,
             po.shipping_amount::float AS shipping_amount,
             po.total_amount::float AS total_amount,
             v.company_name AS vendor_name, v.email AS vendor_email,
             v.phone AS vendor_phone, w.name AS warehouse_name,
             rq.full_name AS requester_name
        FROM purchase_orders po
        JOIN vendors v         ON v.id = po.vendor_id
        LEFT JOIN warehouses w ON w.id = po.warehouse_id
        LEFT JOIN users rq     ON rq.id = po.requested_by
       WHERE po.tenant_id = ${tenantId} AND po.id = ${poId}
    `,
    db`
      SELECT pi.id, pi.description, pi.quantity::float AS quantity,
             pi.received_quantity::float AS received_quantity,
             pi.unit_price::float AS unit_price, pi.line_total::float AS line_total,
             i.item_name, i.sku, i.unit
        FROM purchase_order_items pi
        LEFT JOIN inventory_items i ON i.id = pi.inventory_item_id
       WHERE pi.tenant_id = ${tenantId} AND pi.purchase_order_id = ${poId}
       ORDER BY pi.sort_order, pi.id
    `,
    db`
      SELECT pa.tier, pa.decision, pa.comments, pa.decided_at, pa.approver_role,
             pa.threshold_amount::float AS threshold_amount,
             u.full_name AS approver_name
        FROM po_approvals pa
        LEFT JOIN users u ON u.id = pa.approver_id
       WHERE pa.tenant_id = ${tenantId} AND pa.purchase_order_id = ${poId}
       ORDER BY pa.tier
    `,
  ]);

  const po = header[0] as Record<string, unknown> | undefined;
  if (!po) return null;
  return {
    header: po as unknown as PurchaseOrder & {
      vendor_email: string | null;
      vendor_phone: string | null;
      terms: string | null;
      currency: string;
    },
    items: items as unknown as {
      id: string;
      description: string;
      quantity: number;
      received_quantity: number;
      unit_price: number;
      line_total: number;
      item_name: string | null;
      sku: string | null;
      unit: string | null;
    }[],
    approvals: approvals as unknown as {
      tier: number;
      decision: string;
      comments: string | null;
      decided_at: string | null;
      approver_role: string | null;
      threshold_amount: number | null;
      approver_name: string | null;
    }[],
  };
}

export async function procurementStats(tenantId: string, timeZone: string) {
  const db = await getDb();
  const cal = calendarBounds(timeZone);
  const rows = await db`
    SELECT COUNT(*) FILTER (WHERE status = 'draft')::int     AS draft,
           COUNT(*) FILTER (WHERE status = 'pending')::int    AS pending,
           COUNT(*) FILTER (WHERE status = 'approved')::int    AS approved,
           COUNT(*) FILTER (WHERE status IN ('received','partially_received'))::int AS received,
           COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending'), 0)::float  AS pending_value,
           COALESCE(SUM(total_amount) FILTER (WHERE status IN ('approved','partially_received','received')
             AND order_date >= ${cal.yearStart}::date), 0)::float         AS committed_ytd
      FROM purchase_orders WHERE tenant_id = ${tenantId}
  `;
  return rows[0] as {
    draft: number;
    pending: number;
    approved: number;
    received: number;
    pending_value: number;
    committed_ytd: number;
  };
}

/** Spend by vendor for the current year — the procurement concentration view. */
export async function spendByVendor(tenantId: string, timeZone: string, limit = 8) {
  const db = await getDb();
  const cal = calendarBounds(timeZone);
  const rows = await db`
    SELECT v.company_name AS label,
           COALESCE(SUM(po.total_amount), 0)::float AS value
      FROM purchase_orders po
      JOIN vendors v ON v.id = po.vendor_id
     WHERE po.tenant_id = ${tenantId}
       AND po.status IN ('approved','partially_received','received')
       AND po.order_date >= ${cal.yearStart}::date
     GROUP BY v.company_name
     ORDER BY value DESC
     LIMIT ${limit}
  `;
  return rows as unknown as { label: string; value: number }[];
}

/* --- logistics ------------------------------------------------------------ */

export async function listLogisticsRoutes(
  tenantId: string,
  filters: { status?: string } = {}
) {
  const db = await getDb();
  const rows = await db`
    SELECT lr.id, lr.reference, lr.destination, lr.destination_lat::float AS destination_lat,
           lr.destination_lng::float AS destination_lng, lr.status,
           lr.planned_departure, lr.planned_arrival, lr.actual_departure,
           lr.actual_arrival, lr.distance_km::float AS distance_km, lr.notes,
           po.po_number, v.registration_number, d.full_name AS driver_name,
           w.name AS origin_name
      FROM logistics_routes lr
      LEFT JOIN purchase_orders po ON po.id = lr.purchase_order_id
      LEFT JOIN vehicles v         ON v.id = lr.assigned_vehicle_id
      LEFT JOIN users d            ON d.id = lr.driver_id
      LEFT JOIN warehouses w       ON w.id = lr.origin_warehouse_id
     WHERE lr.tenant_id = ${tenantId}
       AND (${filters.status ?? null}::text IS NULL OR lr.status = ${filters.status ?? null})
     ORDER BY COALESCE(lr.planned_departure, lr.created_at) DESC
     LIMIT 200
  `;
  return rows as unknown as {
    id: string;
    reference: string | null;
    destination: string | null;
    destination_lat: number | null;
    destination_lng: number | null;
    status: string;
    planned_departure: string | null;
    planned_arrival: string | null;
    actual_departure: string | null;
    actual_arrival: string | null;
    distance_km: number | null;
    notes: string | null;
    po_number: string | null;
    registration_number: string | null;
    driver_name: string | null;
    origin_name: string | null;
  }[];
}
