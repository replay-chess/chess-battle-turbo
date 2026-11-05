// ApiError, the retry policy and the one global error reaction (plan §5.4, §5.6, §7.12; CDL §3.7, §4.4).
//
// No React, no UI imports: the reactions reach the router, the toast and the session flow through injected
// dependencies (`setApiErrorDeps`). NavigationBridge (lib/navigation/bridge.tsx) registers the App Router,
// SessionWatcher (1B·F8) registers its session guard, and tests register fakes. Until something registers,
// the defaults are safe: 401 does nothing, navigation falls back to `location.replace`, toasts and Sentry
// are loaded lazily on first use.
import { codeForStatus, isErrorCode, type ErrorCode } from "@repo/contracts/http/codes";
import type { QueryClient } from "@tanstack/react-query";
import { currentAppPath, paywallUrl, stripCheckoutParams } from "@/lib/billing/client";
import { qk } from "@/lib/api/keys";

/** Codes the client produces itself; never sent by a server. */
export const CLIENT_ERROR_CODES = ["network", "timeout", "offline", "aborted", "contract_mismatch"] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export type ApiErrorInit = {
  status: number;
  code: ApiErrorCode;
  message?: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  retryAfterSec?: number;
  requestId?: string;
  /** The request path without the query (for Sentry grouping); set by api(). */
  path?: string;
};

const DEFAULT_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  network: "Network request failed",
  timeout: "The request timed out",
  offline: "Needs a connection",
  aborted: "The request was cancelled",
  contract_mismatch: "The response did not match the expected shape",
  internal: "Something went wrong",
};

