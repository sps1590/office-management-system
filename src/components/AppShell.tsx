"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  User,
  X,
} from "lucide-react";
import Logo from "./Logo";
import { Toaster } from "./Toast";
import { NAV, NAV_FLAT } from "@/lib/nav";
import { logoutAction, setThemeAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

type ShellUser = {
  full_name: string;
  email: string;
  role_name: string | null;
  avatar_url: string | null;
  company_name: string;
  theme: string;
  is_platform_admin: boolean;
};

type Theme = "light" | "dark" | "system";

/**
 * The application chrome: sidebar, top bar, command palette, theme control.
 *
 * This is the only large client component in the app. Everything inside
 * `children` is still server-rendered — the shell just needs state for the
 * drawer, the collapse preference and the palette.
 */
export default function AppShell({
  user,
  allowed,
  unreadCount,
  children,
}: {
  user: ShellUser;
  /** Hrefs this user may see, computed on the server from their role. */
  allowed: string[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const allowedSet = useMemo(() => new Set(allowed), [allowed]);
  const groups = useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        items: g.items.filter((i) => allowedSet.has(i.href)),
      })).filter((g) => g.items.length > 0),
    [allowedSet]
  );

  // Restore the collapse preference before the first interaction. Stored
  // locally because it is a per-device preference, unlike the theme.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("oms-sidebar") === "collapsed");
    } catch {
      /* private mode — keep the default */
    }
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapse() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("oms-sidebar", next ? "collapsed" : "expanded");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  const nav = (
    <nav className="flex-1 overflow-y-auto scroll-thin px-2.5 pb-4">
      {groups.map((group) => (
        <div key={group.label} className="mb-1">
          {!collapsed && <p className="nav-group-label">{group.label}</p>}
          {collapsed && <div className="my-2 mx-2 border-t border-border" />}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  data-active={isActive(href)}
                  className={cn("nav-link", collapsed && "justify-center px-2")}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={17} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <div className={cn("flex items-center gap-2.5 h-16 px-4 shrink-0", collapsed && "justify-center px-2")}>
      <Logo size={26} />
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight truncate">
            {user.company_name}
          </p>
          <p className="text-[0.6875rem] text-fg-subtle">Office Management System</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh flex">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-border bg-surface sticky top-0 h-dvh transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        {brand}
        {nav}
        <button
          onClick={toggleCollapse}
          className="btn btn-ghost m-2.5 justify-center"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="relative w-72 max-w-[82vw] bg-surface border-r border-border flex flex-col fade-up">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 border-b border-border bg-bg/85 backdrop-blur flex items-center gap-2 px-4 sm:px-6">
          <button
            className="lg:hidden btn btn-ghost btn-icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-surface text-fg-subtle hover:border-border-strong transition-colors w-full max-w-72"
          >
            <Search size={15} />
            <span className="text-sm">Jump to…</span>
            <kbd className="ml-auto hidden sm:inline text-[0.6875rem] font-sans border border-border rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            {user.is_platform_admin && (
              <Link
                href="/platform"
                className="btn btn-ghost btn-sm hidden sm:inline-flex"
                title="Platform operator console"
              >
                <ShieldCheck size={15} />
                Platform
              </Link>
            )}
            <ThemeToggle initial={(user.theme as Theme) ?? "system"} />
            <Link
              href="/notifications"
              className="btn btn-ghost btn-icon relative"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-danger text-white text-[0.625rem] font-bold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <UserMenu user={user} />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full">{children}</main>
      </div>

      <Toaster />

      {paletteOpen && (
        <CommandPalette
          items={NAV_FLAT.filter((i) => allowedSet.has(i.href))}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/* --- theme ---------------------------------------------------------------- */

function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function apply(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem("oms-theme", next);
    } catch {
      /* ignore */
    }
    const dark =
      next === "dark" ||
      (next === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // Persist server-side too, so the choice follows the user to another
    // device and the pre-paint script has it on first load there.
    void setThemeAction(next);
  }

  const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      onClick={() => apply(next)}
      className="btn btn-ghost btn-icon"
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      title={`Theme: ${theme}`}
    >
      <Icon size={18} />
    </button>
  );
}

/* --- user menu ------------------------------------------------------------ */

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const initials = user.full_name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid place-items-center h-9 w-9 rounded-full bg-primary-soft text-primary text-xs font-bold hover:ring-2 hover:ring-[var(--ring)] transition-shadow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials || <User size={16} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 card p-1.5 shadow-lg fade-up"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <div className="px-2.5 py-2 border-b border-border mb-1">
            <p className="text-sm font-semibold truncate">{user.full_name}</p>
            <p className="text-xs text-fg-subtle truncate">{user.email}</p>
            {user.role_name && (
              <span className="badge badge-primary mt-2">{user.role_name}</span>
            )}
          </div>
          <Link href="/me" className="nav-link" role="menuitem">
            <User size={16} />
            My profile
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="nav-link w-full text-left" role="menuitem">
              <LogOut size={16} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* --- command palette ------------------------------------------------------ */

function CommandPalette({
  items,
  onClose,
}: {
  items: typeof NAV_FLAT;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 9);
    return items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 9);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-lg card overflow-hidden fade-up"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search size={16} className="text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && results[index]) {
                window.location.href = results[index].href;
              }
            }}
            placeholder="Search modules…"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-fg-subtle"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-subtle text-center">No matches.</p>
        ) : (
          <ul className="p-1.5 max-h-80 overflow-y-auto scroll-thin">
            {results.map(({ href, label, icon: Icon }, i) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onClose}
                  onMouseEnter={() => setIndex(i)}
                  data-active={i === index}
                  className="nav-link"
                >
                  <Icon size={16} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
