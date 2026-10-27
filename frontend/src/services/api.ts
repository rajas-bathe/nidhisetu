/**
 * Thin fetch wrapper for the same-origin /api interface.
 * - Always sends the CSRF custom header (see backend originGuard).
 * - Parses the shared ApiErrorBody shape into a typed ApiClientError.
 */
import {
  ApiClientError,
  ApiErrorBodySchema,
  type ApiErrorCode,
} from "@sih26265/contracts";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    throw await readError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<ApiClientError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) {
    return new ApiClientError(
      parsed.data.error.code as ApiErrorCode,
      parsed.data.error.message,
      response.status,
      parsed.data.error.fieldErrors as Record<string, string[]> | undefined,
    );
  }

  return new ApiClientError(
    response.status === 502 || response.status === 504 ? "INTERNAL_ERROR" : "INTERNAL_ERROR",
    defaultMessageForStatus(response.status),
    response.status,
  );
}

function defaultMessageForStatus(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have access to this resource.";
  if (status === 404) return "The requested item does not exist.";
  if (status === 429) return "Too many attempts. Please wait and try again.";
  if (status >= 500) return "The server could not process the request. Please try again.";
  return "The request could not be completed.";
}
