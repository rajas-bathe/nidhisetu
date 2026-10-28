/**
 * Complete typed client for the Stage 2 API surface. Every mutation goes
 * through apiFetch so the CSRF header stays attached (see services/api.ts).
 */
import type {
  ApprovalQueueResponse,
  AuditItem,
  AuditListResponse,
  CaseDetail,
  CaseSubmissionResult,
  ChangePasswordRequest,
  CheckRecordRequest,
  CorrectionCreateRequest,
  CorrectionListResponse,
  CorrectionRespondRequest,
  CurrentUser,
  DashboardResponse,
  DocumentListResponse,
  DocumentMeta,
  FdrDraftInput,
  FdrDraftUpdate,
  FdrListResponse,
  InstitutionDetail,
  InstitutionInput,
  InstitutionListResponse,
  JurisdictionRole,
  ListAuditQuery,
  LoginRequest,
  NotificationReadResult,
  NotificationsResponse,
  ProvisionAccountRequest,
  ProvisionAccountResponse,
  ReleaseActionRequest,
  ReleaseCompleteRequest,
  ReleaseCreateRequest,
  ReleaseListResponse,
  ReplacementDecisionRequest,
  ReplacementPendingItem,
  ReplacementRecommendRequest,
  ReportQuery,
  ReportResponse,
  ResetPasswordResponse,
  TaskListResponse,
  UserListResponse,
  WorkflowResult,
} from "@sih26265/contracts";
import { apiFetch } from "./api";

export interface ReplacementListResponse {
  items: ReplacementPendingItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CaseGuidance {
  origin: "sample_guidance";
  headline: string;
  bullets: string[];
  disclaimer: string;
}

export type {
  ReplacementPendingItem,
} from "@sih26265/contracts";

function toQuery(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(payload: LoginRequest): Promise<CurrentUser> {
  const body = await apiFetch<{ user: CurrentUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return body.user;
}

/** Returns null when the session is absent/expired (401 is an expected state here). */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const body = await apiFetch<{ user: CurrentUser }>("/api/auth/me");
    return body.user;
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) {
      return null;
    }
    throw error;
  }
}

export async function postLogout(): Promise<void> {
  await apiFetch<void>("/api/auth/logout", { method: "POST" });
}

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
  await apiFetch<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Dashboard + tasks
// ---------------------------------------------------------------------------

export function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/api/dashboard");
}

export function fetchTasks(args: { status?: string; onlyOverdue?: boolean; fdrId?: number; type?: string; q?: string; page?: number; pageSize?: number }): Promise<TaskListResponse> {
  return apiFetch<TaskListResponse>(`/api/tasks?${toQuery(args)}`);
}

// ---------------------------------------------------------------------------
// FDR register + case workspace
// ---------------------------------------------------------------------------

export interface FdrListArgs {
  q?: string;
  status?: string;
  institutionId?: number;
  dateCondition?: string;
  sort?: string;
  superseded?: string;
  replacement?: string;
  page?: number;
  pageSize?: number;
}

export function fetchFdrs(args: FdrListArgs): Promise<FdrListResponse> {
  return apiFetch<FdrListResponse>(`/api/fdrs?${toQuery(args as Record<string, unknown>)}`);
}

export function fetchCase(fdrId: number): Promise<CaseDetail> {
  return apiFetch<CaseDetail>(`/api/fdrs/${fdrId}`);
}

export function fetchCaseGuidance(fdrId: number): Promise<CaseGuidance> {
  return apiFetch<CaseGuidance>(`/api/cases/${fdrId}/guidance`);
}

