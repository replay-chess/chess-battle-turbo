// Request ids (plan §7.2 step 1). Middleware may set x-request-id (and x-mw-start); otherwise the wrapper makes one.
// The id is echoed on every response, put in every error body, and tagged on the Sentry scope as request_id.

export const REQUEST_ID_HEADER = "x-request-id";
export const MW_START_HEADER = "x-mw-start";

/** What we accept from upstream: printable token characters only, bounded length (no header injection, no PII). */
const VALID_ID = /^[A-Za-z0-9._:-]{8,128}$/;

type HeaderBag = Pick<Headers, "get">;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** The incoming x-request-id when it is well-formed, else a fresh UUID. */
export function requestIdFrom(headers: HeaderBag): string {
  const incoming = headers.get(REQUEST_ID_HEADER)?.trim();
  return incoming && VALID_ID.test(incoming) ? incoming : newRequestId();
}

/**
 * Middleware lag (CA AP-35): wrapper start minus the epoch ms middleware stamped in x-mw-start.
 * Null when the header is absent or unusable; never negative.
 */
export function mwLagMs(headers: HeaderBag, startEpochMs: number): number | null {
  const raw = headers.get(MW_START_HEADER);
  if (!raw) return null;
  const stamped = Number(raw);
  if (!Number.isFinite(stamped) || stamped <= 0) return null;
  return Math.max(0, Math.round(startEpochMs - stamped));
}
