/**
 * Root application shell. The navy sidebar layout is the single navigation
 * surface; role decides which entries exist (server role, never client claim).
 */
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut, Receipt, ShieldCheck, ExternalLink } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { RoleBadge } from "../ui/Badges";
import { Spinner } from "../ui/States";

interface NavEntry {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: ReadonlyArray<"COLLEGE_USER" | "REVIEW_OFFICER" | "APPROVING_AUTHORITY">;
}

const NAV_ENTRIES: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["COLLEGE_USER", "REVIEW_OFFICER", "APPROVING_AUTHORITY"] },
  { to: "/fdrs", label: "My FDRs", icon: Receipt, roles: ["COLLEGE_USER"] },
  { to: "/fdrs", label: "FDR Register", icon: Receipt, roles: ["REVIEW_OFFICER", "APPROVING_AUTHORITY"] },
];

export function AppLayout() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (user == null) {
    // RequireAuth normally prevents this; kept as a defensive fallback.
    void navigate("/", { replace: true });
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner label="Redirecting to sign in…" />
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
          <p className="text-sm font-semibold">Security Deposit &amp; FDR Portal</p>
          <p className="mt-0.5 text-xs text-white/60">Prototype · synthetic data</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main navigation">
          {entries.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={`${to}-${label}`}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-3 py-4">
          <p className="truncate px-2 text-xs text-white/70">{user.institution?.name ?? "AICTE officer account"}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3 md:hidden">
            <span className="rounded-md bg-navy-900 px-2 py-1 text-xs font-semibold text-white">FDR Portal</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {user.institution == null && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Jurisdiction-limited account
              </span>
            )}
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
            <span>Prototype for SIH26265 — sample configuration and synthetic records.</span>
            <span className="inline-flex items-center gap-1 text-teal-700">
              <ExternalLink className="h-3 w-3" aria-hidden /> Not an official AICTE system.
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}
