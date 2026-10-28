/** Audit trail: safe, human-readable workflow history (no secrets). */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchAudit } from "../../services/portal";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";
import { formatDateTimeShort } from "../../utils/format";

export function AuditPage() {
  const { values, set, pageAsNumber } = useUrlListState({ q: "", action: "" });

  const list = useQuery({
    queryKey: ["audit", { q: values.q, action: values.action, page: pageAsNumber }],
    queryFn: () =>
      fetchAudit({
        q: values.q || undefined,
        action: values.action || undefined,
        page: pageAsNumber,
        pageSize: 15,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Every workflow event, recorded at write time. Password hashes, session tokens and raw payloads are never recorded - summaries only."
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <label className="sm:col-span-2">
            <span className="app-label">Search</span>
            <input
              className="app-input"
              value={values.q}
              placeholder="Case code, name, summary text"
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
          <label>
            <span className="app-label">Action contains</span>
            <input
              className="app-input"
              value={values.action}
              placeholder="e.g. SUBMIT"
              onChange={(e) => set({ action: e.target.value.toUpperCase() })}
            />
          </label>
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading the audit trail..." />
      ) : list.isError ? (
        <ErrorState title="Could not load the audit trail" detail={String(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState title="No audit entries match" detail="Adjust the filters above." />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Case</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap text-xs text-slate-500">{formatDateTimeShort(item.createdAt)}</td>
                    <td className="text-xs text-slate-700">
                      {item.actorName ?? "-"}
                      {item.actorRole != null && <span className="block text-slate-400">{item.actorRole.replace(/_/g, " ").toLowerCase()}</span>}
                    </td>
                    <td className="font-mono text-[11px] text-slate-600">{item.action}</td>
                    <td className="text-xs text-slate-600">{item.fdrPublicCode ?? "-"}</td>
                    <td className="max-w-md text-xs text-slate-600">{item.summary}</td>
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
    </div>
  );
}
