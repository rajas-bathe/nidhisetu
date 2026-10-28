import type { DateCondition, ReleaseStatus, ReviewStatus, TaskStatus, TaskType, UserRole } from "@sih26265/contracts";
import { TASK_TYPE_LABELS } from "@sih26265/contracts";

/** Central status styling so every screen shows consistent badges. */
const badgeClasses: Record<string, string> = {
  // review status
  draft: "bg-slate-100 text-slate-700 ring-slate-300",
  submitted: "bg-sky-50 text-sky-700 ring-sky-300",
  under_review: "bg-indigo-50 text-indigo-700 ring-indigo-300",
  discrepancy: "bg-amber-50 text-amber-800 ring-amber-300",
  verified: "bg-teal-50 text-teal-700 ring-teal-300",
  // date condition
  current: "bg-slate-50 text-slate-600 ring-slate-300",
  approaching_maturity: "bg-orange-50 text-orange-700 ring-orange-300",
  matured: "bg-rose-50 text-rose-700 ring-rose-300",
  // release
  none: "bg-slate-100 text-slate-500 ring-slate-300",
  requested: "bg-sky-50 text-sky-700 ring-sky-300",
  recommended: "bg-indigo-50 text-indigo-700 ring-indigo-300",
  approved: "bg-teal-50 text-teal-700 ring-teal-300",
  rejected: "bg-rose-50 text-rose-700 ring-rose-300",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-300",
  // roles
  COLLEGE_USER: "bg-navy-100 text-navy-900 ring-navy-800/40",
  REVIEW_OFFICER: "bg-indigo-50 text-indigo-700 ring-indigo-300",
  APPROVING_AUTHORITY: "bg-violet-50 text-violet-700 ring-violet-300",
  SYSTEM_ADMIN: "bg-slate-200 text-slate-800 ring-slate-400",
  // corrections
  OPEN_REQUEST: "bg-sky-50 text-sky-700 ring-sky-300",
  RESPONDED: "bg-teal-50 text-teal-700 ring-teal-300",
  // tasks
  OPEN: "bg-sky-50 text-sky-700 ring-sky-300",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700 ring-indigo-300",
  DONE: "bg-teal-50 text-teal-700 ring-teal-300",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-300",
};

export function StatusBadge({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const classes = badgeClasses[value] ?? "bg-slate-100 text-slate-600 ring-slate-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      {label}
    </span>
  );
}

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  discrepancy: "Discrepancy",
  verified: "Verified",
};

const DATE_CONDITION_LABELS: Record<DateCondition, string> = {
  current: "Current",
  approaching_maturity: "Approaching maturity",
  matured: "Matured",
};

const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  none: "No release",
  requested: "Release requested",
  recommended: "Recommended",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

const ROLE_LABELS: Record<UserRole, string> = {
  COLLEGE_USER: "Institution user",
  REVIEW_OFFICER: "Reviewing officer",
  APPROVING_AUTHORITY: "Approving authority",
  SYSTEM_ADMIN: "System admin",
};

const CORRECTION_STATUS_LABELS: Record<"OPEN" | "RESPONDED" | "CANCELLED", string> = {
  OPEN: "Awaiting college",
  RESPONDED: "Answered",
  CANCELLED: "Cancelled",
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <StatusBadge value={status} label={REVIEW_STATUS_LABELS[status]} />;
}

export function DateConditionBadge({ condition }: { condition: DateCondition }) {
  return <StatusBadge value={condition} label={DATE_CONDITION_LABELS[condition]} />;
}

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  return <StatusBadge value={status} label={RELEASE_STATUS_LABELS[status]} />;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <StatusBadge value={status} label={TASK_STATUS_LABELS[status]} />;
}

export function TaskTypeBadge({ type }: { type: TaskType }) {
  return <StatusBadge value={type} label={TASK_TYPE_LABELS[type]} />;
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <StatusBadge value={role} label={ROLE_LABELS[role]} />;
}

export function CorrectionStatusBadge({ status }: { status: "OPEN" | "RESPONDED" | "CANCELLED" }) {
  return <StatusBadge value={status === "OPEN" ? "OPEN_REQUEST" : status} label={CORRECTION_STATUS_LABELS[status]} />;
}
