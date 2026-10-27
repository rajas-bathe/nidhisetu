import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";

export function Spinner({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-sm text-slate-500 ${className}`} role="status">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-center" role="alert">
      <div className="flex items-center justify-center gap-2 text-sm font-medium text-rose-800">
        <CircleAlert className="h-4 w-4" aria-hidden />
        {title}
      </div>
      {detail != null && <p className="mt-1 text-xs text-rose-700">{detail}</p>}
      {onRetry != null && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {detail != null && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800" role="status">
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description != null && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
