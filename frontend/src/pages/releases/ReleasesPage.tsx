/**
 * Release request lifecycle. Colleges open requests; officers recommend or
 * reject; the approving authority approves or rejects; a separate completion
 * step records the external refund evidence (approval is never completion).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { completeRelease, decideRelease, fetchReleases } from "../../services/portal";
import { useAuth } from "../../auth/AuthProvider";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { ReleaseStatusBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";
import type { ReleaseItem } from "@sih26265/contracts";

const STAGE_OPTIONS = [
  { value: "", label: "All" },
  { value: "open", label: "Open (awaiting recommendation)" },
  { value: "recommended", label: "Recommended (awaiting decision)" },
  { value: "approved", label: "Approved (awaiting completion)" },
  { value: "decided", label: "Decided" },
  { value: "completed", label: "Completed" },
];

export function ReleasesPage() {
  const { user } = useAuth();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const { values, set, pageAsNumber } = useUrlListState({ stage: "" });

  const isCollege = user?.role === "COLLEGE_USER";
  const isOfficer = user?.role === "REVIEW_OFFICER";
  const isAuthority = user?.role === "APPROVING_AUTHORITY";

  const list = useQuery({
    queryKey: ["releases", { stage: values.stage, page: pageAsNumber }],
    queryFn: () =>
      fetchReleases({
        stage: values.stage || undefined,
        page: pageAsNumber,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["releases"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
  };

  const action = useMutation({
    mutationFn: (input: { releaseId: number; action: "recommend" | "reject" | "approve"; note: string }) =>
      decideRelease(input),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Release action recorded.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const complete = useMutation({
    mutationFn: (input: { releaseId: number; evidenceType: string; evidenceRef: string; evidenceDate: string; note: string; completedAmountRupees?: string }) =>
      completeRelease({
        releaseId: input.releaseId,
        evidenceType: input.evidenceType as "ORIGINAL_FDR_RECEIPT" | "BANK_ACCOUNT_STATEMENT" | "BANK_REFUND_CONFIRMATION" | "BANK_ADVICE_LETTER" | "OTHER_DOCUMENT",
        evidenceRef: input.evidenceRef,
        evidenceDate: input.evidenceDate,
        note: input.note,
        completedAmountRupees: input.completedAmountRupees ?? "",
      }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Release completion recorded.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Releases"
        description={
          isCollege
            ? "Requests to release a deposit back to your institution, and their lifecycle."
            : "Release lifecycle: request, officer recommendation, authority decision, then a separate completion step with the external refund evidence."
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <label>
            <span className="app-label">Lifecycle stage</span>
            <select className="app-input" value={values.stage} onChange={(e) => set({ stage: e.target.value })}>
              {STAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading releases..." />
      ) : list.isError ? (
        <ErrorState title="Could not load releases" detail={errorToMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No release requests in this view"
            detail={isCollege ? "Raise a release from a verified case workspace (Release history tab)." : "Requests appear here once a college opens them."}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((item) => (
            <ReleaseRow
              key={item.id}
              item={item}
              isOfficer={isOfficer}
              isAuthority={isAuthority}
              onAction={(actionKind, note) => action.mutate({ releaseId: item.id, action: actionKind, note })}
              onComplete={(payload) => complete.mutate({ releaseId: item.id, ...payload, completedAmountRupees: payload.completedAmountRupees })}
              pending={action.isPending || complete.isPending}
            />
          ))}
          <Card>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onGoto={(target) => set({ page: target }, { keepPage: true })}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function ReleaseRow({
  item,
  isOfficer,
  isAuthority,
  onAction,
  onComplete,
  pending,
}: {
  item: ReleaseItem;
  isOfficer?: boolean;
  isAuthority?: boolean;
  onAction: (action: "recommend" | "reject" | "approve", note: string) => void;
  onComplete: (payload: { evidenceType: string; evidenceRef: string; evidenceDate: string; note: string; completedAmountRupees?: string }) => void;
  pending: boolean;
}) {
  const stage = item.decision ?? "requested";
  const canRecommend = isOfficer === true && item.status === "OPEN";
  const canDecide = isAuthority === true && item.status === "OPEN";
  const canComplete = isAuthority === true && stage === "approved" && item.completionEvidenceRef == null;

  return (
    <Card>
      <CardHeader
        title={`Release #${item.id} - ${item.fdrPublicCode ?? "case"}`}
        subtitle={item.institutionName ?? undefined}
      />
      <CardBody>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ReleaseStatusBadge status={stage} />
          {item.status === "OPEN" && <span className="text-xs text-slate-500">open request</span>}
        </div>
        <p className="text-sm text-slate-700">{item.reason}</p>
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-slate-400">Requested by</dt>
            <dd className="text-slate-700">{item.requestedByName ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Recommended by</dt>
            <dd className="text-slate-700">{item.recommendedByName ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Decided by</dt>
            <dd className="text-slate-700">{item.decidedByName ?? "-"}</dd>
          </div>
          {item.completionEvidenceRef != null && (
            <>
              <div>
                <dt className="text-slate-400">Completion evidence</dt>
                <dd className="text-slate-700">
                  {item.completionEvidenceType} - {item.completionEvidenceRef} ({item.completionEvidenceDate})
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Completed by</dt>
                <dd className="text-slate-700">{item.completedByName ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Completed amount</dt>
                <dd className="text-slate-700">{item.completedAmount ?? "-"}</dd>
              </div>
            </>
          )}
        </dl>
        <div className="mt-3">
          <Link to={item.fdrId != null ? `/fdrs/${item.fdrId}?tab=release` : "/releases"} className="text-sm font-medium text-teal-700 hover:underline">
            Open the case workspace
          </Link>
        </div>
        {(canRecommend || canDecide) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {canRecommend && (
              <ActionWithNote
                label="Recommend"
                requireNote={false}
                pending={pending}
                tone="primary"
                onConfirm={(note) => onAction("recommend", note)}
              />
            )}
            {canDecide && (
              <>
                <ActionWithNote
                  label="Approve"
                  requireNote={false}
                  pending={pending}
                  tone="primary"
                  onConfirm={(note) => onAction("approve", note)}
                />
                <ActionWithNote
                  label="Reject"
                  requireNote
                  pending={pending}
                  tone="danger"
                  onConfirm={(note) => onAction("reject", note)}
                />
              </>
            )}
          </div>
        )}
        {canComplete && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <CompleteForm pending={pending} onConfirm={(payload) => onComplete(payload)} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ActionWithNote({
  label,
  requireNote,
  pending,
  tone,
  onConfirm,
}: {
  label: string;
  requireNote: boolean;
  pending: boolean;
  tone: "primary" | "danger";
  onConfirm: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <Button
        type="button"
        variant={tone === "danger" ? "secondary" : "primary"}
        className={tone === "danger" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""}
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        {label}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (requireNote && note.trim().length < 5) return;
        onConfirm(note);
        setOpen(false);
      }}
    >
      <input
        className="app-input max-w-xs"
        placeholder={requireNote ? "Reason (required to reject)" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        required={requireNote}
        minLength={requireNote ? 5 : undefined}
        autoFocus
      />
      <Button type="submit" variant={tone === "danger" ? "secondary" : "primary"} className={tone === "danger" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""} disabled={pending}>
        Confirm {label.toLowerCase()}
      </Button>
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function CompleteForm({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: (payload: { evidenceType: string; evidenceRef: string; evidenceDate: string; note: string; completedAmountRupees?: string }) => void;
}) {
  const [evidenceType, setEvidenceType] = useState("BANK_REFUND_CONFIRMATION");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm({ evidenceType, evidenceRef, evidenceDate, note, completedAmountRupees: amount || undefined });
      }}
    >
      <div className="sm:col-span-2">
        <p className="text-sm font-medium text-slate-800">Record release completion</p>
        <p className="text-xs text-slate-500">
          Approval released the funds; this step only records the external evidence that the refund happened.
        </p>
      </div>
      <label>
        <span className="app-label">Evidence type</span>
        <select className="app-input" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
          <option value="ORIGINAL_FDR_RECEIPT">Original FDR receipt</option>
          <option value="BANK_ACCOUNT_STATEMENT">Bank account statement</option>
          <option value="BANK_REFUND_CONFIRMATION">Bank refund confirmation</option>
          <option value="BANK_ADVICE_LETTER">Bank advice/letter</option>
          <option value="OTHER_DOCUMENT">Other document</option>
        </select>
      </label>
      <label>
        <span className="app-label">Evidence reference</span>
        <input className="app-input" value={evidenceRef} maxLength={100} required onChange={(e) => setEvidenceRef(e.target.value)} />
      </label>
      <label>
        <span className="app-label">Evidence date</span>
        <input type="date" className="app-input" value={evidenceDate} required onChange={(e) => setEvidenceDate(e.target.value)} />
      </label>
      <label>
        <span className="app-label">Refunded amount in rupees (optional)</span>
        <input className="app-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000.00" />
      </label>
      <label className="sm:col-span-2">
        <span className="app-label">Note (optional)</span>
        <input className="app-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Recording..." : "Record completion"}
        </Button>
      </div>
    </form>
  );
}
