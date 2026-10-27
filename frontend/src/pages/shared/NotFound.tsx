import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { Button } from "../../components/ui/Button";

export function NotFoundPage() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
      <Compass className="h-10 w-10 text-slate-300" aria-hidden />
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="max-w-md text-sm text-slate-500">
        The address does not exist in this prototype. Records never leak their existence to
        unauthorised roles, so a wrong id looks the same as an unknown page.
      </p>
      <Button variant="secondary" onClick={() => (window.location.href = user != null ? "/dashboard" : "/")}>
        {user != null ? "Back to dashboard" : "Back to the start page"}
      </Button>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
      <ShieldIcon />
      <h1 className="text-xl font-semibold text-slate-900">Access denied</h1>
      <p className="max-w-md text-sm text-slate-500">
        Your role or institution does not grant access to this action. If you believe this is wrong,
        contact the portal administrator. All attempts are recorded for the audit trail.
      </p>
      <Link to="/">
        <Button variant="secondary">Back to the start page</Button>
      </Link>
    </div>
  );
}

function ShieldIcon() {
  return <span aria-hidden className="text-2xl">🔒</span>;
}
