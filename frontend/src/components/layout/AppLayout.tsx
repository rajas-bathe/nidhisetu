/**
 * Root application shell. The navy sidebar is the single navigation surface;
 * the server-issued role decides which entries exist (never a client claim).
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Banknote,
  Bell,
  Building2,
  ClipboardList,
  FileBarChart,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  KeyRound,
  Receipt,
  ShieldCheck,
  Users,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { RoleBadge } from "../ui/Badges";
import { Spinner } from "../ui/States";
import { fetchNotifications } from "../../services/portal";
import type { UserRole } from "@sih26265/contracts";

interface NavEntry {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: ReadonlyArray<UserRole>;
}

const ALL_ROLES: ReadonlyArray<UserRole> = [
  "COLLEGE_USER",
  "REVIEW_OFFICER",
  "APPROVING_AUTHORITY",
  "SYSTEM_ADMIN",
];

const NAV_ENTRIES: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL_ROLES },
  { to: "/fdrs", label: "My instruments", icon: Receipt, roles: ["COLLEGE_USER"] },
  { to: "/fdrs", label: "FDR Register", icon: Receipt, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY", "SYSTEM_ADMIN"] },
  { to: "/fdrs/new", label: "New submission", icon: Banknote, roles: ["COLLEGE_USER"] },
  { to: "/tasks", label: "Tasks", icon: ClipboardList, roles: ALL_ROLES },
  { to: "/corrections", label: "Corrections", icon: Inbox, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY", "COLLEGE_USER"] },
  { to: "/replacements", label: "Replacements", icon: History, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY"] },
  { to: "/releases", label: "Releases", icon: Banknote, roles: ["COLLEGE_USER", "REVIEW_OFFICER", "APPROVING_AUTHORITY"] },
  { to: "/approvals", label: "Approval queue", icon: ShieldCheck, roles: ["APPROVING_AUTHORITY"] },
  { to: "/notifications", label: "Notifications", icon: Bell, roles: ALL_ROLES },
  { to: "/reports", label: "Reports", icon: FileBarChart, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY", "SYSTEM_ADMIN", "COLLEGE_USER"] },
  { to: "/audit", label: "Audit trail", icon: History, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY", "SYSTEM_ADMIN"] },
  { to: "/admin/colleges", label: "Colleges", icon: Building2, roles: ["SYSTEM_ADMIN"] },
  { to: "/admin/users", label: "User accounts", icon: Users, roles: ["SYSTEM_ADMIN"] },
];

export function AppLayout() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    staleTime: 30_000,
    enabled: user != null,
    placeholderData: keepPreviousData,
  });
  const unreadCount = notifications.data?.unreadCount ?? 0;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner label="Checking your session..." />
      </div>
    );
  }

  if (user == null) {
    // RequireAuth normally prevents this; kept as a defensive fallback.
    void navigate("/", { replace: true });
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner label="Redirecting to sign in..." />
      </div>
    );
  }

  const entries = NAV_ENTRIES.filter((entry) => entry.roles.includes(user.role));

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-navy-950/40 bg-navy-900 text-white md:flex">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-sm font-semibold leading-snug">Security Deposit &amp; FDR Portal</p>
          <p className="mt-0.5 text-xs text-white/60">Sample installation &middot; synthetic data</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          {entries.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={`${to}-${label}`}
              to={to}
              end={to === "/fdrs/new"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
              {to === "/notifications" && unreadCount > 0 && (
                <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-white/10 px-3 py-4">
          <NavLink
            to="/account/password"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"
          >
            <KeyRound className="h-4 w-4" aria-hidden />
            Change password
          </NavLink>
          <p className="truncate px-3 text-xs text-white/70">
            {user.institution?.name ?? (user.role === "SYSTEM_ADMIN" ? "Administration" : "AICTE officer account")}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3 md:hidden">
            <span className="rounded-md bg-navy-900 px-2 py-1 text-xs font-semibold text-white">FDR Portal</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {user.role !== "SYSTEM_ADMIN" && user.role !== "COLLEGE_USER" && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Jurisdiction-limited account
              </span>
            )}
            <NavLink
              to="/notifications"
              className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
              aria-label={unreadCount > 0 ? `Notifications: ${unreadCount} unread` : "Notifications"}
            >
              <Bell className="h-4 w-4" aria-hidden />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </NavLink>
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <RoleBadge role={user.role} />
            <button
              type="button"
              onClick={handleLogout}
              className="app-btn-secondary !px-3 !py-1.5"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden" aria-label="Mobile navigation">
          {entries.map(({ to, label }) => (
            <NavLink
              key={`m-${to}-${label}`}
              to={to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100"}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 px-4 py-3 md:px-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span>Prototype for SIH26265 &mdash; sample configuration and synthetic records.</span>
            <span className="inline-flex items-center gap-1 text-teal-700">
              <ExternalLink className="h-3 w-3" aria-hidden /> Not an official AICTE system.
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}
