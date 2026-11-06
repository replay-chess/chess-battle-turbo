// The route wrapper (plan §7.2, P1-05). Every new app/api route is
//
//   export const GET = route({ ...systemEndpoints.health, rateLimitWhen }, async (ctx) => data);
//
// The spec starts from the contracts registry entry (method, path, auth, cache tier, rate limit, schemas, side
// effects), so the wrapper, the contract tests, the authz walker, the cache-tier lint and OpenAPI read one source.
// Order of operations (each a tested branch in route.test.ts):
//   0 module-load assertions · 1 request id · 2 test hooks · 3 auth ∥ 4 rate limit · 5 body · 6 validation ·
//   7 handler (+ Prisma mapping, one GET retry) · 8 GET purity · 9 response + cache tier · 10 errors · 11 telemetry
import type { SubscriptionReason } from "@repo/contracts/http/codes";
import { SUBSCRIPTION_REASONS } from "@repo/contracts/http/codes";
import {
  type AuthMode,
  type EndpointDef,
  type Infer,
  cacheTierOf,
  endpointProblems,
  rateLimitsOf,
  successStatusOf,
} from "@repo/contracts/http/endpoint";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { bearerMatchesSecret, isPerfBypassRequest } from "@/lib/auth/secrets";
import { verifyInternalRequest } from "@/lib/auth/internal";
import { testHooksEnabled } from "@/lib/env-server";
import { assertRateLimitSpec } from "@/lib/rate-limit-db";
import { ApiError, isApiError } from "./api-error";
import { ETAG_TIERS, CacheHeaderError, isPublicTier, lifetimeViolation, tierHeaders } from "./cache";
import { getRouteDeps, type RouteDeps, type Viewer } from "./context";
import { ifNoneMatchHit, quoteEtag, strongEtag } from "./etag";
import { resolveNow } from "./now";
import { isPaged, pagedEnvelope, shouldCountTotal, type Paged } from "./paged";
import { mapPrismaError, withConnectionRetry } from "./prisma-errors";
import { REQUEST_ID_HEADER, mwLagMs, requestIdFrom } from "./request-id";
import { apiErrorResponse, errorResponse, isRouteResult, type RouteResult } from "./respond";
import { serialize, serializeModeFor } from "./serialize";
import { createRequestStore, exemptWrites, runWithRequestStore, serverTimingHeader } from "./timing";

export const DEFAULT_MAX_BODY_BYTES = 16_384;
export const WEBHOOK_MAX_BODY_BYTES = 262_144;

/** Fault statuses x-rc-fault may ask for (plan §7.2 step 2a, CDL §7.12). */
export const FAULT_STATUSES = ["401", "402", "429", "500", "503"] as const;
export const DEFAULT_FAULT_RETRY_SEC = 30;

const SESSION_MODES: ReadonlySet<AuthMode> = new Set(["optional", "user", "member", "owner", "admin"]);
const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

export type Ctx<P = unknown, Q = unknown, B = unknown> = {
  req: NextRequest;
  requestId: string;
  params: P;
  query: Q;
  body: B;
  /** Webhooks (`rawBody: true`) only. */
  rawBody?: string;
  /** Date.now(), or x-rc-now when test hooks are on and x-e2e-token matches (CT X5). */
  now: Date;
  /** Loaded for optional | user | member | owner | admin. */
  viewer: Viewer | null;
  /** From auth() (local JWT verify); always null for public. */
  clerkUserId: string | null;
  after: (task: () => unknown) => void;
  /** Server-Timing segments (non-production): mark("dto") records the time since the previous mark. */
  timing: { mark(name: string): void };
};

/** What rateLimitWhen sees: the request before validation (query is the raw search params). */
export type PreCtx = {
  req: NextRequest;
  requestId: string;
  now: Date;
  clerkUserId: string | null;
  rawQuery: Record<string, string>;
};

