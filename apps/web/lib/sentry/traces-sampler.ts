// Server and edge `tracesSampler` (plan §10.2, AA F-13). Pure, so it is unit-tested and safe
// to import from `sentry.edge.config.ts`.
//
//   /api/health*                                           0
//   /api/webhook/*, /api/checkout, /api/subscription*,
//   /api/billing/*                                         1.0
//   /api/accounts/lichess/callback                         1.0 (auth: the OAuth link, P4 plan §10.2)
//   other /api/accounts/*                                  0.2 (P4 plan §10.2)
//   /api/import/status                                     0.1, and 0 for its 304 polls (dropped after the response,
//                                                          dropNotModifiedPoll: the status is known only then)
//   /api/me                                                0.1
//   /api/train/attempts                                    0.05 (volume: every outbox flush; phase-05 plan §10.2)
//   other /api/train/*                                     0.1 (phase-05 plan §10.2)
//   other /api/*                                           0.1
//   pages                                                  1.0 when NEXT_PUBLIC_APP_ENV=dev, else 0.1
//
// An incoming trace (the socket server forwards `sentry-trace`) keeps its parent's decision
// unless the path's rate is 0.

export const DEFAULT_TRACE_RATE = 0.1;
/** `/api/accounts/*` apart from the OAuth callback (phase-04 plan §10.2). */
export const ACCOUNTS_TRACE_RATE = 0.2;
/** `POST /api/train/attempts`, the outbox flush: the busiest P5 route (phase-05 plan §10.2 "train.attempts 0.05"). */
export const TRAIN_ATTEMPTS_TRACE_RATE = 0.05;
/** Polled routes whose 304 answers are never kept (phase-04 plan §10.2: "0 for import.status 304s"). */
const NOT_MODIFIED_DROPPED = ["/api/import/status"] as const;

export type SamplerContext = {
  name?: string;
  attributes?: Record<string, unknown>;
  normalizedRequest?: { url?: string };
  inheritOrSampleWith?: (fallbackSampleRate: number) => number;
};

const HTTP_METHOD_PREFIX = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+/i;

function toPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const raw = value.replace(HTTP_METHOD_PREFIX, "");
  if (raw.startsWith("/")) return raw.split(/[?#]/)[0] ?? raw;
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}

/** The request path of the span being sampled, from the richest source available. */
export function samplingPath(ctx: SamplerContext): string | null {
  const attrs = ctx.attributes ?? {};
  return (
    toPath(ctx.normalizedRequest?.url) ??
    toPath(attrs["url.path"]) ??
    toPath(attrs["http.target"]) ??
    toPath(attrs["http.route"]) ??
    toPath(attrs["next.route"]) ??
    toPath(ctx.name)
  );
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function sampleRateForPath(path: string | null, appEnv: string | undefined): number {
  if (path === null) return DEFAULT_TRACE_RATE;
  if (path.startsWith("/api/health")) return 0;
  if (
    under(path, "/api/webhook") ||
    under(path, "/api/checkout") ||
    path.startsWith("/api/subscription") ||
    under(path, "/api/billing")
  ) {
    return 1;
  }
  if (path === "/api/accounts/lichess/callback") return 1;
  if (under(path, "/api/accounts")) return ACCOUNTS_TRACE_RATE;
  if (under(path, "/api/me")) return DEFAULT_TRACE_RATE;
  if (path === "/api/train/attempts") return TRAIN_ATTEMPTS_TRACE_RATE;
  if (under(path, "/api")) return DEFAULT_TRACE_RATE;
  return appEnv === "dev" ? 1 : DEFAULT_TRACE_RATE;
}

export function tracesSampler(ctx: SamplerContext, appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): number {
  const rate = sampleRateForPath(samplingPath(ctx), appEnv);
  if (rate === 0) return 0;
  return ctx.inheritOrSampleWith ? ctx.inheritOrSampleWith(rate) : rate;
}

type TransactionLike = {
  type?: string;
  transaction?: string;
  request?: { url?: unknown };
  contexts?: { trace?: { data?: Record<string, unknown> }; response?: { status_code?: unknown } };
};

function responseStatus(event: TransactionLike): number | null {
  const fromTrace = event.contexts?.trace?.data?.["http.response.status_code"];
  const fromResponse = event.contexts?.response?.status_code;
  const status = typeof fromTrace === "number" ? fromTrace : typeof fromResponse === "number" ? fromResponse : Number(fromTrace ?? fromResponse);
  return Number.isFinite(status) ? status : null;
}

/**
 * True for a finished transaction the sampler would have given 0 had it known the status: a 304 answer of a polled
 * route (`GET /api/import/status`, phase-04 plan §10.2). `beforeSendTransaction` drops it (lib/sentry/scrub.ts).
 */
export function dropNotModifiedPoll(event: TransactionLike): boolean {
  if (responseStatus(event) !== 304) return false;
  const path = toPath(event.request?.url) ?? toPath(event.transaction);
  return path !== null && (NOT_MODIFIED_DROPPED as readonly string[]).includes(path);
}
