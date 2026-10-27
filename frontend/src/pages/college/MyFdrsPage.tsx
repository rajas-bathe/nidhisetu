import { type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { fetchFdrs } from "../../services/auth";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { DateConditionBadge, ReleaseStatusBadge, ReviewStatusBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { formatLocalDate, formatMoney, formatRelativeDays } from "../../utils/format";
import type { ReviewStatus, DateCondition } from "@sih26265/contracts";

const REVIEW_STATUSES: ReviewStatus[] = ["draft", "submitted", "under_review", "discrepancy", "verified"];
const DATE_CONDITIONS: DateCondition[] = ["current", "approaching_maturity", "matured"];
const SORTS = [
  { value: "maturity_asc", label: "Maturity ↑ (soonest first)" },
  { value: "maturity_desc", label: "Maturity ↓" },
  { value: "created_desc", label: "Newest submissions" },
];

export function MyFdrsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const dateCondition = searchParams.get("dateCondition") ?? "";
  const sort = searchParams.get("sort") ?? "maturity_asc";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const list = useQuery({
    queryKey: ["fdrs", { q, status, dateCondition, sort, page }],
    queryFn: () =>
      fetchFdrs({
        q: q || undefined,
        status: status || undefined,
        dateCondition: dateCondition || undefined,
        sort,
        page,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const update = (next: Partial<Record<"q" | "status" | "dateCondition" | "sort", string>>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page"); // filter changes reset pagination
    setSearchParams(params, { replace: true });
  };

  const gotoPage = (target: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(target));
    setSearchParams(params, { replace: true });
  };

  const onSubmitSearch = (event: FormEvent) => {
    event.preventDefault();
  };

  const data = list.data;

  return (
    <div>
      <PageHeader
        title="My FDRs"
        description="Institution-scoped register. Search matches case code, receipt reference, bank and branch."
      />

      <Card className="mb-4">
        <form onSubmit={onSubmitSearch} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="app-label">Search</span>
            <input
              className="app-input"
              value={q}
              placeholder="e.g. reference, bank, code"
              onChange={(e) => update({ q: e.target.value })}
            />
          </label>
          <label>
            <span className="app-label">Review status</span>
            <select className="app-input" value={status} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              {REVIEW_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Date condition</span>
            <select className="app-input" value={dateCondition} onChange={(e) => update({ dateCondition: e.target.value })}>
              <option value="">All dates</option>
              {DATE_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Sort</span>
            <select className="app-input" value={sort} onChange={(e) => update({ sort: e.target.value })}>
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </form>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading instruments…" />
      ) : list.isError ? (
        <ErrorState title="Could not load the register" detail={String(list.error)} onRetry={() => void list.refetch()} />
      ) : data == null || data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No records match"
            detail="Adjust or clear the filters above. New submissions appear here automatically."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Bank</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Maturity</th>
                  <th scope="col">Statuses</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className={item.daysToMaturity < 0 ? "bg-rose-50/40" : undefined}>
                    <td>
                      <Link to={`/fdrs?q=${encodeURIComponent(item.publicCode)}`} className="font-medium text-teal-700 hover:underline">
                        {item.publicCode}
                      </Link>
                      <p className="text-xs text-slate-500">
                        submitted {item.submittedAt == null ? "—" : formatLocalDate(item.submittedAt.slice(0, 10))}
                      </p>
                    </td>
                    <td>
                      <p className="text-slate-800">{item.bankName}</p>
                      <p className="text-xs text-slate-500">{item.bankBranch}</p>
                    </td>
                    <td className="font-mono text-xs text-slate-600">{item.referenceNo}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatMoney(item.amount)}</td>
                    <td className="whitespace-nowrap">
                      <span className="text-slate-700">{formatLocalDate(item.maturityDate)}</span>
                      <span className={`block text-xs ${item.daysToMaturity < 0 ? "text-rose-600" : "text-amber-600"}`}>
                        {formatRelativeDays(item.daysToMaturity)}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <ReviewStatusBadge status={item.status} />
                        <DateConditionBadge condition={item.dateCondition} />
                        <ReleaseStatusBadge status={item.releaseStatus} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {data.total === 0 ? "0 records" : `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={data.page <= 1} onClick={() => gotoPage(data.page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => gotoPage(data.page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