type CtxOf<E extends EndpointDef> = Ctx<Infer<E["params"]>, Infer<E["query"]>, Infer<E["body"]>>;

type DataOf<E extends EndpointDef> = E["response"] extends z.ZodType ? z.input<E["response"]> : unknown;

export type HandlerResult<E extends EndpointDef> =
  | DataOf<E>
  | RouteResult<DataOf<E>>
  | Paged<unknown>
  | Response
  | undefined;

export type RouteSpec<E extends EndpointDef> = E & {
  /** Default 16 384; webhooks 262 144. Overrides the registry's maxBodyBytes. */
  maxBodyBytes?: number;
  /** Webhooks: the handler gets ctx.rawBody, no JSON parse. */
  rawBody?: boolean;
  /** Required with auth "owner"; false → 404. */
  owner?: (ctx: CtxOf<E>) => Promise<boolean>;
  /** Rate-limit only when this returns true (health: deep=1 only). */
  rateLimitWhen?: (ctx: PreCtx) => boolean;
  /** Default for the ETag tiers: fnv1a64 of the serialised body. */
  etag?: (data: DataOf<E>) => string;
};

export type RouteHandler = ((req: NextRequest, rc: { params: Promise<unknown> }) => Promise<Response>) & {
  /** The endpoint spec, for contract tests and the authz walker. */
  readonly spec: EndpointDef & { maxBodyBytes?: number; rawBody?: boolean };
};

/** A GET wrote to the database without declaring the side effect (plan §7.2 step 8). */
export class GetWroteError extends Error {
  constructor(routeId: string, ops: string[]) {
    super(`get_wrote: GET ${routeId} ran ${ops.join(", ") || "a write"} without declaring sideEffects`);
    this.name = "GetWroteError";
  }
}

/** Step 0: the spec problems that make importing a route file throw. */
export function routeSpecProblems(spec: EndpointDef & { owner?: unknown; rawBody?: boolean }): string[] {
  const problems = endpointProblems(spec);
  if (spec.auth === "owner" && typeof spec.owner !== "function") problems.push(`auth "owner" requires an owner() callback`);
  if (spec.rawBody && spec.auth !== "webhook") problems.push(`rawBody is only for auth "webhook"`);
  for (const rl of rateLimitsOf(spec)) {
    try {
      assertRateLimitSpec(rl);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Helpers

function rawQueryOf(req: NextRequest): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams) {
    if (key.startsWith("__rc")) continue; // the client's cache-busting fault token (plan §7.12)
    if (!(key in query)) query[key] = value;
  }
  return query;
}

/** Reads at most maxBytes + 1 bytes; null when the body is larger (never buffers an unbounded body, CA AP-40). */
export async function readBodyBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type Issue = { path: (string | number)[]; code: string; message: string };

function issuesOf(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number"),
    code: i.code,
    message: i.message,
  }));
}

function validationError(issues: Issue[]): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return new ApiError("validation_failed", { fields, details: { issues } });
}

function upgradeUrlFor(reason: SubscriptionReason): string {
  return reason === "trial_available" ? "/pricing?reason=required" : "/pricing?reason=ended";
}

/** The 402 `subscription_required` error route() answers for `auth: "member"`; handlers with their own rule reuse it. */
export function memberDenied(reason: SubscriptionReason): ApiError {
  const upgradeUrl = upgradeUrlFor(reason);
  return new ApiError("subscription_required", { details: { reason, upgradeUrl } });
}

