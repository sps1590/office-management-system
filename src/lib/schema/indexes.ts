// Every index this application depends on, in one place so the access
// patterns are reviewable as a set.
//
// Rule of thumb applied: index the leading `tenant_id` of every list query,
// then the column that list is sorted or filtered by. A single-column index
// on tenant_id alone would be nearly useless — inside one tenant it matches
// everything.

export const INDEX_STATEMENTS: string[] = [
  // --- identity -----------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS users_tenant_idx ON users (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS users_manager_idx ON users (line_manager_id)`,
  `CREATE INDEX IF NOT EXISTS users_department_idx ON users (department_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)`,
  `CREATE INDEX IF NOT EXISTS departments_tenant_idx ON departments (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_tenant_time_idx
     ON audit_logs (tenant_id, created_at DESC)`,
  // The notification bell reads only unread rows for one user.
  `CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
     ON notifications (user_id, created_at DESC) WHERE read_at IS NULL`,

  // --- HR -----------------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS attendance_tenant_date_idx
     ON attendance_records (tenant_id, work_date DESC)`,
  `CREATE INDEX IF NOT EXISTS attendance_user_date_idx
     ON attendance_records (user_id, work_date DESC)`,
  `CREATE INDEX IF NOT EXISTS leave_requests_tenant_status_idx
     ON leave_requests (tenant_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS leave_requests_user_idx
     ON leave_requests (user_id, created_at DESC)`,
  // "What is waiting for me to approve" — the HR/manager inbox query.
  `CREATE INDEX IF NOT EXISTS leave_approvals_pending_idx
     ON leave_approvals (approver_id, decision) WHERE decision = 'pending'`,
  `CREATE INDEX IF NOT EXISTS payslips_user_idx ON payslips (user_id)`,
  `CREATE INDEX IF NOT EXISTS employee_profiles_tenant_idx
     ON employee_profiles (tenant_id)`,

  // --- fleet --------------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS vehicles_tenant_status_idx ON vehicles (tenant_id, status)`,
  // Booking overlap checks filter by vehicle and time window.
  `CREATE INDEX IF NOT EXISTS vehicle_bookings_vehicle_time_idx
     ON vehicle_bookings (vehicle_id, start_time, end_time)`,
  `CREATE INDEX IF NOT EXISTS vehicle_bookings_tenant_status_idx
     ON vehicle_bookings (tenant_id, status, start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS vehicle_bookings_driver_idx
     ON vehicle_bookings (driver_id, start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS trip_logs_vehicle_idx ON trip_logs (vehicle_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS vehicle_maintenance_due_idx
     ON vehicle_maintenance (tenant_id, status, scheduled_date)`,

  // --- procurement --------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS vendors_tenant_idx ON vendors (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS inventory_tenant_idx ON inventory_items (tenant_id, is_active)`,
  // Low-stock alerts: a partial index cannot reference another column, so
  // this supports the scan that compares the two.
  `CREATE INDEX IF NOT EXISTS inventory_reorder_idx
     ON inventory_items (tenant_id, current_stock, reorder_level)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_item_idx
     ON stock_movements (inventory_item_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS purchase_orders_tenant_status_idx
     ON purchase_orders (tenant_id, status, order_date DESC)`,
  `CREATE INDEX IF NOT EXISTS purchase_orders_vendor_idx ON purchase_orders (vendor_id)`,
  `CREATE INDEX IF NOT EXISTS po_items_po_idx ON purchase_order_items (purchase_order_id)`,
  `CREATE INDEX IF NOT EXISTS po_approvals_pending_idx
     ON po_approvals (approver_id, decision) WHERE decision = 'pending'`,
  `CREATE INDEX IF NOT EXISTS logistics_routes_tenant_status_idx
     ON logistics_routes (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS vendor_price_history_item_idx
     ON vendor_price_history (inventory_item_id, recorded_on DESC)`,

  // --- CRM ----------------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS clients_tenant_idx ON clients (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS clients_owner_idx ON clients (owner_id)`,
  `CREATE INDEX IF NOT EXISTS deals_tenant_stage_idx ON deals (tenant_id, stage_id)`,
  `CREATE INDEX IF NOT EXISTS deals_owner_idx ON deals (owner_id, status)`,
  `CREATE INDEX IF NOT EXISTS deal_activities_deal_idx
     ON deal_activities (deal_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS field_visits_user_idx
     ON field_visits (user_id, planned_for DESC)`,
  `CREATE INDEX IF NOT EXISTS field_visits_tenant_status_idx
     ON field_visits (tenant_id, status, planned_for DESC)`,

  // --- finance ------------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS journal_entries_tenant_date_idx
     ON journal_entries (tenant_id, entry_date DESC)`,
  `CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (journal_entry_id)`,
  `CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (account_id)`,
  `CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx
     ON invoices (tenant_id, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices (client_id)`,
  `CREATE INDEX IF NOT EXISTS bills_tenant_status_idx ON bills (tenant_id, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS payments_tenant_date_idx
     ON payments (tenant_id, paid_on DESC)`,
  `CREATE INDEX IF NOT EXISTS expense_claims_tenant_status_idx
     ON expense_claims (tenant_id, status, expense_date DESC)`,
  `CREATE INDEX IF NOT EXISTS expense_claims_user_idx
     ON expense_claims (user_id, expense_date DESC)`,

  // --- workplace ----------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS room_bookings_room_time_idx
     ON room_bookings (room_id, start_time, end_time)`,
  `CREATE INDEX IF NOT EXISTS room_bookings_tenant_time_idx
     ON room_bookings (tenant_id, start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS assets_tenant_status_idx ON assets (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS assets_assigned_idx ON assets (assigned_to)`,
  `CREATE INDEX IF NOT EXISTS visitors_tenant_time_idx
     ON visitors (tenant_id, checked_in_at DESC)`,
  `CREATE INDEX IF NOT EXISTS tasks_tenant_status_idx
     ON tasks (tenant_id, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assigned_to, status)`,
  `CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id)`,
  `CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at)`,

  // --- telemetry ----------------------------------------------------------
  // The hottest query in the system: "latest position for every active user
  // in this tenant", which the live operations map polls. DESC on the
  // timestamp lets Postgres walk one index backwards per user.
  `CREATE INDEX IF NOT EXISTS location_logs_tenant_user_time_idx
     ON location_logs (tenant_id, user_id, log_timestamp DESC)`,
  // Route playback for one day, and the retention purge, both scan this.
  `CREATE INDEX IF NOT EXISTS location_logs_tenant_time_idx
     ON location_logs (tenant_id, log_timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS geofence_events_tenant_time_idx
     ON geofence_events (tenant_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS geofence_assignments_user_idx
     ON geofence_assignments (user_id)`,
  `CREATE INDEX IF NOT EXISTS device_registrations_user_idx
     ON device_registrations (user_id, is_active)`,

  // --- platform -----------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS tenant_subscriptions_tenant_idx
     ON tenant_subscriptions (tenant_id, status)`,
];
