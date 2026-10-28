/**
 * Minimal toast system: a provider mounted once near the app root plus a hook.
 * Toasts announce workflow outcomes so success never depends on scroll position.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleAlert, X } from "lucide-react";

interface ToastItem {
  id: number;
  kind: "success" | "error";
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = nextId++;
    setItems((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 6000);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
              item.kind === "success"
                ? "border-teal-200 bg-teal-50 text-teal-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
            role="status"
          >
            {item.kind === "success" ? (
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <p className="flex-1">{item.message}</p>
            <button
              type="button"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              className="mt-0.5 text-slate-400 hover:text-slate-600"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx == null) {
    throw new Error("useToasts must be used inside ToastProvider");
  }
  return ctx;
}

/** Converts an API/network error into a one-line user message. */
export function errorToMessage(error: unknown): string {
  if (error instanceof Error && "status" in error) {
    return error.message || "The request could not be completed.";
  }
  if (error instanceof Error) {
    return error.message || "The request could not be completed.";
  }
  return "The request could not be completed.";
}
