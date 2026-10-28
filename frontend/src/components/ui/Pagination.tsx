/** Shared pager control used by every paged list screen. */
import { Button } from "./Button";

export function Pagination({
  page,
  pageSize,
  total,
  onGoto,
}: {
  page: number;
  pageSize: number;
  total: number;
  onGoto: (page: number) => void;
}) {
  if (total === 0) {
    return (
      <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
        0 records
      </div>
    );
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {from}&ndash;{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 2 && (
          <Button variant="secondary" onClick={() => onGoto(1)}>
            First
          </Button>
        )}
        <Button variant="secondary" disabled={page <= 1} onClick={() => onGoto(page - 1)}>
          Previous
        </Button>
        <span className="px-1 text-xs text-slate-500">
          Page {page} of {lastPage}
        </span>
        <Button variant="secondary" disabled={page >= lastPage} onClick={() => onGoto(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
