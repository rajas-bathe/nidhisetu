/**
 * Corrections queue. Officers see open requests to track; colleges see their
 * outstanding corrections (responding happens in the case workspace, where
 * the response also creates the new version).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchCorrections, cancelCorrection } from "../../services/portal";
import { useAuth } from "../../auth/AuthProvider";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { CorrectionStatusBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";
import { formatDateTimeShort } from "../../utils/format";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Awaiting college" },
  { value: "RESPONDED", label: "Answered" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function CorrectionsPage() {
  const { user } = useAuth();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const { values, set, pageAsNumber } = useUrlListState({ status: "OPEN", fdrId: "" });

  const isOfficer = user?.role === "REVIEW_OFFICER";
  const isCollege = user?.role === "COLLEGE_USER";

  const list = useQuery({
    queryKey: ["corrections", { status: values.status, fdrId: values.fdrId, page: pageAsNumber }],
    queryFn: () =>
      fetchCorrections({
        status: values.status || undefined,
        fdrId: values.fdrId ? Number(values.fdrId) : undefined,
        page: pageAsNumber,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const cancel = useMutation({
    mutationFn: (correctionId: number) => cancelCorrection(correctionId),
    onSuccess: () => {
      toasts.success("Correction request cancelled.");
      void queryClient.invalidateQueries({ queryKey: ["corrections"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  return (
    <div>
      <PageHeader
        title="Corrections"
        description={
          isCollege
            ? "Field corrections the reviewing officer requested. Open a case to record the corrected values - the response creates a new version automatically."
            : "Correction requests across your jurisdiction. Responses create a new immutable version and invalidate checks on changed fields."
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <label>
            <span className="app-label">Status</span>
            <select className="app-input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Case id (exact)</span>
            <input
              className="app-input"
              value={values.fdrId}
              inputMode="numeric"
              placeholder="e.g. 15"
              onChange={(e) => set({ fdrId: e.target.value.replace(/\D/g, "") })}
            />
          </label>
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading corrections..." />
      ) : list.isError ? (
        <ErrorState title="Could not load corrections" detail={errorToMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No corrections in this view"
            detail={
              isCollege
                ? "When the reviewing officer asks for a correction it appears here and in the case workspace."
                : "Nothing matches the filters. Raise corrections from inside a case under review."
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Fields requested</th>
                  <th scope="col">Status</th>
                  <th scope="col">Raised</th>
                  {isOfficer && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.fdrId != null && item.fdrPublicCode != null ? (
                        <Link to={`/fdrs/${item.fdrId}`} className="font-medium text-teal-700 hover:underline">
                          {item.fdrPublicCode}
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                      {item.institutionName != null && <p className="text-xs text-slate-500">{item.institutionName}</p>}
                    </td>
                    <td className="max-w-sm">
                      <p className="truncate text-xs text-slate-700" title={item.fields.map((f) => f.label).join(", ")}>
                        {item.fields.map((f) => f.label).join(", ")}
                      </p>
                      {item.fields[0]?.reason != null && (
                        <p className="truncate text-xs text-slate-400" title={item.fields[0].reason}>
                          {item.fields[0].reason}
                        </p>
                      )}
                    </td>
                    <td>
                      <CorrectionStatusBadge status={item.status} />
                      {item.respondedVersionNo != null && (
                        <p className="mt-0.5 text-xs text-teal-700">version {item.respondedVersionNo} created</p>
                      )}
                    </td>
                    <td className="text-xs text-slate-500">
                      {formatDateTimeShort(item.createdAt)}
                      <p className="text-slate-400">by {item.requestedByName ?? "unknown"}</p>
                    </td>
                    {isOfficer && (
                      <td>
                        {item.status === "OPEN" && (
                          <Button
                            type="button"
                            variant="secondary"
                            className="!border-rose-300 !text-rose-700 hover:!bg-rose-50 !py-1 !px-2.5 text-xs"
                            disabled={cancel.isPending}
                            onClick={() => cancel.mutate(item.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onGoto={(target) => set({ page: target }, { keepPage: true })}
          />
        </Card>
      )}

      {isCollege && (
        <Card className="mt-4">
          <CardHeader title="How corrections work" />
          <CardBody>
            <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
              <li>The reviewing officer lists the fields to correct, with a reason for each.</li>
              <li>You record corrected values from the case workspace (Corrections tab).</li>
              <li>The response becomes the next immutable version; checks on changed fields are invalidated automatically.</li>
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
