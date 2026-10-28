/**
 * FDR register. One screen serves all roles: scope comes from the server
 * (colleges see only their own rows; officers see their jurisdiction; the
 * admin sees everything). Filters, sort and page live in the URL.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { fetchFdrs, fetchInstitutions } from "../../services/portal";
import { useAuth } from "../../auth/AuthProvider";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { DateConditionBadge, ReleaseStatusBadge, ReviewStatusBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";
import { formatLocalDate, formatMoney, formatRelativeDays } from "../../utils/format";

const REVIEW_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under review" },
  { value: "discrepancy", label: "Discrepancy" },
  { value: "verified", label: "Verified" },
];

const DATE_CONDITION_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "approaching_maturity", label: "Approaching maturity" },
  { value: "matured", label: "Matured" },
];

const SORT_OPTIONS = [
  { value: "maturity_asc", label: "Maturity (soonest first)" },
  { value: "maturity_desc", label: "Maturity (latest first)" },
  { value: "created_desc", label: "Newest submissions" },
];

const SUPERSEDED_OPTIONS = [
  { value: "exclude", label: "Active only (recommended)" },
  { value: "include", label: "Include superseded" },
  { value: "only", label: "Superseded only" },
];

export function FdrRegisterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { values, set, pageAsNumber } = useUrlListState({
    q: "",
    status: "",
    dateCondition: "",
    sort: "maturity_asc",
    superseded: user?.role === "COLLEGE_USER" ? "" : "exclude",
    institutionId: "",
  });

  const isAdmin = user?.role === "SYSTEM_ADMIN";
  const institutions = useQuery({
    queryKey: ["institutions", "directory", 200],
    queryFn: () => fetchInstitutions({ page: 1, pageSize: 50, sort: "name_asc" }),
    enabled: isAdmin,
  });

  const list = useQuery({
    queryKey: [
      "fdrs",
      {
        q: values.q,
        status: values.status,
        dateCondition: values.dateCondition,
        sort: values.sort,
        superseded: values.superseded,
        institutionId: values.institutionId,
        page: pageAsNumber,
      },
    ],
    queryFn: () =>
      fetchFdrs({
        q: values.q || undefined,
        status: values.status || undefined,
        dateCondition: values.dateCondition || undefined,
        sort: values.sort || "maturity_asc",
        superseded: values.superseded || undefined,
        institutionId: values.institutionId ? Number(values.institutionId) : undefined,
        page: pageAsNumber,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  const isCollege = user?.role === "COLLEGE_USER";

  return (
    <div>
      <PageHeader
        title={isCollege ? "My instruments" : "FDR Register"}
        description={
          isCollege
            ? "Every security deposit and bank guarantee recorded for your institution."
            : "Jurisdiction-scoped register of security deposits and bank guarantees. Open a case to review it."
        }
        actions={
          isCollege ? (
            <Link to="/fdrs/new">
              <Button type="button">New submission</Button>
            </Link>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="app-label">Search</span>
            <input
              className="app-input"
              value={values.q}
              placeholder="Case code, receipt reference, bank, branch"
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
          <label>
            <span className="app-label">Review status</span>
            <select className="app-input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>
              {REVIEW_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Maturity</span>
            <select className="app-input" value={values.dateCondition} onChange={(e) => set({ dateCondition: e.target.value })}>
              <option value="">All dates</option>
              {DATE_CONDITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Sort</span>
            <select className="app-input" value={values.sort} onChange={(e) => set({ sort: e.target.value })}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isAdmin && (
            <label>
              <span className="app-label">Institution</span>
              <select
                className="app-input"
                value={values.institutionId}
                onChange={(e) => set({ institutionId: e.target.value })}
              >
                <option value="">All institutions</option>
                {(institutions.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isCollege && (
            <label>
              <span className="app-label">Superseded</span>
              <select className="app-input" value={values.superseded} onChange={(e) => set({ superseded: e.target.value })}>
                {SUPERSEDED_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading instruments..." />
      ) : list.isError ? (
        <ErrorState title="Could not load the register" detail={String(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No records match"
            detail={
              isCollege
                ? "Adjust or clear the filters above. Start a new submission to record an instrument."
                : "Adjust or clear the filters above."
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
                  {isAdmin && <th scope="col">Institution</th>}
                  <th scope="col">Bank</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Maturity</th>
                  <th scope="col">Statuses</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr
                    key={item.id}
                    className={item.daysToMaturity < 0 && item.status !== "draft" ? "bg-rose-50/40" : undefined}
                  >
                    <td>
                      <Link to={`/fdrs/${item.id}`} className="font-medium text-teal-700 hover:underline">
                        {item.publicCode}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {item.instrumentType === "BANK_GUARANTEE" ? "Bank guarantee" : "Security deposit"}
                      </p>
                    </td>
                    {isAdmin && <td className="text-xs text-slate-600">{item.institution.name}</td>}
                    <td>
                      <p className="text-slate-800">{item.bankName}</p>
                      <p className="text-xs text-slate-500">{item.bankBranch}</p>
                    </td>
                    <td className="font-mono text-xs text-slate-600">{item.referenceNo}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatMoney(item.amount)}</td>
                    <td className="whitespace-nowrap">
                      <span className="text-slate-700">{formatLocalDate(item.maturityDate)}</span>
                      <span className={`block text-xs ${item.daysToMaturity < 0 ? "text-rose-600" : "text-amber-600"}`}>
                        {item.status === "draft" ? "draft" : formatRelativeDays(item.daysToMaturity)}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <ReviewStatusBadge status={item.status} />
                        <DateConditionBadge condition={item.dateCondition} />
                        <ReleaseStatusBadge status={item.releaseStatus} />
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => navigate(`/fdrs/${item.id}`)}
                        className="text-sm font-medium text-teal-700 hover:underline"
                      >
                        Open
                      </button>
                    </td>
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
