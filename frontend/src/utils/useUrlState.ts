/**
 * URL-carried list state. Filter/sort/page live in the address bar so refresh
 * and back/forward keep the exact view; changes replace history entries.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export interface UrlListState {
  values: Record<string, string>;
  /** Merge changes, delete empty values, reset "page" unless it is set here. */
  set: (next: Record<string, string | number | undefined>, opts?: { keepPage?: boolean }) => void;
  pageAsNumber: number;
}

export function useUrlListState(defaults: Record<string, string> = {}): UrlListState {
  const [searchParams, setSearchParams] = useSearchParams();

  const values: Record<string, string> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const provided = searchParams.get(key);
    if (provided != null) values[key] = provided;
  }

  const pageAsNumber = Math.max(1, Number(values.page ?? "1") || 1);

  const set = useCallback(
    (next: Record<string, string | number | undefined>, opts?: { keepPage?: boolean }) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(next)) {
        if (value == null || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      if (!opts?.keepPage) params.delete("page");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { values, set, pageAsNumber };
}
