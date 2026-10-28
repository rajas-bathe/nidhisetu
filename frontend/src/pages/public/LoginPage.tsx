import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Landmark, Building2, ShieldCheck } from "lucide-react";
import { ApiClientError } from "@sih26265/contracts";
import { useAuth } from "../../auth/AuthProvider";
import { Button } from "../../components/ui/Button";

type Portal = "college" | "officer" | "admin";

const PORTAL_COPY: Record<Portal, { title: string; subtitle: string }> = {
  college: {
    title: "College login",
    subtitle: "Access your institution's deposit records.",
  },
  officer: {
    title: "AICTE officer login",
    subtitle: "Reviewing officers and the approving authority use the same entry point; your role decides your dashboard.",
  },
  admin: {
    title: "Administration login",
    subtitle: "System administration only: manage colleges, accounts and supervise the register.",
  },
};

/** Field-level + general error mapping for the shared ApiError shape. */
function describeError(error: unknown): { message: string } {
  if (error instanceof ApiClientError) {
    return { message: error.message };
  }
  return { message: "Could not reach the server. Please try again." };
}

export function LoginPage({ portal }: { portal: Portal }) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Signed-in users don't need the login screens.
  if (user != null) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const localFieldErrors: Record<string, string[]> = {};
    if (email.trim().length === 0) localFieldErrors.email = ["Email is required"];
    if (password.length === 0) localFieldErrors.password = ["Password is required"];
    if (Object.keys(localFieldErrors).length > 0) {
      setFieldErrors(localFieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.trim(), password, context: portal });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(describeError(err).message);
        if (err.fieldErrors != null) setFieldErrors(err.fieldErrors);
      } else {
        setError(describeError(err).message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copy = PORTAL_COPY[portal];

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            {portal === "officer" ? <Landmark className="h-4 w-4" aria-hidden /> : portal === "admin" ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <Building2 className="h-4 w-4" aria-hidden />}
            Security Deposit &amp; FDR Portal
          </Link>
        </div>

        <div className="app-card p-6">
          <h1 className="text-lg font-semibold text-slate-900">{copy.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>

          {error != null && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label className="app-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="app-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email != null}
                aria-describedby={fieldErrors.email != null ? "email-error" : undefined}
              />
              {fieldErrors.email != null && (
                <p id="email-error" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.email.join(" ")}
                </p>
              )}
            </div>

            <div>
              <label className="app-label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="app-input pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={fieldErrors.password != null}
                  aria-describedby={fieldErrors.password != null ? "password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              {fieldErrors.password != null && (
                <p id="password-error" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.password.join(" ")}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {portal === "college" ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              An AICTE officer?{" "}
              <Link to="/login/officer" className="font-medium text-teal-700 hover:underline">
                Use the officer login
              </Link>
            </p>
          ) : portal === "admin" ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              Officer accounts must use the{" "}
              <Link to="/login/officer" className="font-medium text-teal-700 hover:underline">
                officer login
              </Link>
              .
            </p>
          ) : (
            <p className="mt-4 text-center text-xs text-slate-500">
              College users must use the{" "}
              <Link to="/login/college" className="font-medium text-teal-700 hover:underline">
                college login
              </Link>
              {" "}or the{" "}
              <Link to="/login/admin" className="font-medium text-teal-700 hover:underline">
                administration login
              </Link>
              .
            </p>
          )}
        </div>

        {(import.meta as { env?: { DEV?: boolean } }).env?.DEV === true && portal === "college" && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Development build · demo accounts come from the backend seed (see demo/scenarios.md)
          </p>
        )}
      </div>
    </div>
  );
}
