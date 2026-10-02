import { cloneElement, useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ApiError } from "./api";
import type { Api } from "./api";
import type { Page } from "./types";
import { label } from "./types";
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{label(status)}</span>;
}
export function Field({
  title,
  children,
}: {
  title: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{title}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol" aria-hidden="true">
        ✓
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
export function useResource<T>(api: Api, path: string, refresh = 0) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>(
    { loading: true },
  );
  useEffect(() => {
    let active = true;
    set({ loading: true });
    api
      .request<T>(path)
      .then((data) => {
        if (active) set({ data, loading: false });
      })
      .catch((e) => {
        if (active && !(e instanceof ApiError && e.status === 499))
          set({ error: message(e), loading: false });
      });
    return () => {
      active = false;
    };
  }, [api, path, refresh]);
  return state;
}
export async function allPages<T>(api: Api, path: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page: Page<T> = await api.request<Page<T>>(
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    result.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor))
      throw new Error("Unable to load more results.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