/** The x-rc-fault answer, or null (hooks off or no/unknown fault). */
function faultError(req: NextRequest, env: RouteDeps["env"]): ApiError | null {
  if (!testHooksEnabled(env)) return null;
  const fault = req.headers.get("x-rc-fault")?.trim();
  if (!fault || !(FAULT_STATUSES as readonly string[]).includes(fault)) return null;
  const retryRaw = Number(req.headers.get("x-rc-fault-retry"));
  const retryAfterSec = Number.isInteger(retryRaw) && retryRaw > 0 && retryRaw <= 3600 ? retryRaw : DEFAULT_FAULT_RETRY_SEC;
  switch (fault) {
    case "401":
      return new ApiError("unauthorized", { details: { injected: true } });
    case "402": {
      const asked = req.headers.get("x-rc-fault-reason")?.trim();
      const reason = (SUBSCRIPTION_REASONS as readonly string[]).includes(asked ?? "")
        ? (asked as SubscriptionReason)
        : "trial_used";
      return new ApiError("subscription_required", { details: { reason, upgradeUrl: upgradeUrlFor(reason), injected: true } });
    }
    case "429":
      return new ApiError("rate_limited", { retryAfterSec, details: { bucket: "injected", injected: true } });
    case "503":
      return new ApiError("maintenance", {
        retryAfterSec,
        details: { retryAt: new Date(Date.now() + retryAfterSec * 1000).toISOString(), injected: true },
      });
    default:
      return new ApiError("internal", { details: { injected: true } });
  }
}

const roundMs = (ms: number) => Math.round(ms * 10) / 10;

// ---------------------------------------------------------------------------
// route()

