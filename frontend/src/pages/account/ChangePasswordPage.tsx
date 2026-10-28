/**
 * Change own password - forced for accounts carrying a temporary password
 * (first sign-in after provisioning or reset), otherwise available from the
 * sidebar. Other sessions are revoked by the server on success.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changePassword } from "../../services/portal";
import { useAuth } from "../../auth/AuthProvider";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { Spinner, SuccessNote } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";

/** Sample complexity rule, mirrored client-side for instant feedback. */
function newPasswordProblem(value: string): string | null {
  if (value.length < 10) return "Use at least 10 characters.";
  if (!/[A-Z]/.test(value)) return "Add an uppercase letter.";
  if (!/[a-z]/.test(value)) return "Add a lowercase letter.";
  if (!/\d/.test(value)) return "Add a digit.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Add a symbol (for example # or !).";
  return null;
}

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { user } = useAuth();
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      setDone(true);
      toasts.success("Password replaced. Other sessions were signed out.");
      // Re-fetch the session so mustChangePassword clears and the app unlocks.
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    },
    onError: (error) => {
      const message = errorToMessage(error);
      toasts.error(message);
      if ("fieldErrors" in error && error instanceof Error) {
        const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
        if (fieldErrors != null) setFieldErrors(fieldErrors);
      }
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    const errors: Record<string, string[]> = {};
    if (currentPassword.length === 0) errors.currentPassword = ["Current password is required"];
    const problem = newPasswordProblem(newPassword);
    if (problem != null) errors.newPassword = [problem];
    if (newPassword !== confirmPassword) errors.confirmPassword = ["The two passwords do not match"];
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    change.mutate();
  };

  if (user == null) {
    return <Spinner label="Checking your session..." />;
  }

  return (
    <div className={forced ? "flex min-h-screen items-center justify-center bg-surface px-4" : "mx-auto max-w-xl"}>
      <div className="w-full max-w-md">
        {forced && (
          <div className="mb-6 text-center">
            <p className="text-sm font-semibold text-navy-900">Security Deposit & FDR Portal</p>
            <p className="mt-1 text-xs text-slate-500">Set your own password to continue</p>
          </div>
        )}
        <Card>
          <CardHeader
            title={forced ? "Replace your temporary password" : "Change password"}
            subtitle={
              forced
                ? `${user.email} is signed in with a temporary password. Any other new password rule applies.`
                : `Signed in as ${user.email}.`
            }
          />
          <CardBody>
            {done ? (
              <SuccessNote>
                <p className="font-medium">Password replaced.</p>
                <p>Your other sessions were signed out; this session continues.</p>
              </SuccessNote>
            ) : (
              <form className="space-y-4" onSubmit={onSubmit} noValidate>
                <label className="block">
                  <span className="app-label">Current (temporary) password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    className="app-input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                  {fieldErrors.currentPassword != null && (
                    <p className="mt-1 text-xs text-rose-600">{fieldErrors.currentPassword.join(" ")}</p>
                  )}
                </label>
                <label className="block">
                  <span className="app-label">New password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="app-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    At least 10 characters with an uppercase letter, a lowercase letter, a digit and a symbol.
                  </p>
                  {fieldErrors.newPassword != null && (
                    <p className="mt-1 text-xs text-rose-600">{fieldErrors.newPassword.join(" ")}</p>
                  )}
                </label>
                <label className="block">
                  <span className="app-label">Confirm new password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="app-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                  {fieldErrors.confirmPassword != null && (
                    <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirmPassword.join(" ")}</p>
                  )}
                </label>
                <Button type="submit" className="w-full" disabled={change.isPending}>
                  {change.isPending ? "Replacing..." : "Replace password"}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
