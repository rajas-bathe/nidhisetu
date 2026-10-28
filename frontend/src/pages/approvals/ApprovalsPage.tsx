/**
 * Approval queue for the approving authority: recommended releases to decide
 * and verified replacements to accept/reject. Decisions happen from here with
 * the reasons recorded for audit.
 */
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { acceptReplacement, fetchApprovals, rejectReplacement } from "../../services/portal";
import { decideRelease } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { formatDateTimeShort } from "../../utils/format";
import type { ApprovalItem } from "@sih26265/contracts";

const KIND_OPTIONS = [
  { value: "", label: "All decisions" },
  { value: "release_decision", label: "Release decisions" },
  { value: "replacement_acceptance", label: "Replacement acceptances" },
];

export function ApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const kind = searchParams.get("kind") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const list = useQuery({
    queryKey: ["approvals", { kind, page }],
    queryFn: () =>
      fetchApprovals({
        kind: kind || undefined,
        page,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["releases"] });
    void queryClient.invalidateQueries({ queryKey: ["replacements"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["fdrs"] });
  };

  const accept = useMutation({
    mutationFn: (fdrId: number) => acceptReplacement({ fdrId }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Replacement accepted; the supersession is now recorded.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const rejectReplacementMutation = useMutation({
    mutationFn: (input: { fdrId: number; reason: string }) => rejectReplacement({ fdrId: input.fdrId, reason: input.reason }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Replacement rejected.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const release = useMutation({
    mutationFn: (input: { releaseId: number; action: "approve" | "reject"; note: string }) =>
      decideRelease({ releaseId: input.releaseId, action: input.action, note: input.note }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Decision recorded.");
      invalidate();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const setKind = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "") params.delete("kind");
    else params.set("kind", value);
    params.delete("page");
    setSearchParams(params, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Approval queue"
        description="Decisions only reach this queue when the workflow gates are satisfied: verified replacements for acceptance, recommended releases for the final decision."
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <label>
            <span className="app-label">Queue</span>
            <select className="app-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading the queue..." />
      ) : list.isError ? (
        <ErrorState title="Could not load the queue" detail={errorToMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="The queue is clear"
            detail="Items appear here when officers recommend releases or verified replacements are ready for acceptance."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((item) => (
            <ApprovalRow
              key={`${item.kind}-${item.id}`}
              item={item}
              acceptPending={accept.isPending}
              rejectPending={rejectReplacementMutation.isPending || release.isPending}
              onAccept={() => accept.mutate(item.kind === "replacement_acceptance" ? item.fdrId : item.id)}
              onRejectReplacement={(reason) => rejectReplacementMutation.mutate({ fdrId: item.fdrId, reason })}
              onReleaseDecision={(action, note) =>
                release.mutate({ releaseId: item.id, action, note })
              }
            />
          ))}
          <Card>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onGoto={(target) => {
                const params = new URLSearchParams(searchParams);
                params.set("page", String(target));
                setSearchParams(params, { replace: true });
              }}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  item,
  acceptPending,
  rejectPending,
  onAccept,
  onRejectReplacement,
  onReleaseDecision,
}: {
  item: ApprovalItem;
  acceptPending: boolean;
  rejectPending: boolean;
  onAccept: () => void;
  onRejectReplacement: (reason: string) => void;
  onReleaseDecision: (action: "approve" | "reject", note: string) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {item.kind === "release_decision" ? "Release decision" : "Replacement acceptance"} &middot;{" "}
              <Link to={`/fdrs/${item.fdrId}`} className="text-teal-700 hover:underline">
                {item.fdrPublicCode}
              </Link>
            </p>
            <p className="text-xs text-slate-500">
              {item.institutionName} &middot; opened {formatDateTimeShort(item.openedAt)}
              {item.isOverdue && <span className="ml-1.5 font-medium text-rose-600">overdue</span>}
              {item.dueDate != null && !item.isOverdue && <span className="ml-1.5">due {item.dueDate}</span>}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${item.isOverdue ? "bg-rose-50 text-rose-700 ring-rose-300" : "bg-amber-50 text-amber-800 ring-amber-300"}`}>
            {item.kind === "release_decision" ? "Awaiting decision" : "Awaiting acceptance"}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-slate-700">{item.stage}</p>
        {item.detail != null && <p className="text-xs text-slate-500">{item.detail}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {item.kind === "replacement_acceptance" ? (
            <>
              <Button type="button" disabled={acceptPending} onClick={onAccept}>
                {acceptPending ? "Recording..." : "Accept replacement"}
              </Button>
              {rejectOpen ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (reason.trim().length < 5) return;
                    onRejectReplacement(reason);
                    setRejectOpen(false);
                  }}
                >
                  <input
                    className="app-input max-w-xs"
                    placeholder="Reason (required)"
                    value={reason}
                    minLength={5}
                    required
                    autoFocus
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button type="submit" variant="secondary" className="!border-rose-300 !text-rose-700 hover:!bg-rose-50" disabled={rejectPending}>
                    Confirm reject
                  </Button>
                  <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setRejectOpen(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <Button type="button" variant="secondary" className="!border-rose-300 !text-rose-700 hover:!bg-rose-50" onClick={() => setRejectOpen(true)} disabled={rejectPending}>
                  Reject
                </Button>
              )}
            </>
          ) : (
            <>
              <ActionNoteless label="Approve" pending={rejectPending} onConfirm={(note) => onReleaseDecision("approve", note)} />
              <ActionNoteless label="Reject" pending={rejectPending} onConfirm={(note) => onReleaseDecision("reject", note)} />
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ActionNoteless({
  label,
  pending,
  onConfirm,
}: {
  label: string;
  pending: boolean;
  onConfirm: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <Button
        type="button"
        variant={label === "Reject" ? "secondary" : "primary"}
        className={label === "Reject" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""}
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
        onConfirm(note);
        setOpen(false);
      }}
    >
      <input
        className="app-input max-w-xs"
        placeholder={label === "Reject" ? "Reason (required)" : "Note (optional)"}
        value={note}
        required={label === "Reject"}
        minLength={label === "Reject" ? 5 : undefined}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" variant={label === "Reject" ? "secondary" : "primary"} className={label === "Reject" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""} disabled={pending}>
        Confirm {label.toLowerCase()}
      </Button>
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
