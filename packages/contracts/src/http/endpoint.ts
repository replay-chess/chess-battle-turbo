// Endpoint definitions (phase-01 plan §7.2–§7.3). Every route() call starts from one of these entries, so the method,
// path, auth mode, cache tier, rate limit, schemas and declared side effects live in one place that the route wrapper,
// the contract tests, the authz walker, the cache-tier lint and the OpenAPI generator all read.
// Server and test use only: client code imports types from the registry, never the registry objects.
import type { z } from "zod";
import { ERROR_STATUS, type ErrorCode } from "./codes";

export type AuthMode = "public" | "optional" | "user" | "member" | "owner" | "admin" | "internal" | "cron" | "webhook";
export const AUTH_MODES = ["public", "optional", "user", "member", "owner", "admin", "internal", "cron", "webhook"] as const satisfies readonly AuthMode[];

export type CacheTier = "public-immutable" | "public-static" | "public-short" | "private-etag" | "no-store" | "sse";
export const CACHE_TIERS = ["public-immutable", "public-static", "public-short", "private-etag", "no-store", "sse"] as const satisfies readonly CacheTier[];
/** Tiers a non-public endpoint may use (plan §7.2.1 invariants). */
export const PRIVATE_CACHE_TIERS = ["private-etag", "no-store", "sse"] as const satisfies readonly CacheTier[];

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** OPT §2.1 endpoint class; becomes the Sentry tag `class`. "S" (streaming) is used from P7. */
export type EndpointClass = "R1" | "R2" | "W1" | "W2" | "X" | "I" | "WH" | "P" | "S";

/** Burst windows (UNLOGGED table) longer than this are rejected; use store "durable" (plan §8.1). */
export const BURST_MAX_WINDOW_SEC = 300;

export type RateLimitSpec = {
  bucket: string;
  limit: number;
  windowSec: number;
  by: "user" | "ip" | "user+ip";
  /** Default "burst"; burst with windowSec > 300 throws at module load. */
  store?: "burst" | "durable";
};

/** The only writes a GET may make. Append-only (CA §5 GET purity). */
export type SideEffect = "provision_user" | "cron" | "kick_cas" | "daily_plan" | "legend_facts";
export const SIDE_EFFECTS = ["provision_user", "cron", "kick_cas", "daily_plan", "legend_facts"] as const satisfies readonly SideEffect[];

/** Success statuses (API §2.2). 204 has no body. */
export type SuccessStatus = 200 | 201 | 202 | 204;

/**
 * How the success body is shaped. "envelope" (default) is `{ data, meta? }` around `response`; "legacy" is a
 * pre-envelope body kept for one release (`response` describes the whole body); "text" is plain text.
 * A 204 has no body whatever this says.
 */
export type ResponseFormat = "envelope" | "legacy" | "text";

