// Server and edge `tracesSampler` (plan §10.2, AA F-13). Pure, so it is unit-tested and safe
// to import from `sentry.edge.config.ts`.
//
//   /api/health*                                           0
//   /api/webhook/*, /api/checkout, /api/subscription*,
//   /api/billing/*                                         1.0
//   /api/me                                                0.1
//   other /api/*                                           0.1
//   pages                                                  1.0 when NEXT_PUBLIC_APP_ENV=dev, else 0.1
//
// An incoming trace (the socket server forwards `sentry-trace`) keeps its parent's decision
// unless the path's rate is 0.

export const DEFAULT_TRACE_RATE = 0.1;

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
  if (under(path, "/api/me")) return DEFAULT_TRACE_RATE;
  if (under(path, "/api")) return DEFAULT_TRACE_RATE;
  return appEnv === "dev" ? 1 : DEFAULT_TRACE_RATE;
}

export function tracesSampler(ctx: SamplerContext, appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): number {
  const rate = sampleRateForPath(samplingPath(ctx), appEnv);
  if (rate === 0) return 0;
  return ctx.inheritOrSampleWith ? ctx.inheritOrSampleWith(rate) : rate;
}
