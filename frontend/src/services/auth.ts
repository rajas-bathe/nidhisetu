import { apiFetch } from "./api";
import type {
  CurrentUser,
  CurrentUserResponse,
  DashboardResponse,
  FdrListResponse,
  LoginRequest,
  TaskListResponse,
} from "@sih26265/contracts";

export async function postLogin(payload: LoginRequest): Promise<CurrentUser> {
  const body = await apiFetch<CurrentUserResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return body.user;
}

/** Returns null when the session is absent/expired (401 is an expected state here). */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const body = await apiFetch<CurrentUserResponse>("/api/auth/me");
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

export interface FdrListArgs {
  q?: string;
  status?: string;
  institutionId?: number;
  dateCondition?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/api/dashboard");
}

export function fetchFdrs(args: FdrListArgs): Promise<FdrListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return apiFetch<FdrListResponse>(`/api/fdrs?${params.toString()}`);
}

export interface TaskListArgs {
  status?: string;
  page?: number;
  pageSize?: number;
}

export function fetchTasks(args: TaskListArgs): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return apiFetch<TaskListResponse>(`/api/tasks?${params.toString()}`);
}
