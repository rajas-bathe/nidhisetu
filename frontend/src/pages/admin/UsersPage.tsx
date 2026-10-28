/**
 * Admin: user accounts. Provisioning returns the one-time temporary password
 * exactly once - it is displayed in a highlighted card, never stored in
 * plaintext and never shown again.
 */
import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInstitutions, fetchUsers, provisionAccount, resetUserPassword, revokeUserSessions, setUserStatus } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { formatDateTimeShort } from "../../utils/format";
import type { AccountSummary } from "@sih26265/contracts";

const ROLE_OPTIONS = [
  { value: "COLLEGE_USER", label: "College users" },
  { value: "REVIEW_OFFICER", label: "Reviewing officers" },
  { value: "APPROVING_AUTHORITY", label: "Approving authorities" },
  { value: "SYSTEM_ADMIN", label: "System admins" },
];

export function UsersPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [page, setPage] = useState(1);

  const users = useQuery({
    queryKey: ["users", { q, role, status, institutionId, page }],
    queryFn: () =>
      fetchUsers({
        q: q || undefined,
        role: role || undefined,
        status: status || undefined,
        institutionId: institutionId ? Number(institutionId) : undefined,
        page,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const institutions = useQuery({
    queryKey: ["institutions", "directory", 100],
    queryFn: () => fetchInstitutions({ page: 1, pageSize: 50, sort: "name_asc" }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["users"] });

  return (
    <div>
      <PageHeader
        title="User accounts"
        description="Provision college accounts, reset passwords to one-time temporary values, deactivate accounts and force sign-out."
      />

      <ProvisionForm onCreated={() => invalidate()} institutions={institutions.data?.items ?? []} institutionsLoading={institutions.isPending} />

      <Card className="mb-4 mt-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="app-label">Search</span>
            <input className="app-input" value={q} placeholder="Name or email" onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </label>
          <label>
            <span className="app-label">Role</span>
            <select className="app-input" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Status</span>
            <select className="app-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label>
            <span className="app-label">Institution</span>
            <select className="app-input" value={institutionId} onChange={(e) => { setInstitutionId(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {(institutions.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {users.isPending ? (
        <Spinner label="Loading accounts..." />
      ) : users.isError ? (
        <ErrorState title="Could not load accounts" detail={errorToMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : users.data == null || users.data.items.length === 0 ? (
        <Card>
          <EmptyState title="No accounts match" detail="Adjust the filters or provision a new account." />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Institution</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((account) => (
                  <UserRow
                    key={account.id}
                    account={account}
                    onChanged={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onGoto={(target) => setPage(target)}
          />
        </Card>
      )}
    </div>
  );
}

function UserRow({ account, onChanged }: { account: AccountSummary; onChanged: () => void }) {
  const toasts = useToasts();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      const result = (await fn()) as { temporaryPassword?: string; revoked?: number };
      if (result != null && typeof result === "object" && result.temporaryPassword != null) {
        setTempPassword(result.temporaryPassword);
        toasts.success("Temporary password issued. Copy it now - it is shown only once.");
      } else {
        toasts.success(success.replace("{n}", String(result?.revoked ?? 0)));
      }
      onChanged();
    } catch (error) {
      toasts.error(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr>
        <td>
          <p className="text-slate-800">{account.fullName}</p>
          <p className="text-xs text-slate-500">{account.email}</p>
        </td>
        <td className="text-xs">{account.role.replace(/_/g, " ").toLowerCase()}</td>
        <td className="text-xs text-slate-600">{account.institutionId == null ? "AICTE" : `#${account.institutionId}`}</td>
        <td className="whitespace-nowrap text-xs text-slate-500">{formatDateTimeShort(account.createdAt)}</td>
        <td>
          <div className="flex flex-col gap-0.5">
            <span className={`text-xs font-medium ${account.isActive ? "text-teal-700" : "text-rose-600"}`}>
              {account.isActive ? "Active" : "Inactive"}
            </span>
            {account.mustChangePassword && <span className="text-[10px] text-amber-700">temporary password pending</span>}
          </div>
        </td>
        <td>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => void run(() => resetUserPassword(account.id), "Password reset; sessions revoked.")}>
              Reset password
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={`!px-2 !py-1 text-xs ${account.isActive ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""}`}
              disabled={busy}
              onClick={() => void run(() => setUserStatus(account.id, { isActive: !account.isActive, note: account.isActive ? "Deactivated from the accounts list." : "Reactivated from the accounts list." }), account.isActive ? "Account deactivated; sessions revoked." : "Account reactivated.")}
            >
              {account.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => void run(() => revokeUserSessions(account.id), "Signed out {n} session(s).")}>
              Force sign-out
            </Button>
          </div>
        </td>
      </tr>
      {tempPassword != null && (
        <tr>
          <td colSpan={6} className="!px-0 !pb-0">
            <div className="m-3 rounded-lg border-2 border-teal-400 bg-teal-50 px-3 py-2.5" role="alert">
              <p className="text-sm font-medium text-teal-900">
                One-time temporary password for {account.email}
              </p>
              <p className="mt-1 font-mono text-base font-semibold tracking-wide text-teal-900">{tempPassword}</p>
              <p className="mt-1 text-xs text-teal-800">
                Shown only once. The account must replace it at first sign-in; copy it now and hand it over securely.
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ProvisionForm({
  onCreated,
  institutions,
  institutionsLoading,
}: {
  onCreated: () => void;
  institutions: Array<{ id: number; name: string }>;
  institutionsLoading: boolean;
}) {
  const toasts = useToasts();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const provision = useMutation({
    mutationFn: () =>
      provisionAccount({
        institutionId: Number(institutionId),
        fullName: fullName.trim(),
        email: email.trim(),
        designation: designation || undefined,
      }),
    onSuccess: (result) => {
      setTempPassword(result.temporaryPassword);
      setCreatedEmail(result.account.email);
      setFullName("");
      setEmail("");
      setDesignation("");
      toasts.success("Account provisioned; the temporary password is shown below.");
      onCreated();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (institutionId === "") {
      toasts.error("Choose the college for the new account.");
      return;
    }
    provision.mutate();
  };

  return (
    <Card>
      <CardHeader
        title="Provision a college account"
        subtitle="The account starts with a one-time temporary password and must set its own at first sign-in."
      />
      <CardBody>
        {institutionsLoading ? (
          <Spinner label="Loading colleges..." className="!py-2" />
        ) : (
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={onSubmit} noValidate>
            <label className="lg:col-span-2">
              <span className="app-label">Full name</span>
              <input className="app-input" value={fullName} required minLength={2} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label>
              <span className="app-label">Email</span>
              <input type="email" className="app-input" value={email} required maxLength={320} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span className="app-label">Designation (optional)</span>
              <input className="app-input" value={designation} maxLength={120} onChange={(e) => setDesignation(e.target.value)} />
            </label>
            <label>
              <span className="app-label">College</span>
              <select className="app-input" value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} required>
                <option value="">Choose...</option>
                {institutions.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end lg:col-span-5">
              <Button type="submit" disabled={provision.isPending}>
                {provision.isPending ? "Creating..." : "Provision account"}
              </Button>
            </div>
          </form>
        )}
        {tempPassword != null && createdEmail != null && (
          <div className="mt-3 rounded-lg border-2 border-teal-400 bg-teal-50 px-3 py-2.5" role="alert">
            <p className="text-sm font-medium text-teal-900">One-time temporary password for {createdEmail}</p>
            <p className="mt-1 font-mono text-base font-semibold tracking-wide text-teal-900">{tempPassword}</p>
            <p className="mt-1 text-xs text-teal-800">Shown only once - copy it now. First sign-in forces a password change.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
