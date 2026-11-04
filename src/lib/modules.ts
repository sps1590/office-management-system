// The permission vocabulary, and the ten system roles of SRS section 2.
//
// Shared by the server (permission gates) and the client (the permission
// matrix editor and the sidebar), so this file must stay free of any
// server-only import.

export const MODULES = [
  "mis",
  "employees",
  "attendance",
  "leave",
  "payroll",
  "fleet",
  "logistics",
  "vendors",
  "inventory",
  "procurement",
  "crm",
  "field",
  "finance",
  "invoicing",
  "expenses",
  "facilities",
  "assets",
  "tasks",
  "tracking",
  "reports",
  "users",
  "settings",
  "audit",
] as const;

export type Module = (typeof MODULES)[number];

export const PERM_ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type PermAction = (typeof PERM_ACTIONS)[number];

export type ModulePermissions = Record<PermAction, boolean>;
/** What is stored in `roles.permissions_matrix`. Absent means denied. */
export type PermissionsMatrix = Partial<Record<Module, Partial<ModulePermissions>>>;

export const MODULE_LABELS: Record<Module, string> = {
  mis: "Executive MIS",
  employees: "Employee directory",
  attendance: "Attendance",
  leave: "Leave",
  payroll: "Payroll",
  fleet: "Fleet & vehicles",
  logistics: "Logistics routes",
  vendors: "Vendors",
  inventory: "Inventory",
  procurement: "Purchase orders",
  crm: "Clients & deals",
  field: "Field visits",
  finance: "General ledger",
  invoicing: "Invoices & bills",
  expenses: "Expense claims",
  facilities: "Rooms & visitors",
  assets: "Asset register",
  tasks: "Tasks & projects",
  tracking: "GPS tracking",
  reports: "Reports",
  users: "User accounts",
  settings: "Company settings",
  audit: "Audit log",
};

/** Groups the permission-matrix editor and the sidebar both render. */
export const MODULE_GROUPS: { label: string; modules: Module[] }[] = [
  { label: "Management", modules: ["mis", "reports", "tracking", "audit"] },
  { label: "People", modules: ["employees", "attendance", "leave", "payroll"] },
  { label: "Fleet", modules: ["fleet", "logistics"] },
  { label: "Supply chain", modules: ["vendors", "inventory", "procurement"] },
  { label: "Revenue", modules: ["crm", "field"] },
  { label: "Finance", modules: ["finance", "invoicing", "expenses"] },
  { label: "Workplace", modules: ["facilities", "assets", "tasks"] },
  { label: "Administration", modules: ["users", "settings"] },
];

// --- matrix helpers --------------------------------------------------------

const NONE: ModulePermissions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

export function emptyMatrix(): Record<Module, ModulePermissions> {
  return Object.fromEntries(MODULES.map((m) => [m, { ...NONE }])) as Record<
    Module,
    ModulePermissions
  >;
}

/** Fills a stored (sparse) matrix out to every module/action pair. */
export function expandMatrix(
  stored: PermissionsMatrix | null | undefined
): Record<Module, ModulePermissions> {
  const out = emptyMatrix();
  if (!stored) return out;
  for (const m of MODULES) {
    const row = stored[m];
    if (!row) continue;
    for (const a of PERM_ACTIONS) {
      if (row[a]) out[m][a] = true;
    }
  }
  return out;
}

const full = { view: true, create: true, edit: true, delete: true, approve: true };
const manage = { view: true, create: true, edit: true, approve: true };
const contribute = { view: true, create: true, edit: true };
const submit = { view: true, create: true };
const read = { view: true };

function matrixOf(
  spec: Partial<Record<Module, Partial<ModulePermissions>>>
): PermissionsMatrix {
  return spec;
}

// --- the ten roles of SRS section 2 ---------------------------------------

export type SystemRole = {
  key: string;
  name: string;
  description: string;
  sort_order: number;
  /** Platform-operator role: never copied into a tenant. */
  platform_only?: boolean;
  matrix: PermissionsMatrix;
};

