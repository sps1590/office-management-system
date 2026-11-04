import {
  Activity,
  Banknote,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Contact,
  FileText,
  Gauge,
  Handshake,
  LayoutDashboard,
  Laptop,
  MapPin,
  Navigation,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { Module } from "./modules";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Visible only when the user can view this module. Omitted = always. */
  module?: Module;
  /** Restricted to the company admin regardless of the matrix. */
  adminOnly?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/mis", label: "Executive MIS", icon: Activity, module: "mis" },
      { href: "/tracking/map", label: "Live operations map", icon: MapPin, module: "tracking" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/employees", label: "Employees", icon: Users, module: "employees" },
      { href: "/attendance", label: "Attendance", icon: CalendarClock, module: "attendance" },
      { href: "/leave", label: "Leave", icon: CalendarDays, module: "leave" },
      { href: "/payroll", label: "Payroll", icon: Wallet, module: "payroll" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/fleet", label: "Vehicles", icon: Truck, module: "fleet" },
      { href: "/fleet/bookings", label: "Requisitions", icon: ClipboardList, module: "fleet" },
      { href: "/fleet/maintenance", label: "Maintenance", icon: Wrench, module: "fleet" },
      { href: "/logistics", label: "Logistics routes", icon: Route, module: "logistics" },
    ],
  },
  {
    label: "Supply chain",
    items: [
      { href: "/vendors", label: "Vendors", icon: Store, module: "vendors" },
      { href: "/inventory", label: "Inventory", icon: Boxes, module: "inventory" },
      { href: "/procurement", label: "Purchase orders", icon: FileText, module: "procurement" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/clients", label: "Clients", icon: Contact, module: "crm" },
      { href: "/deals", label: "Pipeline", icon: Handshake, module: "crm" },
      { href: "/field-visits", label: "Field visits", icon: Navigation, module: "field" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/finance", label: "General ledger", icon: BookOpen, module: "finance" },
      { href: "/invoices", label: "Invoices", icon: Receipt, module: "invoicing" },
      { href: "/bills", label: "Bills", icon: Banknote, module: "invoicing" },
      { href: "/expenses", label: "Expense claims", icon: Wallet, module: "expenses" },
    ],
  },
  {
    label: "Workplace",
    items: [
      { href: "/rooms", label: "Meeting rooms", icon: Building2, module: "facilities" },
      { href: "/visitors", label: "Visitors", icon: Contact, module: "facilities" },
      { href: "/assets", label: "Asset register", icon: Laptop, module: "assets" },
      { href: "/tasks", label: "Tasks", icon: ClipboardList, module: "tasks" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/tracking", label: "GPS & geofences", icon: Gauge, module: "tracking" },
      { href: "/reports", label: "Reports", icon: ScrollText, module: "reports" },
      { href: "/audit", label: "Audit log", icon: ShieldCheck, module: "audit" },
      { href: "/users", label: "Users & roles", icon: UserCog, adminOnly: true },
      { href: "/settings", label: "Company settings", icon: Settings, module: "settings" },
    ],
  },
];

/** Flat list, used by the command palette. */
export const NAV_FLAT: NavItem[] = NAV.flatMap((g) => g.items);