export function route<const E extends EndpointDef>(
  spec: RouteSpec<E>,
  handler: (ctx: CtxOf<E>) => Promise<HandlerResult<E>>,
): RouteHandler {
  // Step 0 (module load): a bad spec fails the import, so `next build` and the unit tests fail, never production.
  const problems = routeSpecProblems(spec);
  if (problems.length) throw new Error(`route(${spec.id}): ${problems.join("; ")}`);

  const tier = cacheTierOf(spec);
  const limits = rateLimitsOf(spec);
  const maxBodyBytes = spec.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const format = spec.responseFormat ?? "envelope";
  const endpointClass = spec.class ?? "";

  const wrapped = async (req: NextRequest, rc: { params: Promise<unknown> }): Promise<Response> => {
    const deps = getRouteDeps();
    const env = deps.env;
    const startEpoch = deps.clock();
    const t0 = deps.perf();
    const requestId = requestIdFrom(req.headers);
    const lag = mwLagMs(req.headers, startEpoch);
    const store = createRequestStore();
    const strict = serializeModeFor(env) === "strict";
    const segments: { name: string; dur: number }[] = [];
    let viewerRole: string | null = null;

    const finish = (response: Response, code: string | undefined): Response => {
      const total = deps.perf() - t0;
      // A public-* success is stored by the CDN and replayed to every later client, so it must not carry this
      // request's id or timings: a support lookup by a HIT's x-request-id would find someone else's request.
      // Errors stay `private, no-store` and keep both; the api log line below keeps the id either way.
      const sharedCacheable = isPublicTier(tier) && (response.ok || response.status === 304);
      if (sharedCacheable) response.headers.delete(REQUEST_ID_HEADER);
      if (env.NEXT_PUBLIC_APP_ENV !== "production" && !sharedCacheable) {
        const timing = [...segments, { name: "db", dur: store.dbMs }, { name: "total", dur: total }];
        response.headers.set("Server-Timing", serverTimingHeader(timing));
      }
      const logContext = {
        route: spec.id,
        method: spec.method,
        status: response.status,
        code: code ?? null,
        durationMs: roundMs(total),
        dbMs: roundMs(store.dbMs),
        dbStatements: store.dbStatements,
        mwLagMs: lag,
        requestId,
        auth: spec.auth,
        cache: tier,
        env: env.NEXT_PUBLIC_APP_ENV ?? "local",
      };
      deps.log(response.status >= 500 ? "error" : "info", "api", logContext);
      deps.telemetry.distribution("api.duration_ms", total, { route: spec.id, class: endpointClass });
      deps.telemetry.count("api.status", { route: spec.id, code: code ?? String(response.status) });
      if (lag !== null) deps.telemetry.distribution("api.mw_lag_ms", lag, { route: spec.id });
      return response;
    };

    const fail = (err: unknown): Response => {
      const mapped = isApiError(err) ? err : mapPrismaError(err);
      if (mapped) {
        if (mapped.status >= 500) {
          deps.telemetry.captureMessage(`api_${mapped.code}`, {
            level: "warning",
            tags: { route: spec.id, code: mapped.code },
            extra: { requestId },
          });
        } else if (mapped.status === 402 && spec.auth === "internal") {
          deps.telemetry.captureMessage("api_402_on_internal_route", { level: "warning", tags: { route: spec.id }, extra: { requestId } });
        } else {
          deps.telemetry.breadcrumb({ category: "api", message: `${spec.id} ${mapped.status} ${mapped.code}`, level: "info" });
        }
        const topLevel =
          mapped.code === "subscription_required" && env.LEGACY_402_MIRROR?.toLowerCase() !== "off"
            ? { code: "subscription_required", upgradeUrl: mapped.details?.upgradeUrl }
            : undefined;
        return finish(apiErrorResponse(mapped, requestId, { topLevel }), mapped.code);
      }
      deps.telemetry.captureException(err, { tags: { route: spec.id }, extra: { requestId } });
      return finish(errorResponse({ code: "internal", requestId }), "internal");
    };

    const run = async (): Promise<Response> => {
      deps.telemetry.setTag("request_id", requestId);

      // Step 2: test hooks. With hooks off the headers are ignored entirely.
      const fault = faultError(req, env);
      if (fault) {
        const topLevel =
          fault.code === "subscription_required" && env.LEGACY_402_MIRROR?.toLowerCase() !== "off"
            ? { code: "subscription_required", upgradeUrl: fault.details?.upgradeUrl }
            : undefined;
        return finish(apiErrorResponse(fault, requestId, { topLevel }), fault.code);
      }
      const now = resolveNow(req.headers, env, deps.clock);
      const rawQuery = rawQueryOf(req);

      // Step 3: auth (the session part; viewer read runs in parallel with the limiter below).
      const tAuth = deps.perf();
      let clerkUserId: string | null = null;
      if (SESSION_MODES.has(spec.auth)) {
        clerkUserId = (await deps.getAuth()).userId;
        if (!clerkUserId && spec.auth !== "optional") throw new ApiError("unauthorized");
      } else if (spec.auth === "internal") {
        if (!verifyInternalRequest(req, spec.id, env)) throw new ApiError("unauthorized");
      } else if (spec.auth === "cron") {
        if (!bearerMatchesSecret(req.headers.get("authorization"), env.CRON_SECRET)) throw new ApiError("unauthorized");
      }

      const preCtx: PreCtx = { req, requestId, now, clerkUserId, rawQuery };
      const limited = limits.length > 0 && (!spec.rateLimitWhen || spec.rateLimitWhen(preCtx));

      const viewerPromise: Promise<Viewer | null> =
        SESSION_MODES.has(spec.auth) && clerkUserId
          ? deps.getViewer().finally(() => segments.push({ name: "auth", dur: deps.perf() - tAuth }))
          : Promise.resolve(null);
      const tRl = deps.perf();
      // Step 4: rate limit, in parallel with the viewer read (keys need only the JWT user id or the IP).
      const limitPromise = limited
        ? exemptWrites(() => deps.checkRateLimit(limits, { clerkUserId, ip: deps.clientIp(req.headers) })).finally(() =>
            segments.push({ name: "rl", dur: deps.perf() - tRl }),
          )
        : Promise.resolve(null);
      const [viewer, decision] = await Promise.all([viewerPromise, limitPromise]);
      viewerRole = viewer?.role ?? null;

      if (spec.auth !== "public" && spec.auth !== "optional" && SESSION_MODES.has(spec.auth) && !viewer) {
        throw new ApiError("unauthorized");
      }
      if (spec.auth === "member" && viewer && !viewer.entitlement.member && !isPerfBypassRequest(req, env)) {
        throw memberDenied(deps.memberDenialReason(viewer));
      }
      if (spec.auth === "admin" && viewerRole !== "admin") throw new ApiError("forbidden");
      if (decision && !decision.allowed) {
        throw new ApiError("rate_limited", {
          retryAfterSec: Math.max(1, decision.retryAfterSec),
          details: { bucket: decision.bucket ?? limits[0]?.bucket },
        });
      }

      // Step 5: body.
      let rawBody: string | undefined;
      let body: unknown;
      if (BODY_METHODS.has(spec.method) || spec.rawBody) {
        const declared = req.headers.get("content-length");
        if (declared && Number(declared) > maxBodyBytes) {
          throw new ApiError("payload_too_large", { details: { limitBytes: maxBodyBytes } });
        }
        if (spec.body || spec.rawBody) {
          const text = await readBodyBounded(req, maxBodyBytes);
          if (text === null) throw new ApiError("payload_too_large", { details: { limitBytes: maxBodyBytes } });
          if (spec.rawBody) {
            rawBody = text;
          } else if (text.trim() !== "") {
            try {
              body = JSON.parse(text);
            } catch {
              throw new ApiError("invalid_json");
            }
          }
        }
      }

      // Step 6: validation.
      const issues: Issue[] = [];
      let params: unknown = (await rc?.params) ?? {};
      let query: unknown = undefined;
      if (spec.params) {
        const parsed = spec.params.safeParse(params);
        if (parsed.success) params = parsed.data;
        else issues.push(...issuesOf(parsed.error));
      }
      if (tier === "public-immutable" && spec.versionParam && !rawQuery[spec.versionParam]) {
        issues.push({ path: [spec.versionParam], code: "invalid_type", message: "Required" });
      }
      if (spec.query) {
        const parsed = spec.query.safeParse(rawQuery);
        if (parsed.success) query = parsed.data;
        else issues.push(...issuesOf(parsed.error));
      }
      if (spec.body) {
        const parsed = spec.body.safeParse(body);
        if (parsed.success) body = parsed.data;
        else issues.push(...issuesOf(parsed.error));
      }
      if (issues.length) throw validationError(issues);

      let lastMark = deps.perf();
      const ctx = {
        req,
        requestId,
        params,
        query,
        body,
        rawBody,
        now,
        viewer,
        clerkUserId,
        after: deps.after,
        timing: {
          mark(name: string) {
            const at = deps.perf();
            segments.push({ name, dur: at - lastMark });
            lastMark = at;
          },
        },
      } as CtxOf<E>;

      if (spec.auth === "owner" && !(await spec.owner!(ctx))) throw new ApiError("not_found");

      // Step 7: handler (Prisma P1001/P1017: one retry for GETs).
      const tApp = deps.perf();
      lastMark = tApp;
      const result = await withConnectionRetry(spec.method, () => handler(ctx), deps.sleep);
      segments.push({ name: "app", dur: deps.perf() - tApp });

      // Step 8: GET purity.
      if (spec.method === "GET" && store.writes > 0 && !spec.sideEffects?.length) {
        const err = new GetWroteError(spec.id, store.writeOps);
        if (strict) throw err;
        deps.log("warn", "get_wrote", { route: spec.id, writes: store.writes, requestId });
      }

      // Step 9: response.
      return finish(buildResponse(result), undefined);
    };

    const buildResponse = (result: unknown): Response => {
      if (result instanceof Response) {
        const headers = result.headers;
        headers.set(REQUEST_ID_HEADER, requestId);
        if (tier === "sse") {
          // A stream's headers are fixed by the tier (the Response constructor defaults a string body to text/plain).
          for (const [name, value] of Object.entries(tierHeaders(spec))) headers.set(name, value);
        } else if (!headers.has("cache-control")) {
          for (const [name, value] of Object.entries(tierHeaders(spec))) if (!headers.has(name)) headers.set(name, value);
        }
        const violation = lifetimeViolation(tier, headers);
        if (violation) {
          if (strict) throw new CacheHeaderError(`route(${spec.id}): ${violation}`);
          deps.log("warn", "cache_header_violation", { route: spec.id, requestId });
          headers.set("Cache-Control", "private, no-store");
          headers.delete("cdn-cache-control");
          headers.delete("vercel-cdn-cache-control");
        }
        return result;
      }

      const options = isRouteResult(result) ? result.options : {};
      let data: unknown = isRouteResult(result) ? result.data : result;
      let meta: Record<string, unknown> | undefined;
      if (isPaged(data)) {
        const page = data;
        const envelope = pagedEnvelope(page);
        const query = rawQueryOf(req);
        const limit = query.limit === undefined ? null : Number(query.limit);
        if (envelope.meta.total !== undefined && !shouldCountTotal({ cursor: query.cursor ?? null, limit })) {
          delete envelope.meta.total;
        }
        data = envelope.data;
        meta = envelope.meta;
      }

      const headers = new Headers(tierHeaders(spec));
      headers.set(REQUEST_ID_HEADER, requestId);
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (/^(cache-control|cdn-cache-control|vercel-cdn-cache-control)$/i.test(name)) {
          throw new CacheHeaderError(`route(${spec.id}): handlers never set ${name}; the cache tier owns it`);
        }
        headers.set(name, value);
      }
      if (isPublicTier(tier) && headers.has("set-cookie")) {
        if (strict) throw new CacheHeaderError(`route(${spec.id}): Set-Cookie on a "${tier}" response`);
        headers.delete("set-cookie");
      }

      // The registry's status (successStatusOf: 204 when there is no response schema), except that an entry without a
      // schema whose handler did return data answers 200 rather than dropping it.
      const declared = successStatusOf(spec);
      const status = options.status ?? (declared === 204 && !spec.status && data !== undefined ? 200 : declared);
      if (options.location) headers.set("Location", options.location);
      if (status === 204) return new Response(null, { status: 204, headers });

      if (strict && env.ROUTE_VALIDATE_RESPONSES === "1" && spec.response && format === "envelope") {
        const parsed = spec.response.safeParse(data);
        if (!parsed.success) {
          throw new Error(`route(${spec.id}): response does not match the contract: ${parsed.error.message}`);
        }
      }

      const onCoerce = (kind: string, path: string) =>
        deps.telemetry.captureMessage("serialize_coerced", {
          level: "warning",
          tags: { route: spec.id, kind },
          extra: { path, requestId },
        });
      let text: string;
      if (format === "text") {
        text = String(data ?? "");
        headers.set("Content-Type", "text/plain; charset=utf-8");
      } else {
        const payload =
          format === "legacy" ? data : { ...options.legacyMirror, data, ...(meta ? { meta } : {}) };
        text = serialize(payload, { mode: strict ? "strict" : "lenient", onCoerce });
        if (tier !== "sse") headers.set("Content-Type", "application/json; charset=utf-8");
      }

      if (ETAG_TIERS.has(tier)) {
        const etag = options.etag
          ? quoteEtag(options.etag)
          : spec.etag
            ? quoteEtag(spec.etag(data as DataOf<E>))
            : strongEtag(text);
        headers.set("ETag", etag);
        if (ifNoneMatchHit(req.headers.get("if-none-match"), etag)) {
          headers.delete("Content-Type");
          return new Response(null, { status: 304, headers });
        }
      }
      return new Response(text, { status, headers });
    };

    return runWithRequestStore(store, () =>
      deps.telemetry.startSpan(
        `api ${spec.id}`,
        { route: spec.id, auth: spec.auth, class: endpointClass, cache: tier, request_id: requestId },
        async () => {
          try {
            return await run();
          } catch (err) {
            return fail(err);
          }
        },
      ),
    );
  };

  return Object.assign(wrapped, { spec: spec as RouteHandler["spec"] });
}
