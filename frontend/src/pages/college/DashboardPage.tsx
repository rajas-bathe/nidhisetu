import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, Inbox, Landmark, Receipt, TriangleAlert } from "lucide-react";
import { fetchDashboard } from "../../services/auth";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { ReviewStatusBadge, TaskTypeBadge } from "../../components/ui/Badges";
import { formatLocalDate, formatMoney, formatRelativeDays } from "../../utils/format";
import { useAuth } from "../../auth/AuthProvider";

interface MetricCardProps {
  label: string;
  value: number;
  detail: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "attention";
}

function MetricCard({ label, value, detail, href, icon: Icon, tone = "default" }: MetricCardProps) {
  const body = (
    <div className="app-card h-full p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className={`h-4 w-4 ${tone === "attention" ? "text-amber-600" : "text-slate-400"}`} aria-hidden />
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === "attention" && value > 0 ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
  return href != null ? (
    <Link to={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard, refetchInterval: 60_000 });

  if (dashboard.isPending) {
    return <Spinner label="Loading your dashboard…" />;
  }
  if (dashboard.isError) {
    return <ErrorState title="The dashboard could not be loaded" detail={String(dashboard.error)} onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const isCollege = data.role === "COLLEGE_USER";

  return (
    <div>
      <PageHeader
        title={isCollege ? "Institution dashboard" : "Officer dashboard"}
        description={
          isCollege
            ? `${data.institution?.name ?? ""} — live numbers from the database, nothing hardcoded.`
            : `Work inside your assigned jurisdiction. ${data.counters.awaitingMyAction > 0 ? "You have open tasks below." : "No open tasks are assigned to you right now."}`
        }
        actions={
          isCollege && user != null ? undefined : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label={isCollege ? "Awaiting verification" : "Pending verification"}
          value={data.counters.pendingVerification}
          detail={isCollege ? "Your cases in the review pipeline" : "Cases inside your jurisdiction"}
          icon={ClipboardList}
          href="/fdrs?status=submitted"
        />
        <MetricCard
          label="Action required"
          value={data.counters.awaitingMyAction}
          detail={isCollege ? "Tasks assigned to your institution" : "Tasks assigned to you personally"}
          icon={Inbox}
          tone="attention"
        />
        <MetricCard
          label="Overdue"
          value={data.counters.overdueTasks}
          detail="Open tasks past their due date"
          icon={TriangleAlert}
          tone="attention"
        />
        <MetricCard
          label="Approaching maturity"
          value={data.counters.approachingMaturity}
          detail={`Within the next ${data.approachingWindowDays} days (sample setting)`}
          icon={CalendarClock}
          href="/fdrs?dateCondition=approaching_maturity"
        />
        <MetricCard
          label={isCollege ? "Current instruments" : "Live instruments"}
          value={data.counters.currentInstruments}
          detail="Not superseded by an accepted replacement"
          icon={Receipt}
          href="/fdrs"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Action required" subtitle="Open work with its due date and owning party" />
          <CardBody className="p-0">
            {data.actionRequiredTasks.length === 0 ? (
              <EmptyState title="Nothing assigned" detail="When tasks arrive they appear here with a direct case link." />
            ) : (
              <ul role="list" className="divide-y divide-slate-100">
                {data.actionRequiredTasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <TaskTypeBadge type={task.type} />
                        {task.isOverdue && (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-300">
                            Overdue
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-900">{task.title}</p>
                      {task.detail != null && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{task.detail}</p>}
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-medium ${task.isOverdue ? "text-rose-700" : "text-slate-500"}`}>
                        due {formatLocalDate(task.dueDate)}
                      </p>
                      {task.fdrPublicCode != null && (
                        <Link to={`/fdrs?q=${encodeURIComponent(task.fdrPublicCode)}`} className="mt-1 inline-block text-xs font-medium text-teal-700 hover:underline">
                          {task.fdrPublicCode} →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Upcoming maturity dates" subtitle="Approaching or already matured, nearest first" />
          <CardBody className="p-0">
            {data.upcomingMaturity.length === 0 ? (
              <EmptyState title="No dates to watch" detail="Nothing approaches maturity inside the sample window." />
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Maturity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcomingMaturity.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium text-slate-900">{item.publicCode}</p>
                          <p className="text-xs text-slate-500">{item.bankName}</p>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{formatMoney(item.amount)}</td>
                        <td className="whitespace-nowrap">
                          <span className="text-slate-700">{formatLocalDate(item.maturityDate)}</span>
                          <span className={`block text-xs ${item.daysToMaturity < 0 ? "text-rose-600" : "text-amber-600"}`}>
                            {formatRelativeDays(item.daysToMaturity)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent submissions" subtitle="Latest cases entering the pipeline" />
          <CardBody className="p-0">
            {data.recentSubmissions.length === 0 ? (
              <EmptyState title="No submissions yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Review status</th>
                      <th scope="col">Maturity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSubmissions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium text-slate-900">{item.publicCode}</p>
                          <p className="text-xs text-slate-500">{item.institution.name}</p>
                        </td>
                        <td><ReviewStatusBadge status={item.status} /></td>
                        <td className="whitespace-nowrap text-slate-600">{formatLocalDate(item.maturityDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sample policy in effect" subtitle="Clearly-labelled demonstration values" />
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-slate-400" aria-hidden />
              "Approaching maturity" flag: <strong>{data.approachingWindowDays} days</strong> before maturity (sample setting)
            </p>
            <p>
              Reminder thresholds, escalation stages and release prerequisites will appear here as
              versioned sample policies — none of these numbers are official regulations.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