export function createFdrDraft(input: FdrDraftInput, replacesFdrId?: number): Promise<{ id: number; publicCode: string }> {
  const query = replacesFdrId == null ? "" : `?replacesFdrId=${replacesFdrId}`;
  return apiFetch<{ id: number; publicCode: string }>(`/api/fdrs${query}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFdrDraft(fdrId: number, patch: FdrDraftUpdate): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/fdrs/${fdrId}/draft`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function submitFdr(fdrId: number): Promise<CaseSubmissionResult> {
  return apiFetch<CaseSubmissionResult>(`/api/fdrs/${fdrId}/submit`, { method: "POST" });
}

export function startReview(fdrId: number): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/fdrs/${fdrId}/review/start`, {
    method: "POST",
    body: JSON.stringify({ fdrId }),
  });
}

export function recordCheck(fdrId: number, body: CheckRecordRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/fdrs/${fdrId}/checks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyCase(fdrId: number, note: string): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/fdrs/${fdrId}/verify`, {
    method: "POST",
    body: JSON.stringify({ fdrId, note }),
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function fetchDocuments(fdrId: number): Promise<DocumentListResponse> {
  return apiFetch<DocumentListResponse>(`/api/fdrs/${fdrId}/documents`);
}

/** Multipart upload; never sets Content-Type manually (the browser adds the boundary). */
export function uploadDocument(fdrId: number, file: File): Promise<DocumentMeta> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentMeta>(`/api/fdrs/${fdrId}/documents`, {
    method: "POST",
    body: form,
  });
}

export interface DocumentContentResponse {
  meta: DocumentMeta;
  contentBase64: string;
}

export function fetchDocument(id: number): Promise<DocumentContentResponse> {
  return apiFetch<DocumentContentResponse>(`/api/documents/${id}`);
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export function fetchCorrections(args: { status?: string; fdrId?: number; institutionId?: number; page?: number; pageSize?: number }): Promise<CorrectionListResponse> {
  return apiFetch<CorrectionListResponse>(`/api/corrections?${toQuery(args as Record<string, unknown>)}`);
}

export function createCorrection(body: CorrectionCreateRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/corrections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function respondCorrection(body: CorrectionRespondRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/corrections/respond", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelCorrection(correctionId: number): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/corrections/${correctionId}/cancel`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Replacements
// ---------------------------------------------------------------------------

export function fetchReplacements(args: { page?: number; pageSize?: number }): Promise<ReplacementListResponse> {
  return apiFetch<ReplacementListResponse>(`/api/replacements?${toQuery(args)}`);
}

export function recommendReplacement(body: ReplacementRecommendRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/replacements/recommend", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acceptReplacement(body: ReplacementDecisionRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/replacements/accept", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rejectReplacement(body: ReplacementDecisionRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/replacements/reject", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export function fetchReleases(args: { stage?: string; fdrId?: number; institutionId?: number; page?: number; pageSize?: number }): Promise<ReleaseListResponse> {
  return apiFetch<ReleaseListResponse>(`/api/releases?${toQuery(args as Record<string, unknown>)}`);
}

export function createReleaseRequest(body: ReleaseCreateRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/releases", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function decideRelease(body: ReleaseActionRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/releases/action", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function completeRelease(body: ReleaseCompleteRequest): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>("/api/releases/complete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Approval queue (authority)
// ---------------------------------------------------------------------------

export function fetchApprovals(args: { kind?: string; includeDecided?: boolean; page?: number; pageSize?: number }): Promise<ApprovalQueueResponse> {
  return apiFetch<ApprovalQueueResponse>(`/api/approvals?${toQuery(args as Record<string, unknown>)}`);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function fetchNotifications(): Promise<NotificationsResponse> {
  return apiFetch<NotificationsResponse>("/api/notifications");
}

export function markNotificationRead(id: number): Promise<NotificationReadResult> {
  return apiFetch<NotificationReadResult>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<NotificationReadResult> {
  return apiFetch<NotificationReadResult>("/api/notifications/read-all", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function fetchReport(kind: string, args: ReportQuery): Promise<ReportResponse> {
  return apiFetch<ReportResponse>(`/api/reports/${kind}?${toQuery(args as Record<string, unknown>)}`);
}

/** CSV export downloads directly (same-origin + CSRF header, then a Blob). */
export async function downloadReportCsv(kind: string, args: ReportQuery): Promise<void> {
  const response = await fetch(`/api/reports/${kind}/export?${toQuery(args as Record<string, unknown>)}`, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) {
    throw new Error(`The export failed (HTTP ${response.status}).`);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] ?? `${kind}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export function fetchAudit(args: ListAuditQuery & { page?: number; pageSize?: number }): Promise<AuditListResponse> {
  return apiFetch<AuditListResponse>(`/api/audit?${toQuery(args as Record<string, unknown>)}`);
}

export type { AuditItem };

// ---------------------------------------------------------------------------
// Admin: institutions (colleges)
// ---------------------------------------------------------------------------

export function fetchInstitutions(args: { q?: string; status?: string; assignment?: string; role?: string; officerId?: number; sort?: string; page?: number; pageSize?: number }): Promise<InstitutionListResponse> {
  return apiFetch<InstitutionListResponse>(`/api/institutions?${toQuery(args as Record<string, unknown>)}`);
}

export function fetchInstitutionDetail(institutionId: number): Promise<InstitutionDetail> {
  return apiFetch<InstitutionDetail>(`/api/institutions/${institutionId}`);
}

export function fetchEligibleOfficers(role: JurisdictionRole): Promise<Array<{ id: number; fullName: string; email: string }>> {
  return apiFetch<Array<{ id: number; fullName: string; email: string }>>(`/api/institutions/officers?role=${role}`);
}

export function createInstitution(input: InstitutionInput): Promise<{ id: number }> {
  return apiFetch<{ id: number }>("/api/institutions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateInstitution(institutionId: number, input: InstitutionInput): Promise<{ id: number }> {
  return apiFetch<{ id: number }>(`/api/institutions/${institutionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function setInstitutionStatus(
  institutionId: number,
  body: { status: "ACTIVE" | "INACTIVE"; note?: string },
): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/institutions/${institutionId}/status`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAssignment(
  institutionId: number,
  body: { officerId: number; role: JurisdictionRole; action: "assign" | "unassign" },
): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/institutions/${institutionId}/assignments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Admin: user accounts
// ---------------------------------------------------------------------------

export function fetchUsers(args: { q?: string; role?: string; institutionId?: number; status?: string; sort?: string; page?: number; pageSize?: number }): Promise<UserListResponse> {
  return apiFetch<UserListResponse>(`/api/admin/users?${toQuery(args as Record<string, unknown>)}`);
}

export function provisionAccount(body: ProvisionAccountRequest): Promise<ProvisionAccountResponse> {
  return apiFetch<ProvisionAccountResponse>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resetUserPassword(userId: number): Promise<ResetPasswordResponse> {
  return apiFetch<ResetPasswordResponse>(`/api/admin/users/${userId}/password-reset`, { method: "POST" });
}

export function setUserStatus(userId: number, body: { isActive: boolean; note?: string }): Promise<WorkflowResult> {
  return apiFetch<WorkflowResult>(`/api/admin/users/${userId}/status`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeUserSessions(userId: number): Promise<{ revoked: number }> {
  return apiFetch<{ revoked: number }>(`/api/admin/users/${userId}/revoke-sessions`, { method: "POST" });
}
