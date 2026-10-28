/** Admin: one college's workspace - profile edit, officer assignments, status, portfolio. */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchEligibleOfficers,
  fetchInstitutionDetail,
  setInstitutionStatus,
  updateAssignment,
  updateInstitution,
} from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { ReviewStatusBadge, DateConditionBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { formatDateTimeShort, formatLocalDate, formatMoney } from "../../utils/format";
import { SUBMISSION_BLOCK_POLICY_NOTE } from "@sih26265/contracts";
import type { JurisdictionRole } from "@sih26265/contracts";

export function CollegeDetailPage() {
  const params = useParams<{ institutionId: string }>();
  const institutionId = Number(params.institutionId);
  const navigate = useNavigate();
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ["institution", institutionId],
    queryFn: () => fetchInstitutionDetail(institutionId),
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["institution", institutionId] });
    void queryClient.invalidateQueries({ queryKey: ["institutions"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const statusMutation = useMutation({
    mutationFn: (input: { status: "ACTIVE" | "INACTIVE"; note: string }) =>
      setInstitutionStatus(institutionId, input),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Status updated.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const assignment = useMutation({
    mutationFn: (input: { officerId: number; role: JurisdictionRole; action: "assign" | "unassign" }) =>
      updateAssignment(institutionId, input),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Assignment updated.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  if (detail.isPending) {
    return <Spinner label="Loading the college workspace..." />;
  }
  if (detail.isError) {
    const status = (detail.error as { status?: number }).status;
    if (status === 403 || status === 404) {
      return <ErrorState title="College not found or outside the administration module" />;
    }
    return <ErrorState title="Could not load the college" detail={errorToMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  }

  const data = detail.data;
  const missingReview = !data.officers.some((o) => o.role === "REVIEW_OFFICER");
  const missingAuthority = !data.officers.some((o) => o.role === "APPROVING_AUTHORITY");

  return (
    <div>
      <button type="button" onClick={() => navigate("/admin/colleges")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <span aria-hidden>&larr;</span> Back to colleges
      </button>

      <PageHeader
        title={data.name}
        description={`${data.code}${data.officialCode != null && data.officialCode !== data.code ? ` (official ${data.officialCode})` : ""} - created ${formatDateTimeShort(data.createdAt)}`}
        actions={
          <StatusActions
            current={data.status}
            pending={statusMutation.isPending}
            onChange={(status, note) => statusMutation.mutate({ status, note })}
          />
        }
      />

      {data.status === "INACTIVE" && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          {SUBMISSION_BLOCK_POLICY_NOTE}
        </div>
      )}
      {(missingReview || missingAuthority) && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Missing {missingReview && "a reviewing officer"}
          {missingReview && missingAuthority && " and "}
          {missingAuthority && "an approving authority"} assignment. Cases from this college cannot complete review until assigned.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Portfolio summary" subtitle="Current (non-superseded) instruments." />
          <CardBody>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Instruments</dt>
                <dd className="text-xl font-semibold text-slate-900">{data.portfolio.instrumentsTotal}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Awaiting review</dt>
                <dd className="text-xl font-semibold text-amber-700">{data.portfolio.awaitingReview}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Held amount</dt>
                <dd className="text-xl font-semibold tabular-nums text-teal-700">{formatMoney(data.portfolio.activeAmount)}</dd>
              </div>
            </dl>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-slate-600">
              <div className="rounded-lg border border-slate-100 py-2">{data.portfolio.drafts} drafts</div>
              <div className="rounded-lg border border-slate-100 py-2">{data.portfolio.verified} verified</div>
              <div className="rounded-lg border border-slate-100 py-2">{data.portfolio.superseded} superseded</div>
              <div className="rounded-lg border border-slate-100 py-2">{data.cases.length} cases listed</div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Open work" />
          <CardBody>
            <ul className="space-y-1.5 text-sm text-slate-700">
              <li className="flex justify-between"><span>Open corrections</span><span className="font-medium tabular-nums">{data.openWork.openCorrections}</span></li>
              <li className="flex justify-between"><span>Open releases</span><span className="font-medium tabular-nums">{data.openWork.openReleases}</span></li>
              <li className="flex justify-between"><span>Pending replacements</span><span className="font-medium tabular-nums">{data.openWork.pendingReplacements}</span></li>
              <li className="flex justify-between"><span>Review tasks</span><span className="font-medium tabular-nums">{data.openWork.reviewTasks}</span></li>
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <OfficerAssignments
          institutionId={institutionId}
          officers={data.officers}
          onAssign={(officerId, role) => assignment.mutate({ officerId, role, action: "assign" })}
          onUnassign={(officerId, role) => assignment.mutate({ officerId, role, action: "unassign" })}
          pending={assignment.isPending}
        />

        <ProfileEditor
          institutionId={institutionId}
          initial={{
            name: data.name,
            code: data.code,
            officialCode: data.officialCode ?? "",
            city: data.city ?? "",
            state: data.state ?? "",
            addressLine: data.addressLine ?? "",
            postalCode: data.postalCode ?? "",
            contactName: data.contactName ?? "",
            contactDesignation: data.contactDesignation ?? "",
            contactEmail: data.contactEmail ?? "",
            contactPhone: data.contactPhone ?? "",
          }}
          onSaved={() => invalidate()}
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="Accounts" subtitle="Institution user accounts (provisioning lives under User accounts)." />
        <CardBody className="!pt-0">
          {data.accounts.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No accounts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Password</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="text-slate-800">{account.fullName}</td>
                      <td className="text-xs text-slate-600">{account.email}</td>
                      <td className="text-xs">{account.role.replace(/_/g, " ").toLowerCase()}</td>
                      <td>
                        <span className={`text-xs font-medium ${account.isActive ? "text-teal-700" : "text-rose-600"}`}>
                          {account.isActive ? "active" : "inactive"}
                        </span>
                      </td>
                      <td className="text-xs">{account.mustChangePassword ? "temporary (must change)" : "set"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Cases" subtitle="All cases for this college (latest first)." />
        <CardBody className="!pt-0">
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Bank</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Maturity</th>
                  <th scope="col">Statuses</th>
                </tr>
              </thead>
              <tbody>
                {data.cases.map((fdr) => (
                  <tr key={fdr.id}>
                    <td>
                      <Link to={`/fdrs/${fdr.id}`} className="font-medium text-teal-700 hover:underline">
                        {fdr.publicCode}
                      </Link>
                    </td>
                    <td className="text-slate-700">{fdr.bankName}</td>
                    <td className="tabular-nums">{formatMoney(fdr.amount)}</td>
                    <td className="whitespace-nowrap text-xs">{formatLocalDate(fdr.maturityDate)}</td>
                    <td>
                      <div className="flex gap-1">
                        <ReviewStatusBadge status={fdr.status} />
                        <DateConditionBadge condition={fdr.dateCondition} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatusActions({
  current,
  pending,
  onChange,
}: {
  current: "ACTIVE" | "INACTIVE";
  pending: boolean;
  onChange: (status: "ACTIVE" | "INACTIVE", note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        className={current === "ACTIVE" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""}
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        {current === "ACTIVE" ? "Deactivate college" : "Reactivate college"}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (current === "ACTIVE" && note.trim().length < 5) return;
        onChange(current === "ACTIVE" ? "INACTIVE" : "ACTIVE", note);
        setOpen(false);
      }}
    >
      <input
        className="app-input max-w-xs"
        placeholder={current === "ACTIVE" ? "Reason (required, min 5 chars)" : "Note (optional)"}
        value={note}
        required={current === "ACTIVE"}
        minLength={current === "ACTIVE" ? 5 : undefined}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" variant="secondary" className={current === "ACTIVE" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""} disabled={pending}>
        Confirm
      </Button>
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function OfficerAssignments({
  institutionId,
  officers,
  onAssign,
  onUnassign,
  pending,
}: {
  institutionId: number;
  officers: Array<{ officerId: number; officerName: string; officerEmail: string; role: JurisdictionRole; assignedAt: string | null }>;
  onAssign: (officerId: number, role: JurisdictionRole) => void;
  onUnassign: (officerId: number, role: JurisdictionRole) => void;
  pending: boolean;
}) {
  const [role, setRole] = useState<JurisdictionRole>("REVIEW_OFFICER");
  const [officerId, setOfficerId] = useState("");

  const candidates = useQuery({
    queryKey: ["eligible-officers", role],
    queryFn: () => fetchEligibleOfficers(role),
  });
  void institutionId;

  return (
    <Card>
      <CardHeader title="Officer assignments" subtitle="Assign by role. A case needs its college's officer of that role to act." />
      <CardBody>
        {officers.length === 0 ? (
          <p className="text-sm text-slate-500">No officers assigned yet.</p>
        ) : (
          <ul className="mb-3 divide-y divide-slate-100">
            {officers.map((entry) => (
              <li key={`${entry.officerId}-${entry.role}`} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-slate-800">{entry.officerName}</p>
                  <p className="text-xs text-slate-500">
                    {entry.role === "REVIEW_OFFICER" ? "Reviewing officer" : "Approving authority"} &middot; {entry.officerEmail}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="!px-2 !py-1 text-xs"
                  disabled={pending}
                  onClick={() => onUnassign(entry.officerId, entry.role)}
                >
                  Unassign
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (officerId === "") return;
            onAssign(Number(officerId), role);
            setOfficerId("");
          }}
        >
          <label>
            <span className="app-label">Role</span>
            <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as JurisdictionRole)}>
              <option value="REVIEW_OFFICER">Reviewing officer</option>
              <option value="APPROVING_AUTHORITY">Approving authority</option>
            </select>
          </label>
          <label>
            <span className="app-label">Officer</span>
            <select className="app-input" value={officerId} onChange={(e) => setOfficerId(e.target.value)} required>
              <option value="">Choose an eligible officer...</option>
              {(candidates.data ?? []).map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.fullName} ({officer.email})
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={pending || candidates.isPending}>
              Assign
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

interface ProfileState {
  name: string;
  code: string;
  officialCode: string;
  city: string;
  state: string;
  addressLine: string;
  postalCode: string;
  contactName: string;
  contactDesignation: string;
  contactEmail: string;
  contactPhone: string;
}

function ProfileEditor({
  institutionId,
  initial,
  onSaved,
}: {
  institutionId: number;
  initial: ProfileState;
  onSaved: () => void;
}) {
  const toasts = useToasts();
  const [form, setForm] = useState<ProfileState>(initial);
  const set = (key: keyof ProfileState) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      updateInstitution(institutionId, {
        name: form.name,
        code: form.code,
        officialCode: form.officialCode || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        addressLine: form.addressLine || undefined,
        postalCode: form.postalCode || undefined,
        contactName: form.contactName || undefined,
        contactDesignation: form.contactDesignation || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
      }),
    onSuccess: () => {
      toasts.success("Profile saved.");
      onSaved();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const text = (key: keyof ProfileState, label: string, type = "text") => (
    <label>
      <span className="app-label">{label}</span>
      <input type={type} className="app-input" value={form[key]} onChange={(e) => set(key)(e.target.value)} />
    </label>
  );

  return (
    <Card>
      <CardHeader title="Profile" subtitle="Internal code changes are allowed while no official code is recorded." />
      <CardBody>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {text("name", "College name")}
          {text("code", "Internal code")}
          {text("officialCode", "Official code (optional)")}
          {text("city", "City (optional)")}
          {text("state", "State (optional)")}
          {text("postalCode", "Postal code (optional)")}
          {text("contactName", "Contact person (optional)")}
          {text("contactDesignation", "Designation (optional)")}
          {text("contactEmail", "Contact email (optional)", "email")}
          {text("contactPhone", "Contact phone (optional)")}
          <label className="sm:col-span-2">
            <span className="app-label">Address (optional)</span>
            <input className="app-input" value={form.addressLine} onChange={(e) => set("addressLine")(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
