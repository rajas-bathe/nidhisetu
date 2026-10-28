/**
 * Reports (5 kinds, jurisdiction-scoped) with CSV export. Rows come ready
 * serialized from the server (exact rupee decimals, ISO dates); the CSV uses
 * the identical serialization with a formula-injection guard.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { downloadReportCsv, fetchReport } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { formatLocalDate } from "../../utils/format";
import { REPORT_KIND_LABELS } from "@sih26265/contracts";
import type { ReportKind } from "@sih26265/contracts";

const KINDS: ReportKind[] = [
  "register",
  "upcoming_maturity",
  "pending_corrections",
  "replacement_obligations",
  "release_status",
];

export function ReportsPage() {
  const toasts = useToasts();
  const [kind, setKind] = useState<ReportKind>("register");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [page, setPage] = useState(1);

  const report = useQuery({
    queryKey: ["report", { kind, includeSuperseded }],
    queryFn: () => fetchReport(kind, { includeSuperseded: includeSuperseded || undefined }),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    try {
      await downloadReportCsv(kind, { includeSuperseded: includeSuperseded || undefined });
      toasts.success("CSV export downloaded.");
    } catch (error) {
      toasts.error(errorToMessage(error));
    }
  };

  const data = report.data;
  const pageSize = 25;
  const pageRows = data?.rows.slice((page - 1) * pageSize, page * pageSize) ?? [];

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Authorized-scope reports generated from recorded facts only. Sample labels stay attached; exports carry the same guard rails."
        actions={
          report.isSuccess && data != null ? (
            <Button type="button" variant="secondary" onClick={() => void exportCsv()}>
              <Download className="h-4 w-4" aria-hidden /> Download CSV
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label>
            <span className="app-label">Report</span>
            <select
              className="app-input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ReportKind);
                setPage(1);
              }}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {REPORT_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              checked={includeSuperseded}
              onChange={(e) => {
                setIncludeSuperseded(e.target.checked);
                setPage(1);
              }}
            />
            <span className="text-sm text-slate-600">Include superseded instruments</span>
          </label>
        </div>
      </Card>

      {report.isPending ? (
        <Spinner label="Generating the report..." />
      ) : report.isError ? (
        <ErrorState title="Could not generate the report" detail={errorToMessage(report.error)} onRetry={() => void report.refetch()} />
      ) : data == null || data.rows.length === 0 ? (
        <Card>
          <EmptyState title="No rows for this report" detail="Records appear as the workflow progresses in your scope." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={REPORT_KIND_LABELS[data.kind]}
            subtitle={`${data.count} rows - generated ${formatLocalDate(data.generatedAt.slice(0, 10))} from an authorized scope query`}
          />
          <CardBody className="!pt-2">
            {data.isSample && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" role="status">
                SAMPLE: {data.sampleNote}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    {data.columns.map((column) => (
                      <th key={column.key} scope="col">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id}>
                      {data.columns.map((column) => (
                        <td key={column.key} className={column.type === "money" ? "whitespace-nowrap tabular-nums" : undefined}>
                          {row.cells[column.key] ?? "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={data.rows.length} onGoto={setPage} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
