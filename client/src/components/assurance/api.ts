import { useCallback, useEffect, useRef, useState } from "react";
import { COOKIE_NAME } from "@shared/const";

export type Row = Record<string, any>;
export type Principal = {
  id: string | number;
  actor: string;
  roleIds: string[];
  isAdmin: boolean;
  qualified: boolean;
  personId?: string;
  auditIds?: string[];
  auditWriteIds?: string[];
  qualifiedAuditIds?: string[];
  access?: "look_only" | "make_changes";
  qualificationEvidenceId?: string;
  permissions?: string[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}
export function authHeaders(): Record<string, string> {
  try {
    const prefix = `${COOKIE_NAME}=`;
    const token = sessionStorage
      .getItem("manus-cookie")
      ?.split(";")
      .find(s => s.trim().startsWith(prefix))
      ?.trim()
      .slice(prefix.length);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
export function scoped(
  path: string,
  auditId: string,
  params: Record<string, unknown> = {}
) {
  const query = new URLSearchParams({ auditId });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  });
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}
export async function request<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const timeout = AbortSignal.timeout(90000);
  const response = await fetch(path, {
    credentials: "include",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result: any;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    const looksHtml = /^\s*<(!doctype|html)/i.test(text.slice(0, 200));
    if (response.status === 401 || response.status === 403 || looksHtml) {
      window.dispatchEvent(new Event("assurance-session-expired"));
      throw new ApiError(
        looksHtml
          ? `${path} answered with an HTML page instead of JSON. That means the request did not reach the API — usually a stale session or the wrong host. Reload and sign in again.`
          : `${path} was refused (${response.status}). Sign in again to continue.`,
        response.status
      );
    }
    throw new ApiError(
      `Expected JSON from ${path}; the server returned ${response.status} ${response.headers.get("content-type") ?? "without a content type"}.`,
      response.status
    );
  }
  if (!response.ok || result?.ok === false) {
    if (response.status === 401)
      window.dispatchEvent(new Event("assurance-session-expired"));
    const raw = String(
      result?.error?.message ??
        result?.error ??
        result?.message ??
        `Request failed (${response.status})`
    );
    // Permission refusals are part of the product experience. State the limit plainly and
    // tell the person what to do next instead of exposing an authorization stack message.
    const message = response.status === 403 && !/^you do not have permission/i.test(raw)
      ? `You do not have permission to do that at this time. ${raw}`
      : raw;
    throw new ApiError(message, response.status, result);
  }
  return result as T;
}
export async function download(path: string, filename: string) {
  const response = await fetch(path, {
    credentials: "include",
    headers: authHeaders(),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("assurance-session-expired"));
    const detail = await response.text();
    throw new ApiError(
      `Download failed (${response.status}): ${detail.slice(0, 400)}`,
      response.status
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function saveJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function rows(value: any, ...keys: string[]): Row[] {
  if (Array.isArray(value))
    return value.filter(v => v && typeof v === "object");
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return rows(value[key]);
  }
  if (value?.data && value.data !== value) return rows(value.data, ...keys);
  return [];
}
export function record(value: any): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
export function payload(value: any): Row {
  return record(value?.payload ?? value);
}
export function label(value: any, fallback = "Unlabelled record"): string {
  const row = payload(value);
  return String(
    row.title ?? row.name ?? row.label ?? row.id ?? row.configId ?? fallback
  );
}
export function id(value: any): string {
  return String(
    value?.id ?? value?.recordId ?? value?.configId ?? value?.payload?.id ?? ""
  );
}
export function text(value: unknown, fallback = "Unknown"): string {
  return value === undefined || value === null || value === ""
    ? fallback
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function storageGet(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function storageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}

export function useResource<T = any>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: Error | null;
    loading: boolean;
  }>({ path, data: null, error: null, loading: Boolean(path) });
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    setState(previous =>
      previous.path === path
        ? { ...previous, error: null, loading: Boolean(path) }
        : { path, data: null, error: null, loading: Boolean(path) }
    );
    if (path)
      request<T>(path, undefined, abort.signal)
        .then(data => {
          if (!abort.signal.aborted)
            setState({ path, data, error: null, loading: false });
        })
        .catch(error => {
          if (!abort.signal.aborted)
            setState({
              path,
              data: null,
              error: error instanceof Error ? error : new Error(String(error)),
              loading: false,
            });
        });
    return () => abort.abort();
  }, [path, version]);
  return {
    ...(state.path === path
      ? state
      : { data: null, error: null, loading: Boolean(path) }),
    refresh,
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await action();
      if (mounted.current) setResult(value);
      return value;
    } catch (e) {
      if (mounted.current) setError(errorText(e));
      return undefined;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, result, run };
}
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Unable to read original file bytes."));
    reader.onabort = () => reject(new Error("File reading cancelled."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}
export async function activeConfigurations(
  kind: string,
  signal?: AbortSignal
): Promise<Row[]> {
  const catalog = await request(
    `/api/configuration/catalog?kind=${encodeURIComponent(kind)}`,
    undefined,
    signal
  );
  const headers = rows(catalog, "configurations", "entries", "items").filter(
    r => (r.kind ?? kind) === kind && r.status === "active"
  );
  const byId = new Map<string, Row>();
  for (const entry of headers) {
    const key = String(entry.configId ?? entry.id ?? "");
    if (!key)
      throw new Error(`An active ${kind} header has no configuration ID.`);
    if (byId.has(key) && byId.get(key)?.version !== entry.version)
      throw new Error(
        `Competing active ${kind} revisions: ${key}. Qualified configuration review required.`
      );
    byId.set(key, entry);
  }
  return Promise.all(
    [...byId.values()].map(entry =>
      request(
        `/api/configuration/${encodeURIComponent(kind)}/${encodeURIComponent(String(entry.configId ?? entry.id))}?version=${encodeURIComponent(entry.version)}`,
        undefined,
        signal
      )
    )
  );
}
export function useConfigurations(kind: string) {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Row[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    activeConfigurations(kind, abort.signal)
      .then(value => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [kind, version]);
  return { data, error, loading, refresh: () => setVersion(v => v + 1) };
}