export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description:
      "SaaS platform owner. Manages global platform settings, onboards and offboards tenant companies, oversees subscription billing. Granted only through the PLATFORM_ADMIN_IDENTIFIERS environment variable — never from the UI.",
    sort_order: 0,
    platform_only: true,
    matrix: matrixOf(Object.fromEntries(MODULES.map((m) => [m, full]))),
  },
  {
    key: "company_admin",
    name: "Company Admin / Management",
    description:
      "Tenant owner with full administrative control, including the executive MIS dashboard, live map and company-wide analytics.",
    sort_order: 1,
    matrix: matrixOf(Object.fromEntries(MODULES.map((m) => [m, full]))),
  },
  {
    key: "it_mis_manager",
    name: "IT & MIS Manager",
    description:
      "Oversees data integrity, user access and analytics dashboards. Maintains the live map and global tracking metrics.",
    sort_order: 2,
    matrix: matrixOf({
      mis: full,
      tracking: full,
      audit: full,
      reports: full,
      settings: manage,
      users: contribute,
      employees: read,
      attendance: read,
      fleet: read,
      logistics: read,
      inventory: read,
      procurement: read,
      crm: read,
      field: read,
      assets: manage,
      tasks: contribute,
      facilities: read,
    }),
  },
  {
    key: "procurement_manager",
    name: "Procurement & Supply Chain Manager",
    description:
      "Manages vendor relationships, purchase orders, inventory levels, logistics routing and supply chain timelines.",
    sort_order: 3,
    matrix: matrixOf({
      vendors: full,
      inventory: full,
      procurement: full,
      logistics: full,
      fleet: read,
      tracking: read,
      reports: read,
      mis: read,
      tasks: contribute,
      expenses: submit,
      invoicing: read,
    }),
  },
  {
    key: "hr_manager",
    name: "HR Manager / HR Admin",
    description:
      "Manages the employee directory, onboarding, attendance tracking, leave approvals and payroll data.",
    sort_order: 4,
    matrix: matrixOf({
      employees: full,
      attendance: full,
      leave: full,
      payroll: full,
      reports: read,
      mis: read,
      users: contribute,
      tasks: contribute,
      facilities: manage,
      expenses: submit,
    }),
  },
  {
    key: "finance_manager",
    name: "Finance / Accounts Manager",
    description:
      "Manages the general ledger, accounts payable and receivable, and expense claim verification.",
    sort_order: 5,
    matrix: matrixOf({
      finance: full,
      invoicing: full,
      expenses: full,
      payroll: manage,
      procurement: { view: true, approve: true },
      vendors: read,
      reports: full,
      mis: read,
      tasks: contribute,
    }),
  },
  {
    key: "fleet_manager",
    name: "Operations / Fleet Manager",
    description:
      "Administers the vehicle registry, approves requisition requests and schedules fleet maintenance.",
    sort_order: 6,
    matrix: matrixOf({
      fleet: full,
      logistics: full,
      tracking: read,
      reports: read,
      mis: read,
      vendors: read,
      tasks: contribute,
      expenses: submit,
      assets: read,
    }),
  },
  {
    key: "sales_field",
    name: "Sales, Marketing & Field Visit Team",
    description:
      "Executes field operations, logs client meetings and submits field data. Routes and visit coordinates are logged automatically by the mobile app.",
    sort_order: 7,
    matrix: matrixOf({
      crm: manage,
      field: manage,
      invoicing: submit,
      tasks: contribute,
      expenses: submit,
      attendance: submit,
      leave: submit,
      facilities: submit,
      fleet: submit,
      reports: read,
    }),
  },
  {
    key: "driver",
    name: "Driver",
    description:
      "Operates company vehicles. The mobile app provides route details and runs continuous background GPS logging.",
    sort_order: 8,
    matrix: matrixOf({
      fleet: submit,
      logistics: read,
      tasks: contribute,
      attendance: submit,
      leave: submit,
      expenses: submit,
    }),
  },
  {
    key: "employee",
    name: "Standard Employee",
    description:
      "Personal self-service dashboard: attendance, leave, expense claims, room booking and vehicle requisition.",
    sort_order: 9,
    matrix: matrixOf({
      attendance: submit,
      leave: submit,
      expenses: submit,
      facilities: submit,
      fleet: submit,
      tasks: contribute,
    }),
  },
];

/** Roles copied into every new tenant at signup. */
export const TENANT_ROLE_TEMPLATES = SYSTEM_ROLES.filter((r) => !r.platform_only);