/** Every failed api() call throws this. `status` is 0 for client-only codes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSec?: number;
  readonly requestId?: string;
  readonly path?: string;

  constructor(init: ApiErrorInit) {
    super(init.message ?? DEFAULT_MESSAGES[init.code] ?? `Request failed (${init.code})`);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields;
    this.details = init.details;
    this.retryAfterSec = init.retryAfterSec;
    this.requestId = init.requestId;
    this.path = init.path;
  }

  /** `details.reason` when it is a string (402 reasons, 403/409 reasons). */
  get reason(): string | undefined {
    const r = this.details?.reason;
    return typeof r === "string" ? r : undefined;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

// ---------------------------------------------------------------------------------------------------------------
// Response → ApiError
// ---------------------------------------------------------------------------------------------------------------

type HeaderSource = { get(name: string): string | null } | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The code for a legacy or bodiless error, from the status alone. Overrides `codeForStatus` where its
 * first-in-ledger pick would trigger the wrong reaction: a bare 503 is an outage (`unavailable`), never the
 * `maintenance` notice; a bare 400 is a validation error; a 504 from a gateway is `unavailable`.
 */
export function codeForLegacyStatus(status: number): ErrorCode {
  if (status === 400) return "validation_failed";
  if (status === 503 || status === 504) return "unavailable";
  return codeForStatus(status);
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k] = val;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Builds the ApiError for a non-2xx response. Understands:
 * - the envelope `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }` (unknown code → internal);
 * - legacy `{ error: "text", code? }` and `{ success: false, error?, code? }` (code kept when it is a ledger code,
 *   otherwise mapped from the status);
 * - an empty or non-JSON body (an HTML 502 page): code from the status.
 */
export function toApiError(
  res: { status: number; headers?: HeaderSource },
  json: unknown,
  requestId: string | undefined = res.headers?.get("x-request-id") ?? undefined,
): ApiError {
  const status = res.status;
  const headerRetry = parseRetryAfter(res.headers?.get("retry-after"));

  if (isRecord(json) && isRecord(json.error)) {
    const e = json.error;
    const code: ErrorCode = isErrorCode(e.code) ? e.code : "internal";
    const retryAfterSec =
      typeof e.retryAfterSec === "number" && Number.isInteger(e.retryAfterSec) && e.retryAfterSec >= 0
        ? e.retryAfterSec
        : headerRetry;
    return new ApiError({
      status,
      code,
      message: typeof e.message === "string" ? e.message : undefined,
      fields: stringRecord(e.fields),
      details: isRecord(e.details) ? e.details : undefined,
      retryAfterSec,
      requestId: typeof e.requestId === "string" && e.requestId ? e.requestId : requestId,
    });
  }

  if (isRecord(json)) {
    const code = isErrorCode(json.code) ? json.code : codeForLegacyStatus(status);
    const message =
      typeof json.error === "string" ? json.error : typeof json.message === "string" ? json.message : undefined;
    const details: Record<string, unknown> = isRecord(json.details) ? { ...json.details } : {};
    if (typeof json.reason === "string" && details.reason === undefined) details.reason = json.reason;
    if (typeof json.upgradeUrl === "string" && details.upgradeUrl === undefined) details.upgradeUrl = json.upgradeUrl;
    return new ApiError({
      status,
      code,
      message,
      details: Object.keys(details).length ? details : undefined,
      retryAfterSec: typeof json.retryAfterSec === "number" ? json.retryAfterSec : headerRetry,
      requestId,
    });
  }

  return new ApiError({ status, code: codeForLegacyStatus(status), retryAfterSec: headerRetry, requestId });
}

/** For non-JSON success paths (SSE, downloads): turn a failed Response into an ApiError. */
export async function readApiError(res: Response): Promise<ApiError> {
  const json: unknown = await res.json().catch(() => null);
  return toApiError(res, json);
}

// ---------------------------------------------------------------------------------------------------------------
// Retry policy (plan §5.4)
// ---------------------------------------------------------------------------------------------------------------

const RETRY_TWICE: ReadonlySet<ApiErrorCode> = new Set(["network", "timeout", "internal", "unavailable"]);

/**
 * TanStack `retry` for queries: 2× on network, timeout, internal and unavailable; 1× on upstream_unavailable;
 * never on any 4xx or any other code. `failureCount` is 0 on the first failure.
 */
export function retryQuery(failureCount: number, err: unknown): boolean {
  if (!(err instanceof ApiError)) return failureCount < 2;
  if (err.status >= 400 && err.status < 500) return false;
  if (err.code === "upstream_unavailable") return failureCount < 1;
  return RETRY_TWICE.has(err.code) && failureCount < 2;
}

/** `Retry-After` when the server sent one, else min(1000 · 3^attempt, 8000) ms with ±25 % jitter. */
export function retryDelay(attempt: number, err: unknown, random: () => number = Math.random): number {
  if (err instanceof ApiError && err.retryAfterSec !== undefined && err.retryAfterSec > 0) return err.retryAfterSec * 1000;
  return Math.min(1000 * 3 ** attempt, 8000) * (0.75 + random() * 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// Global reactions (plan §5.6)
// ---------------------------------------------------------------------------------------------------------------

/** `meta` a query may carry. Registered with TanStack in query-client.ts. */
export type ApiQueryMeta = Record<string, unknown> & {
  /** The thing being loaded, lower case ("openings"); used by ErrorState and toasts. */
  object?: string;
  /** "inline": the host renders the paywall itself (coach, P7); no redirect on 402. */
  paywall?: "inline";
  /** "inline": the host shows the error (forms, checkout, lookups); no toast. */
  errorUi?: "inline";
};

/** `meta` a mutation may carry. */
export type ApiMutationMeta = ApiQueryMeta & {
  /** "save", "remove", … → "Failed to save {object}". */
  verb?: string;
  /** Full toast copy; wins over verb/object. One sentence, no trailing period. */
  errorCopy?: string;
  /** Adds a Retry action to the error toast. */
  retry?: () => void;
};

export type ReactionKind = "query" | "background" | "mutation" | "stream" | "outbox";

export type ReactionContext = {
  kind: ReactionKind;
  meta?: Record<string, unknown>;
  queryClient?: QueryClient;
};

export type SessionGuard = {
  /** Single-flight in the implementation (1B·F8): reload the Clerk session, retry, or open the modal. */
  onUnauthorized: (ctx: { source: "api_401"; queryClient?: QueryClient; error: ApiError }) => unknown;
};

export type ApiErrorNavigation = { replace: (href: string) => void };

export type ApiErrorNotify = {
  error: (text: string, opts?: { id?: string; action?: { label: string; onClick: () => void } }) => unknown;
  warning: (text: string, opts?: { id?: string }) => unknown;
};

export type ApiErrorCapture = {
  exception: (err: unknown, extra?: Record<string, unknown>) => void;
  message: (message: string, extra?: Record<string, unknown>) => void;
  breadcrumb: (message: string, data?: Record<string, unknown>) => void;
};

export type ApiErrorDeps = {
  sessionGuard: SessionGuard;
  navigation: ApiErrorNavigation;
  notify: ApiErrorNotify;
  capture: ApiErrorCapture;
  currentPath: () => string;
};

const lazyNotify: ApiErrorNotify = {
  error: (text, opts) => {
    void import("@/components/ui/toast").then((m) => m.notify.error(text, opts)).catch(() => {});
  },
  warning: (text, opts) => {
    void import("@/components/ui/toast").then((m) => m.notify.warning(text, opts)).catch(() => {});
  },
};

const lazyCapture: ApiErrorCapture = {
  exception: (err, extra) => {
    void import("@sentry/nextjs").then((S) => S.captureException(err, { extra })).catch(() => {});
  },
  message: (message, extra) => {
    void import("@sentry/nextjs").then((S) => S.captureMessage(message, { level: "error", extra })).catch(() => {});
  },
  breadcrumb: (message, data) => {
    void import("@sentry/nextjs").then((S) => S.addBreadcrumb({ category: "api", message, data })).catch(() => {});
  },
};

function defaultDeps(): ApiErrorDeps {
  return {
    sessionGuard: { onUnauthorized: () => undefined },
    navigation: {
      replace: (href) => {
        if (typeof window !== "undefined") window.location.replace(href);
      },
    },
    notify: lazyNotify,
    capture: lazyCapture,
    currentPath: currentAppPath,
  };
}

let deps: ApiErrorDeps = defaultDeps();

/** Registers real implementations (NavigationBridge, SessionWatcher) or test fakes. Returns an undo function. */
export function setApiErrorDeps(partial: Partial<ApiErrorDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...partial };
  return () => {
    // Undo only what this call set, so two registrations can unmount in any order.
    const restored = { ...deps };
    for (const key of Object.keys(partial) as (keyof ApiErrorDeps)[]) {
      if (deps[key] === partial[key]) (restored as Record<string, unknown>)[key] = previous[key];
    }
    deps = restored;
  };
}

export function resetApiErrorDeps(): void {
  deps = defaultDeps();
}

/** The current dependencies (read-only use: tests, F8's guard wiring). */
export function getApiErrorDeps(): Readonly<ApiErrorDeps> {
  return deps;
}

const ENDED_REASONS: ReadonlySet<string> = new Set(["trial_used", "expired", "payment_failed", "paused"]);

/**
 * Where a 402 `subscription_required` sends the viewer (B26): `trial_available` (or no reason) →
 * `/pricing?reason=required&redirect_url=…`; `trial_used`, `expired`, `payment_failed` (P10: `paused`) →
 * `reason=ended`. Checkout-return params never ride into `redirect_url`.
 */
export function paywallTarget(reason: string | undefined, appPath: string): string {
  const url = paywallUrl(stripCheckoutParams(appPath));
  return reason && ENDED_REASONS.has(reason) ? url.replace("reason=required", "reason=ended") : url;
}

/** "Failed to save openings" style copy, object first, no trailing period. */
export function mutationErrorCopy(meta: Record<string, unknown> | undefined): string {
  if (typeof meta?.errorCopy === "string" && meta.errorCopy) return meta.errorCopy;
  const verb = typeof meta?.verb === "string" && meta.verb ? meta.verb : "save";
  const object = typeof meta?.object === "string" && meta.object ? meta.object : "changes";
  return `Failed to ${verb} ${object}`;
}

/** The first 8 characters of the request id, as shown next to "Event". */
export function shortEventId(requestId: string | undefined): string | undefined {
  return requestId ? requestId.replace(/-/g, "").slice(0, 8) : undefined;
}

const TOASTED_CODES: ReadonlySet<ApiErrorCode> = new Set([
  "internal",
  "unavailable",
  "upstream_unavailable",
  "network",
  "timeout",
  "offline",
  "contract_mismatch",
]);

function isOnPricing(path: string): boolean {
  return path === "/pricing" || path.startsWith("/pricing?") || path.startsWith("/pricing/");
}

/**
 * The one global reaction to a failed query or mutation. Wired to `queryCache.onError` and
 * `mutationCache.onError` in query-client.ts; streams and the outbox call it directly (P5, P7).
 * Never throws.
 */
export function reactToApiError(err: unknown, ctx: ReactionContext): void {
  if (typeof window === "undefined") return; // server-side QueryClients (RSC prefetch) never react
  try {
    react(err, ctx);
  } catch (inner) {
    deps.capture.exception(inner, { where: "reactToApiError" });
  }
}

function react(err: unknown, ctx: ReactionContext): void {
  if (!(err instanceof ApiError)) {
    deps.capture.exception(err, { kind: ctx.kind });
    return;
  }
  const meta = ctx.meta;

  switch (err.code) {
    case "aborted":
      return;

    case "unauthorized":
      deps.sessionGuard.onUnauthorized({ source: "api_401", queryClient: ctx.queryClient, error: err });
      return;

    case "subscription_required": {
      void ctx.queryClient?.invalidateQueries({ queryKey: qk.me() });
      if (meta?.paywall === "inline") return;
      const path = deps.currentPath();
      if (isOnPricing(path)) return; // already on the paywall: never loop
      deps.navigation.replace(paywallTarget(err.reason, path));
      return;
    }

    case "payment_update_required":
      // The Phase 0 checkout UI already shows the portal link; P11 maps it to the RenewSheet.
      void ctx.queryClient?.invalidateQueries({ queryKey: qk.me() });
      return;

    case "rate_limited":
      return; // always inline (RetryCountdown on the host); never auto-retry a mutation

    case "maintenance":
      deps.capture.breadcrumb("maintenance", { path: err.path, requestId: err.requestId });
      deps.notify.warning("Down for maintenance, back soon", { id: "api:maintenance" });
      return;
  }

  if (!TOASTED_CODES.has(err.code)) return; // validation, conflict, forbidden, not_found, …: the host maps them
  if (ctx.kind !== "mutation" || meta?.errorUi === "inline") return; // queries: inline ErrorState or silent

  const event = shortEventId(err.requestId);
  const text = event ? `${mutationErrorCopy(meta)} · Event ${event}` : mutationErrorCopy(meta);
  const retry = typeof meta?.retry === "function" ? (meta.retry as () => void) : undefined;
  deps.notify.error(text, {
    id: `err:${typeof meta?.object === "string" ? meta.object : "action"}`,
    action: retry ? { label: "Retry", onClick: retry } : undefined,
  });
}
