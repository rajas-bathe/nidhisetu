/** Admin: colleges directory (search, filters, paging, create, quick status). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchInstitutions, setInstitutionStatus } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";

export function CollegesPage() {
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const { values, set, pageAsNumber } = useUrlListState({ q: "", status: "", assignment: "", role: "", sort: "name_asc" });

  const toggleStatus = useMutation({
    mutationFn: (input: { id: number; next: "ACTIVE" | "INACTIVE" }) =>
      setInstitutionStatus(input.id, {
        status: input.next,
        note: input.next === "INACTIVE" ? "Deactivated from the colleges list." : "Reactivated from the colleges list.",
      }),
    onSuccess: (_, input) => {
      toasts.success(
        input.next === "INACTIVE"
          ? "College deactivated; new submissions are blocked, history stays readable."
          : "College reactivated.",
      );
      void queryClient.invalidateQueries({ queryKey: ["institutions"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const list = useQuery({
    queryKey: [
      "institutions",
      { q: values.q, status: values.status, assignment: values.assignment, role: values.role, sort: values.sort, page: pageAsNumber },
    ],
    queryFn: () =>
      fetchInstitutions({
        q: values.q || undefined,
        status: values.status || undefined,
        assignment: values.assignment || undefined,
        role: values.role || undefined,
        sort: values.sort || "name_asc",
        page: pageAsNumber,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Colleges"
        description="Institution records with their officer assignments. Deactivation preserves all history but blocks new submissions (sample policy)."
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="lg:col-span-2">
            <span className="app-label">Search</span>
            <input className="app-input" value={values.q} placeholder="Name, code, city" onChange={(e) => set({ q: e.target.value })} />
          </label>
          <label>
            <span className="app-label">Status</span>
            <select className="app-input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <label>
            <span className="app-label">Officer assignment</span>
            <select className="app-input" value={values.assignment} onChange={(e) => set({ assignment: e.target.value })}>
              <option value="">All</option>
              <option value="assigned">Has the role</option>
              <option value="unassigned">Missing the role</option>
            </select>
          </label>
          {values.assignment !== "" && (
            <label>
              <span className="app-label">Role for assignment filter</span>
              <select className="app-input" value={values.role} onChange={(e) => set({ role: e.target.value })}>
                <option value="">Any role</option>
                <option value="REVIEW_OFFICER">Reviewing officer</option>
                <option value="APPROVING_AUTHORITY">Approving authority</option>
              </select>
            </label>
          )}
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading colleges..." />
      ) : list.isError ? (
        <ErrorState title="Could not load colleges" detail={errorToMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState title="No colleges match" detail="Adjust the filters or add a college." />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">College</th>
                  <th scope="col">Location</th>
                  <th scope="col">Reviewing officers</th>
                  <th scope="col">Authorities</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/admin/colleges/${item.id}`} className="font-medium text-teal-700 hover:underline">
                        {item.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {item.code}
                        {item.officialCode != null && item.officialCode !== item.code ? ` (official: ${item.officialCode})` : ""}
                        {item.isDemo && " - demo seed"}
                      </p>
                    </td>
                    <td className="text-xs text-slate-600">
                      {[item.city, item.state].filter(Boolean).join(", ") || "-"}
                    </td>
                    <td className="text-xs text-slate-600">
                      {item.reviewOfficers.length === 0 ? (
                        <span className="text-amber-700">none assigned</span>
                      ) : (
                        item.reviewOfficers.map((o) => o.fullName).join(", ")
                      )}
                    </td>
                    <td className="text-xs text-slate-600">
                      {item.authorityOfficers.length === 0 ? (
                        <span className="text-amber-700">none assigned</span>
                      ) : (
                        item.authorityOfficers.map((o) => o.fullName).join(", ")
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          item.status === "ACTIVE" ? "bg-teal-50 text-teal-700 ring-teal-300" : "bg-slate-100 text-slate-500 ring-slate-300"
                        }`}
                      >
                        {item.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                      {!item.canAcceptSubmissions && (
                        <p className="mt-0.5 text-[10px] text-rose-600">submissions blocked</p>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          className="!px-2 !py-1 text-xs"
                          onClick={() =>
                            toggleStatus.mutate({ id: item.id, next: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
                          }
                        >
                          {item.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
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

      <Card className="mt-4">
        <CardHeader title="Sample policy reminder" />
        <CardBody>
          <p className="text-sm text-slate-600">
            SAMPLE policy: a deactivated college cannot start new submissions; existing cases stay readable and
            authorized officers can still complete them. The college's users lose their sessions immediately.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
