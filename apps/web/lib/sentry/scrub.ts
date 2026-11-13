// Request scrubbing for server and edge Sentry events (plan §10.2, AA F-13: no IPs, cookies or request bodies).
//
// `sendDefaultPii: false` in @sentry/nextjs 10 removes only the IP. Its requestData integration still copies every
// request header and the parsed cookies into `event.request` (core `DEFAULT_INCLUDE = { cookies, data, headers }`,
// "TODO(v11)"). Those carry the Clerk `__session` JWT, `authorization: Bearer <CRON_SECRET>`, `x-internal-token`
// and, on dev, `x-e2e-token` / `x-perf-token`. This runs as `beforeSend` and `beforeSendTransaction`, so the
// guarantee lives in code and not in Sentry's server-side scrubbing settings.

import { PII_PARAM_NAMES } from "@repo/chess-import/redact";
import { redactShareDeep } from "@/lib/analytics/share-redaction";
import { dropNotModifiedPoll } from "./traces-sampler";

/** Headers kept on events: none of them identify a person or carry a credential. */
export const SENTRY_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
  "accept",
  "content-type",
  "content-length",
  "user-agent",
  "x-request-id",
  "x-vercel-id",
  "x-rc-build",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "next-router-prefetch",
  "rsc",
]);

/** Query parameter names whose values are dropped (tokens, tickets, keys, emails). */
const SECRET_PARAM = /token|secret|key|jwt|ticket|code|password|session|auth|email|__clerk|signature/i;
export const REDACTED = "[redacted]";

type Dict = Record<string, unknown>;
type ScrubbableRequest = {
  headers?: Dict;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
  url?: string;
  env?: unknown;
};
type ScrubbableEvent = { request?: ScrubbableRequest; user?: Dict | null };

/** A credential, or a personal value (a provider handle `u`, an email: plan §11.3, FIX-1). */
const dropParam = (name: string) => SECRET_PARAM.test(name) || PII_PARAM_NAMES.has(name.toLowerCase());

function scrubQuery(qs: string): string {
  const params = new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
  for (const name of [...params.keys()]) if (dropParam(name)) params.set(name, REDACTED);
  return params.toString();
}

function scrubUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  return `${url.slice(0, q)}?${scrubQuery(url.slice(q + 1))}`;
}

/**
 * Strips cookies, the body, non-allow-listed headers, secret query values and the IP, and rewrites share codes
 * (`/r/<code>` → `/r/:code`, lib/analytics/share-redaction.ts) anywhere in the event. Mutates and returns.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  redactShareDeep(event);
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.env;
    if (req.headers && typeof req.headers === "object") {
      const kept: Dict = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (SENTRY_HEADER_ALLOWLIST.has(name.toLowerCase())) kept[name] = value;
      }
      req.headers = kept;
    }
    if (typeof req.query_string === "string") req.query_string = scrubQuery(req.query_string);
    else if (req.query_string && typeof req.query_string === "object") {
      const q = req.query_string as Dict | [string, string][];
      req.query_string = Array.isArray(q)
        ? q.map(([k, v]) => [k, dropParam(k) ? REDACTED : v])
        : Object.fromEntries(Object.entries(q).map(([k, v]) => [k, dropParam(k) ? REDACTED : v]));
    }
    if (typeof req.url === "string") req.url = scrubUrl(req.url);
  }
  if (event.user && typeof event.user === "object") {
    delete event.user.ip_address;
    delete event.user.email;
  }
  return event;
}

/** Sentry.init options for server and edge: one place, both configs. A 304 poll of `/api/import/status` is dropped
 * (phase-04 plan §10.2 "0 for import.status 304s"; the sampler runs before the status is known). */
export const sentryScrubOptions = {
  beforeSend: <E extends ScrubbableEvent>(event: E): E => scrubEvent(event),
  beforeSendTransaction: <E extends ScrubbableEvent>(event: E): E | null =>
    dropNotModifiedPoll(event as Parameters<typeof dropNotModifiedPoll>[0]) ? null : scrubEvent(event),
};
