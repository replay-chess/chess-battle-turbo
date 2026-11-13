// One error type for every provider call (phase-04 plan §7.8, §8.11). The kinds line up with `ImportErrorV1.code`
// (`DB/src/json/import-error.ts`) so the worker can store `error.kind` without a second mapping:
//
// | kind           | when                                                        | §8.11 handling                     |
// |----------------|-------------------------------------------------------------|------------------------------------|
// | `not_found`    | 404                                                         | `not_found` (no retry)             |
// | `closed`       | 410, or a Chess.com profile whose `status` starts `closed`  | `closed` (no retry)                |
// | `rate_limited` | 429 (`retryAfterSec` from `Retry-After`, else null)         | gate pause, job `runAt = pauseUntil` |
// | `timeout`      | the per-call timeout or the stream's idle / total limit     | job back-off                       |
// | `upstream`     | 5xx, 401/403 (anonymous calls never expect them), a network error | job back-off                 |
// | `bad_response` | a 2xx body that is not JSON or fails the provider schema    | job back-off (counted, Sentry)     |
//
// `aborted` is the caller's own AbortSignal (job cancelled, worker draining): never stored as an import error.

export type Provider = "chesscom" | "lichess";

export const PROVIDER_ERROR_KINDS = [
  "not_found",
  "closed",
  "rate_limited",
  "timeout",
  "upstream",
  "bad_response",
  "aborted",
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export class ProviderError extends Error {
  readonly provider: Provider;
  readonly kind: ProviderErrorKind;
  /** HTTP status when the provider answered; null for timeouts, network errors and aborts. */
  readonly status: number | null;
  /** Seconds from `Retry-After` on a 429 (or a 503 that sends it); null when absent or unparsable. */
  readonly retryAfterSec: number | null;

  constructor(
    provider: Provider,
    kind: ProviderErrorKind,
    message: string,
    opts: { status?: number | null; retryAfterSec?: number | null; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }

  /** True for the kinds a later attempt can fix (the job back-off retries them; §7.7.1). */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "upstream";
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Field paths and codes of the first schema issues, for error messages and the canary report. Never values. */
export function describeIssues(issues: readonly { path: readonly PropertyKey[]; code: string }[], max = 5): string {
  return issues
    .slice(0, max)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}:${i.code}`)
    .join(", ");
}

/** `ImportErrorV1.code` (`DB/src/json/import-error.ts`, `IMPORT_ERROR_CODES`) for a provider error. */
export type ImportErrorCode = "not_found" | "closed" | "upstream" | "timeout" | "rate_limited" | "internal";

export function importErrorCodeOf(e: ProviderError): ImportErrorCode {
  switch (e.kind) {
    case "not_found":
    case "closed":
    case "rate_limited":
    case "timeout":
    case "upstream":
      return e.kind;
    case "bad_response":
      return "upstream";
    case "aborted":
      return "internal";
  }
}
