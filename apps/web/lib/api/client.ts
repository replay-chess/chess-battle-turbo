// api(): the one fetch wrapper for /api/* (plan §7.12, CDL §4.3).
//
//   const schema = process.env.NODE_ENV === "production" ? undefined : MeData;   // client code (lib/api/schema.ts)
//   const { data } = await api(endpoints.me, { schema, signal });
//
// - Throws ApiError for every failure: server codes from the envelope (or mapped from legacy bodies) and the
//   client-only codes network, timeout, offline, aborted, contract_mismatch.
// - 304s are handled by the browser HTTP cache (`private, no-cache` + ETag), so there is no ifNoneMatch option and
//   a query never receives `undefined` data.
// - The schema is parsed only when given, and it is only ever given in dev and test builds: the inline
//   NODE_ENV check in client code, devSchema() on dev-only pages (eslint.config.js enforces the two forms).
// - `fault` (dev/test only) asks the route wrapper to answer with a test status; production bundles drop it.
import type { OkMeta } from "@repo/contracts/http/envelope";
import { onlineManager } from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError, getApiErrorDeps, toApiError } from "./errors";
import { unwrapLegacy } from "./legacy";

export const DEFAULT_TIMEOUT_MS = 15_000;

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ApiQuery = Record<string, string | number | boolean | null | undefined>;
export type ApiFault = 401 | 402 | 429 | 500 | 503;

export type ApiInit<S extends z.ZodType = z.ZodType<unknown>> = {
  /** `process.env.NODE_ENV === "production" ? undefined : Schema` (or devSchema() on dev pages): dev/test only. */
  schema?: S;
  method?: ApiMethod;
  query?: ApiQuery;
  body?: unknown;
  signal?: AbortSignal;
  /** Default 15 s; covers the response body too. */
  timeoutMs?: number;
  /** Sent as the Idempotency-Key header (stored server-side from P2). */
  idempotencyKey?: string;
  keepalive?: boolean;
  /** Dev/test only: header x-rc-fault plus a cache-busting __rcfault=<random>. Ignored in production builds. */
  fault?: ApiFault;
};

export type ApiResult<T> = { data: T; meta?: OkMeta & Record<string, unknown> };

/** The build id the server's `upgrade_required` gate (P2) reads from x-rc-build. */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev";

function randomToken(): string {
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
}

/** Appends the query (skipping null/undefined) and, for faults, a fresh `__rcfault`. */
export function buildUrl(path: string, query: ApiQuery | undefined, faultToken?: string): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.append(k, String(v));
  }
  if (faultToken) params.set("__rcfault", faultToken);
  const search = params.toString();
  if (!search) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${search}`;
}

/** The path without its query, for error reports. */
const routeOf = (path: string) => path.split("?")[0] ?? path;

function reportContractMismatch(path: string, issues: unknown, requestId: string | undefined): void {
  getApiErrorDeps().capture.message("contract_mismatch", { route: routeOf(path), requestId, issues });
}

export async function api<S extends z.ZodType = z.ZodType<unknown>>(
  path: string,
  init: ApiInit<S> = {},
): Promise<ApiResult<z.infer<S>>> {
  const method = init.method ?? "GET";
  const route = routeOf(path);
  if (method !== "GET" && !onlineManager.isOnline()) throw new ApiError({ status: 0, code: "offline", path: route });

  const headers: Record<string, string> = { Accept: "application/json", "x-rc-build": BUILD_ID };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  let faultToken: string | undefined;
  if (process.env.NEXT_PUBLIC_APP_ENV !== "production" && init.fault) {
    headers["x-rc-fault"] = String(init.fault);
    faultToken = randomToken();
  }
  const url = buildUrl(path, init.query, faultToken);

  // One controller for the caller's signal and the timeout (AbortSignal.any is missing before Safari 17.4).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const abortedError = () =>
    new ApiError({ status: 0, code: init.signal?.aborted && !timedOut ? "aborted" : "timeout", path: route });

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        keepalive: init.keepalive,
        credentials: "same-origin",
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      if (controller.signal.aborted) throw abortedError();
      throw new ApiError({ status: 0, code: onlineManager.isOnline() ? "network" : "offline", path: route });
    }

    const requestId = res.headers.get("x-request-id") ?? undefined;
    if (res.status === 204 || res.status === 205) return { data: undefined as z.infer<S> };

    let json: unknown = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      if (controller.signal.aborted) throw abortedError();
      json = null; // non-JSON body (an HTML error page): the status decides
    }

    if (!res.ok) throw withPath(toApiError(res, json, requestId), route);

    const unwrapped = unwrapLegacy(json);
    if (!unwrapped.ok) throw withPath(toApiError({ status: 500, headers: res.headers }, unwrapped.body, requestId), route);

    if (init.schema) {
      const parsed = init.schema.safeParse(unwrapped.data);
      if (!parsed.success) {
        reportContractMismatch(path, parsed.error.issues, requestId);
        throw new ApiError({ status: res.status, code: "contract_mismatch", requestId, path: route });
      }
      return { data: parsed.data as z.infer<S>, meta: unwrapped.meta };
    }
    return { data: unwrapped.data as z.infer<S>, meta: unwrapped.meta };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function withPath(err: ApiError, path: string): ApiError {
  if (err.path) return err;
  return new ApiError({
    status: err.status,
    code: err.code,
    message: err.message,
    fields: err.fields,
    details: err.details,
    retryAfterSec: err.retryAfterSec,
    requestId: err.requestId,
    path,
  });
}
