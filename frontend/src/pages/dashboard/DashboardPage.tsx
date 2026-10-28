/**
 * Role-aware dashboard. The server picks the counter set from the acting
 * role; the UI mirrors exactly what the backend computed - never fabricated.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  ClipboardList,
  History,
  Inbox,
  ShieldAlert,
} from "lucide-react";
import { fetchDashboard } from "../../services/portal";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { DateConditionBadge, ReviewStatusBadge } from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { formatLocalDate, formatMoney, formatRelativeDays, formatDateTimeShort } from "../../utils/format";
import type {
  AdminCounters,
  AuthorityCounters,
  CollegeCounters,
  DashboardResponse,
  OfficerCounters,
  UserRole,
} from "@sih26265/contracts";

interface CounterCard {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "navy" | "teal" | "amber" | "rose" | "violet";
  to?: string;
}

const TONES: Record<CounterCard["tone"], string> = {
  navy: "bg-navy-50 text-navy-900 ring-navy-100",
  teal: "bg-teal-50 text-teal-800 ring-teal-100",
  amber: "bg-amber-50 text-amber-800 ring-amber-100",
  rose: "bg-rose-50 text-rose-800 ring-rose-100",
  violet: "bg-violet-50 text-violet-800 ring-violet-100",
};

function collegeCounters(c: CollegeCounters): CounterCard[] {
  return [
    { label: "Active instruments", value: String(c.activeInstruments), icon: Banknote, tone: "navy" },
    { label: "Held as deposits", value: formatMoney(c.activeAmount), icon: Banknote, tone: "teal" },
    { label: "Awaiting review", value: String(c.awaitingReview), icon: ClipboardList, tone: "amber", to: "/fdrs?status=submitted" },
    { label: "Corrections to answer", value: String(c.correctionsRequired), icon: Inbox, tone: "rose", to: "/corrections" },
    { label: "Approaching maturity", value: String(c.approachingMaturity), icon: CalendarClock, tone: "amber" },
    { label: "Open renewal obligations", value: String(c.openReplacementObligations), icon: AlertTriangle, tone: "rose" },
    { label: "Release requests pending", value: String(c.pendingReleaseRequests), icon: ShieldAlert, tone: "violet", to: "/releases" },
    { label: "Drafts", value: String(c.drafts), icon: Banknote, tone: "navy", to: "/fdrs?status=draft" },
  ];
}

function officerCounters(c: OfficerCounters): CounterCard[] {
  return [
    { label: "Submitted - to review", value: String(c.submittedAwaitingReview), icon: ClipboardList, tone: "amber", to: "/fdrs?status=submitted" },
    { label: "Under review", value: String(c.underReview), icon: ClipboardList, tone: "navy", to: "/fdrs?status=under_review" },
    { label: "Corrections with college", value: String(c.correctionsAwaitingCollege), icon: Inbox, tone: "violet", to: "/corrections" },
    { label: "Corrected - re-check ready", value: String(c.correctedReadyForReReview), icon: ClipboardList, tone: "teal" },
    { label: "Replacements to review", value: String(c.replacementsAwaitingReview), icon: History, tone: "amber", to: "/replacements" },
    { label: "Releases to recommend", value: String(c.releasesAwaitingRecommendation), icon: ShieldAlert, tone: "rose", to: "/releases" },
    { label: "My open tasks", value: String(c.assignedTasks), icon: ClipboardList, tone: "teal", to: "/tasks" },
    { label: "Overdue tasks", value: String(c.overdueTasks), icon: AlertTriangle, tone: "rose", to: "/tasks?status=OPEN" },
  ];
}

function authorityCounters(c: AuthorityCounters): CounterCard[] {
  return [
    { label: "Releases awaiting decision", value: String(c.releasesAwaitingDecision), icon: ShieldAlert, tone: "amber", to: "/approvals?kind=release_decision" },
    { label: "Replacements awaiting acceptance", value: String(c.replacementsAwaitingAcceptance), icon: History, tone: "violet", to: "/approvals?kind=replacement_acceptance" },
    { label: "Approved - completion pending", value: String(c.releasesAwaitingCompletion), icon: CalendarClock, tone: "teal", to: "/releases?stage=approved" },
    { label: "Overdue decisions", value: String(c.overdueDecisions), icon: AlertTriangle, tone: "rose", to: "/tasks" },
  ];
}

function adminCounters(c: AdminCounters): CounterCard[] {
  return [
    { label: "Active colleges", value: String(c.activeColleges), icon: Building2, tone: "teal", to: "/admin/colleges?status=ACTIVE" },
    { label: "Inactive colleges", value: String(c.inactiveColleges), icon: Building2, tone: "rose", to: "/admin/colleges?status=INACTIVE" },
    { label: "College users", value: String(c.collegeUsers), icon: Building2, tone: "navy", to: "/admin/users?role=COLLEGE_USER" },
    { label: "Reviewing officers", value: String(c.reviewOfficers), icon: Building2, tone: "navy", to: "/admin/users?role=REVIEW_OFFICER" },
    { label: "Approving authorities", value: String(c.authorities), icon: Building2, tone: "navy", to: "/admin/users?role=APPROVING_AUTHORITY" },
    { label: "Colleges missing officers", value: String(c.missingAssignmentColleges), icon: AlertTriangle, tone: "amber", to: "/admin/colleges?assignment=unassigned&role=REVIEW_OFFICER" },
  ];
}

// (icon helper removed - History is imported directly above)

const ROLE_DASH_TITLES: Record<UserRole, string> = {
  COLLEGE_USER: "College dashboard",
  REVIEW_OFFICER: "Reviewing officer dashboard",
  APPROVING_AUTHORITY: "Approving authority dashboard",
  SYSTEM_ADMIN: "Administration dashboard",
};

export function DashboardPage() {
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    placeholderData: keepPreviousData,
  });

  if (dash.isPending) {
    return <Spinner label="Loading your dashboard..." />;
  }
  if (dash.isError) {
    return (
      <ErrorState
        title="Could not load the dashboard"
        detail={String(dash.error)}
        onRetry={() => void dash.refetch()}
      />
    );
  }

  const data: DashboardResponse = dash.data;
  let cards: CounterCard[] = [];
  if ("activeInstruments" in data.counters) cards = collegeCounters(data.counters);
  else if ("submittedAwaitingReview" in data.counters) cards = officerCounters(data.counters);
  else if ("releasesAwaitingDecision" in data.counters) cards = authorityCounters(data.counters);
  else if ("activeColleges" in data.counters) cards = adminCounters(data.counters);

  return (
    <div>
      <PageHeader
        title={ROLE_DASH_TITLES[data.role]}
        description={
          data.institution != null
            ? `${data.institution.name} (${data.institution.code}) - sample window: ${data.approachingWindowDays} days to maturity.`
            : `Sample window: ${data.approachingWindowDays} days to maturity. Updated ${formatDateTimeShort(data.generatedAt)}.`
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const body = (
            <div className={`app-card flex items-center gap-3 p-3 ring-1 ${TONES[card.tone]}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70">
                <Icon className="h-4.5 w-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-2xl font-semibold tabular-nums leading-tight">{card.value}</p>
                <p className="truncate text-xs text-slate-500">{card.label}</p>
              </div>
            </div>
          );
          return card.to != null ? (
            <Link key={card.label} to={card.to} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
              {body}
            </Link>
          ) : (
            <div key={card.label}>{body}</div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Approaching or matured instruments"
            subtitle="Nearest maturity first - all in your scope."
          />
          {data.upcomingMaturity.length === 0 ? (
            <EmptyState title="Nothing maturing soon" detail="Instruments appear here inside the sample window." />
          ) : (
            <CardBody className="divide-y divide-slate-100 !px-0 !py-0">
              {data.upcomingMaturity.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  to={`/fdrs/${item.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-teal-700">
                      {item.publicCode}
                      {data.institution == null && item.institution.name.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-slate-500">{item.institution.name}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">{item.bankName} - {formatMoney(item.amount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-600">{formatLocalDate(item.maturityDate)}</p>
                    <p className={`text-xs ${item.daysToMaturity < 0 ? "text-rose-600" : "text-amber-600"}`}>
                      {formatRelativeDays(item.daysToMaturity)}
                    </p>
                  </div>
                </Link>
              ))}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Open work" subtitle="Tasks that need the current role to act." />
          {data.actionRequiredTasks.length === 0 ? (
            <EmptyState title="No open work" detail="When the workflow assigns you a task, it appears here." />
          ) : (
            <CardBody className="divide-y divide-slate-100 !px-0 !py-0">
              {data.actionRequiredTasks.slice(0, 6).map((task) => (
                <Link
                  key={task.id}
                  to={task.fdrId != null ? `/fdrs/${task.fdrId}` : "/tasks"}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800">{task.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {task.fdrPublicCode ?? "General"} - due {formatLocalDate(task.dueDate)}
                      {task.isOverdue && <span className="ml-1 font-medium text-rose-600">(overdue)</span>}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                </Link>
              ))}
            </CardBody>
          )}
          <CardBody className="border-t border-slate-100">
            <Link to="/tasks" className="text-sm font-medium text-teal-700 hover:underline">
              View all tasks
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent submissions" subtitle="Latest cases, newest first." />
          {data.recentSubmissions.length === 0 ? (
            <EmptyState title="No submissions yet" />
          ) : (
            <CardBody className="divide-y divide-slate-100 !px-0 !py-0">
              {data.recentSubmissions.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  to={`/fdrs/${item.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-teal-700">{item.publicCode}</p>
                    <p className="truncate text-xs text-slate-500">{item.bankName} - {formatMoney(item.amount)}</p>
                  </div>
                  <ReviewStatusBadge status={item.status} />
                </Link>
              ))}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Workflow history visible to you." />
          {data.recentActivity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <CardBody className="divide-y divide-slate-100 !px-0 !py-0">
              {data.recentActivity.slice(0, 7).map((entry) => (
                <div key={entry.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-800">{entry.actionLabel}</p>
                    <p className="shrink-0 text-xs text-slate-400">{formatDateTimeShort(entry.createdAt)}</p>
                  </div>
                  {entry.summary != null && <p className="mt-0.5 text-xs text-slate-500">{entry.summary}</p>}
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      </div>

      {data.role === "COLLEGE_USER" && (
        <Card className="mt-6">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Record a new instrument</p>
              <p className="text-xs text-slate-500">Start a draft, upload the scan, then submit it for review.</p>
            </div>
            <Link to="/fdrs/new">
              <Button type="button">Start a submission</Button>
            </Link>
          </CardBody>
        </Card>
      )}

      <div className="mt-6">
        <DateConditionBadge condition="current" />
        <span className="ml-2 align-middle text-xs text-slate-400">
          Sample statuses - synthetic records only.
        </span>
      </div>
    </div>
  );
}