export type EndpointDef = {
  /** "me.get", "catalog.openings.index", "webhook.dodo". Used in logs, spans, metrics and OpenAPI operationId. */
  id: string;
  method: HttpMethod;
  /** "/api/me". Dynamic segments are written `{name}` (OpenAPI style); `fillPath()` substitutes them. */
  path: string;
  /** Required, no default. */
  auth: AuthMode;
  class?: EndpointClass;
  /** Default "no-store". */
  cache?: CacheTier;
  /** Required with "public-static". */
  publicStatic?: { sMaxAge: number; swr: number; tags: string[] };
  /** "public-short": CDN 15 s + swr 60 s. */
  publicShort?: { tags: string[] };
  /** Required with "public-immutable" (e.g. "v"). */
  versionParam?: string;
  rateLimit?: RateLimitSpec | RateLimitSpec[];
  /** The only writes a GET may make. */
  sideEffects?: SideEffect[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** The `data` payload for "envelope" responses; the whole body for "legacy"; the text for "text". */
  response?: z.ZodType;
  /** Default 200 (204 when there is no `response` and the format is not "text"). */
  status?: SuccessStatus;
  /** Default "envelope". */
  responseFormat?: ResponseFormat;
  /** Domain errors beyond the ones the auth mode, schemas and rate limit already imply (see expectedErrorCodes). */
  errors?: ErrorCode[];
  /** Body limit the wrapper enforces (default 16 384; webhooks 262 144). */
  maxBodyBytes?: number;
  /** One line for the OpenAPI summary. */
  summary?: string;
  /** Kept for compatibility and scheduled for removal (plan §7.4 KEEP/DEPRECATED rows). */
  deprecated?: boolean;
};

export type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;
export type InferInput<T> = T extends z.ZodType ? z.input<T> : undefined;
export type EndpointParams<E extends EndpointDef> = Infer<E["params"]>;
export type EndpointQuery<E extends EndpointDef> = Infer<E["query"]>;
export type EndpointBody<E extends EndpointDef> = Infer<E["body"]>;
/** What the client sends (before defaults and coercion). */
export type EndpointBodyInput<E extends EndpointDef> = InferInput<E["body"]>;
export type EndpointResponse<E extends EndpointDef> = Infer<E["response"]>;

const isPublicTier = (tier: CacheTier) => tier.startsWith("public-");

export function rateLimitsOf(def: EndpointDef): RateLimitSpec[] {
  if (!def.rateLimit) return [];
  return Array.isArray(def.rateLimit) ? def.rateLimit : [def.rateLimit];
}

export function cacheTierOf(def: EndpointDef): CacheTier {
  return def.cache ?? "no-store";
}

export function successStatusOf(def: EndpointDef): SuccessStatus {
  if (def.status) return def.status;
  return def.response || def.responseFormat === "text" ? 200 : 204;
}

/**
 * Invariant violations for one entry (empty when valid). The same rules the route wrapper asserts at module load
 * (plan §7.2 step 0), minus the ones that need the wrapper-only fields (owner callback).
 */
export function endpointProblems(def: EndpointDef): string[] {
  const problems: string[] = [];
  const tier = cacheTierOf(def);
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(def.id)) problems.push(`id "${def.id}" must be dot-separated segments`);
  if (!def.path.startsWith("/api/")) problems.push(`path "${def.path}" must start with /api/`);
  if (/\[|\]|:/.test(def.path)) problems.push(`path "${def.path}" must write dynamic segments as {name}`);
  if (isPublicTier(tier) && def.auth !== "public") problems.push(`cache "${tier}" requires auth "public" (got "${def.auth}")`);
  if (tier === "public-static" && !def.publicStatic) problems.push(`cache "public-static" requires publicStatic`);
  if (tier === "public-short" && !def.publicShort) problems.push(`cache "public-short" requires publicShort`);
  if (tier === "public-immutable" && !def.versionParam) problems.push(`cache "public-immutable" requires versionParam`);
  if (def.publicStatic && tier !== "public-static") problems.push(`publicStatic is set but cache is "${tier}"`);
  if (tier !== "no-store" && tier !== "sse" && def.method !== "GET") problems.push(`cache "${tier}" is only for GET`);
  for (const rl of rateLimitsOf(def)) {
    if ((rl.store ?? "burst") === "burst" && rl.windowSec > BURST_MAX_WINDOW_SEC) {
      problems.push(`rate limit "${rl.bucket}": burst window ${rl.windowSec}s > ${BURST_MAX_WINDOW_SEC}s (use store "durable")`);
    }
    if (!(rl.limit > 0) || !(rl.windowSec > 0)) problems.push(`rate limit "${rl.bucket}": limit and windowSec must be > 0`);
  }
  if (def.sideEffects?.length && def.method !== "GET") problems.push(`sideEffects are only for GET (got ${def.method})`);
  if (def.path.startsWith("/api/cron/") && def.method !== "GET") problems.push(`cron routes must be GET (Vercel cron sends GET)`);
  if (def.body && (def.method === "GET" || def.method === "DELETE")) problems.push(`${def.method} must not declare a body`);
  if (def.status === 204 && def.response) problems.push(`status 204 must not declare a response`);
  for (const name of pathParamNames(def.path)) {
    if (!def.params) problems.push(`path parameter {${name}} needs a params schema`);
  }
  return problems;
}

/**
 * Declares one endpoint. Throws on an invariant violation, so a bad registry entry fails `next build` and the unit
 * tests, never production. The const type parameter keeps literal ids and the exact schema types for route().
 */
export function defineEndpoint<const E extends EndpointDef>(def: E): E {
  const problems = endpointProblems(def);
  if (problems.length) throw new Error(`Endpoint ${def.id}: ${problems.join("; ")}`);
  return def;
}

/** `{name}` segments of a path, in order. */
export function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), (m) => m[1] as string);
}

/** Substitutes `{name}` segments (URI-encoded). Throws when one is missing. */
export function fillPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`fillPath: missing "${name}" for ${path}`);
    return encodeURIComponent(String(value));
  });
}

/**
 * Every error code an endpoint can answer with: the common set (internal), what its auth mode, schemas and rate limit
 * imply, and its declared domain errors. Contract tests and the OpenAPI generator read this.
 */
export function expectedErrorCodes(def: EndpointDef): ErrorCode[] {
  const codes = new Set<ErrorCode>(["internal"]);
  const hasBody = def.method === "POST" || def.method === "PATCH" || def.method === "PUT";
  if (def.params || def.query || def.body) codes.add("validation_failed");
  if (def.body) codes.add("invalid_json");
  if (hasBody) codes.add("payload_too_large");
  if (cacheTierOf(def) === "public-immutable") codes.add("validation_failed");
  switch (def.auth) {
    case "user":
    case "internal":
    case "cron":
    case "webhook":
      codes.add("unauthorized");
      break;
    case "member":
      codes.add("unauthorized").add("subscription_required");
      break;
    case "owner":
      codes.add("unauthorized").add("not_found");
      break;
    case "admin":
      codes.add("unauthorized").add("forbidden");
      break;
    case "public":
    case "optional":
      break;
  }
  if (def.params) codes.add("not_found");
  if (rateLimitsOf(def).length) codes.add("rate_limited");
  for (const code of def.errors ?? []) codes.add(code);
  return Array.from(codes).sort((a, b) => ERROR_STATUS[a] - ERROR_STATUS[b] || a.localeCompare(b));
}
