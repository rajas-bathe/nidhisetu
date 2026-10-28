/**
 * Replacement queue (officers). Shows each proposed replacement against its
 * predecessor; officers recommend verified proposals, the accepting authority
 * accepts or rejects from the approval queue.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchReplacements } from "../../services/portal";
import { useUrlListState } from "../../utils/useUrlState";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { ReviewStatusBadge } from "../../components/ui/Badges";
import { Pagination } from "../../components/ui/Pagination";
import { formatDateTimeShort } from "../../utils/format";

const STAGE_LABELS: Record<string, string> = {
  review: "Under officer review",
  recommended: "Awaiting acceptance",
  accepted: "Supersession established",
  rejected: "Rejected",
};

export function ReplacementsPage() {
  const { set, pageAsNumber } = useUrlListState({});

  const list = useQuery({
    queryKey: ["replacements", pageAsNumber],
    queryFn: () => fetchReplacements({ page: pageAsNumber, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Replacements"
        description="Renewal of a matured or approaching instrument. A supersession is established only when the approving authority accepts the verified replacement - never by the submission itself."
      />

      {list.isPending ? (
        <Spinner label="Loading replacement queue..." />
      ) : list.isError ? (
        <ErrorState title="Could not load replacements" detail={String(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No replacements in your jurisdiction"
            detail="When a college submits a replacement instrument (from the replaced case or with the replacement flag), it appears here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((item) => (
            <Card key={item.fdrId}>
              <CardHeader
                title={`${item.fdrPublicCode} replaces ${item.previousPublicCode}`}
                subtitle={`${item.institutionName} - ${STAGE_LABELS[item.stage] ?? item.stage}`}
              />
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Previous instrument</p>
                    <Link to={`/fdrs/${item.previousFdrId}`} className="text-sm font-medium text-teal-700 hover:underline">
                      {item.previousPublicCode}
                    </Link>
                    <div className="mt-1.5">
                      <ReviewStatusBadge status={item.previousStatus} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-teal-700">Proposed replacement</p>
                    <Link to={`/fdrs/${item.fdrId}`} className="text-sm font-medium text-teal-700 hover:underline">
                      {item.fdrPublicCode}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      submitted {item.submittedAt != null ? formatDateTimeShort(item.submittedAt) : "not yet"}
                    </p>
                    <div className="mt-1.5">
                      <ReviewStatusBadge status={item.status} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Next step</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {item.stage === "review" && "Review and verify this case, then recommend it."}
                      {item.stage === "recommended" && "Wait for the approving authority to accept or reject."}
                      {item.stage === "accepted" && "Accepted - the previous instrument is superseded."}
                      {item.stage === "rejected" && "Rejected by the authority."}
                    </p>
                    <Link to={`/fdrs/${item.fdrId}`} className="mt-2 inline-block text-sm font-medium text-teal-700 hover:underline">
                      Open case workspace
                    </Link>
                  </div>
                </div>
              </CardBody>
            </Card>
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
