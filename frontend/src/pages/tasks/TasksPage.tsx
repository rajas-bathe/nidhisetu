/** Task inbox: open work assigned to the acting role/institution. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchTasks } from "../../services/portal";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { TaskStatusBadge, TaskTypeBadge } from "../../components/ui/Badges";
import { Pagination } from "../../components/ui/Pagination";
import { useUrlListState } from "../../utils/useUrlState";
import { formatLocalDate } from "../../utils/format";
import { TASK_TYPE_LABELS } from "@sih26265/contracts";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function TasksPage() {
  const { values, set, pageAsNumber } = useUrlListState({ status: "OPEN", type: "", q: "" });

  const list = useQuery({
    queryKey: ["tasks", { status: values.status, type: values.type, q: values.q, page: pageAsNumber }],
    queryFn: () =>
      fetchTasks({
        status: values.status || "OPEN",
        type: values.type || undefined,
        q: values.q || undefined,
        page: pageAsNumber,
        pageSize: 10,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Work the workflow assigned to your role or institution. Opening a task takes you to the case workspace where the action lives."
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
            <span className="app-label">Type</span>
            <select className="app-input" value={values.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">All types</option>
              {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="app-label">Search</span>
            <input className="app-input" value={values.q} placeholder="Title text" onChange={(e) => set({ q: e.target.value })} />
          </label>
        </div>
      </Card>

      {list.isPending ? (
        <Spinner label="Loading tasks..." />
      ) : list.isError ? (
        <ErrorState title="Could not load tasks" detail={String(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data == null || list.data.items.length === 0 ? (
        <Card>
          <EmptyState title="No tasks in this view" detail="Tasks are created automatically by the workflow; nothing to do here right now." />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Type</th>
                  <th scope="col">Case</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((task) => (
                  <tr key={task.id} className={task.isOverdue ? "bg-rose-50/40" : undefined}>
                    <td className="max-w-sm">
                      <p className="text-slate-800">{task.title}</p>
                      {task.detail != null && <p className="truncate text-xs text-slate-500" title={task.detail}>{task.detail}</p>}
                    </td>
                    <td><TaskTypeBadge type={task.type} /></td>
                    <td>
                      {task.fdrId != null && task.fdrPublicCode != null ? (
                        <Link to={`/fdrs/${task.fdrId}`} className="font-medium text-teal-700 hover:underline">
                          {task.fdrPublicCode}
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatLocalDate(task.dueDate)}
                      {task.isOverdue && <span className="ml-1 font-medium text-rose-600">overdue</span>}
                    </td>
                    <td><TaskStatusBadge status={task.status} /></td>
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
