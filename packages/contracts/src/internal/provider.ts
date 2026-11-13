// The analysis worker's provider endpoints (phase-04 plan §7.1, §7.7.3, §7.7.4; D4-23, testing X12). The web signs
// both with kid `webwk` (./auth.ts WORKER_POLICY); the worker verifies with verifyInternal() before it parses a body.
//
//   POST /internal/provider/chesscom/lookup  the web's fallback when its own Chess.com call got 429/403 (Vercel's
//                                            shared egress IPs): served through the worker's Chess.com gate (one
//                                            request at a time, one IP, one User-Agent) and its 600 s LRU.
//   POST /internal/dev/fault                 the provider fault table behind `/dev/import` (dev and test only; the
//                                            worker refuses to boot with IMPORT_FAULTS_ALLOWED=1 in production).
import { z } from "zod";
import { ChessComUsername } from "../http/accounts";

export { WORKER_DEV_FAULT_PATH, WORKER_PROVIDER_LOOKUP_PATH } from "./auth";

/** The web's whole budget for a fallback lookup (sign, send, worker gate wait, upstream call). */
export const PROVIDER_LOOKUP_TIMEOUT_MS = 6_000;
/** The worker answers `rate_limited` rather than queue a lookup behind an import for longer than this. */
export const PROVIDER_LOOKUP_GATE_WAIT_MS = 5_000;
/** Lookup bodies are tiny; the worker refuses larger ones (413). */
export const PROVIDER_BODY_MAX_BYTES = 1_024;

/** `profile+stats` = the ACC-2 lookup; `archives+month` = the confirm step's recent games (`month` = "YYYY/MM"). */
export const InternalLookupBody = z.strictObject({
  v: z.literal(1),
  username: ChessComUsername,
  what: z.enum(["profile+stats", "archives+month"]),
  month: z
    .string()
    .regex(/^\d{4}\/(0[1-9]|1[0-2])$/)
    .optional(),
});
export type InternalLookupBody = z.infer<typeof InternalLookupBody>;
export type InternalLookupBodyInput = z.input<typeof InternalLookupBody>;

/**
 * 200 for every outcome the web can act on. The raw Chess.com bodies are passed through as `unknown` and re-validated
 * by `@repo/chess-import`'s strict schemas on the web side (one parser, the worker never reshapes them). A worker
 * timeout or 5xx is the web's 502 `upstream_unavailable`; `rate_limited` is the web's 429 with `source: chesscom`.
 */
export const InternalLookupData = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    profile: z.unknown(),
    stats: z.unknown().optional(),
    archives: z.array(z.string().max(120)).max(400).optional(),
    month: z.unknown().optional(),
  }),
  z.object({ kind: z.literal("private") }),
  z.object({ kind: z.literal("not_found") }),
  z.object({ kind: z.literal("rate_limited"), retryAfterSec: z.int().min(1).max(3_600) }),
]);
export type InternalLookupData = z.infer<typeof InternalLookupData>;

// ── Dev fault injection (§7.7.4) ────────────────────────────────────────────────────────────────────────────────
export const FAULT_PROVIDERS = ["chesscom", "lichess"] as const;
/** `5xx` → synthetic 503; `timeout` → the call hangs until its own timeout; `429` → `Retry-After: 30`; `off` clears. */
export const FAULT_MODES = ["5xx", "timeout", "429", "off"] as const;
export type FaultMode = (typeof FAULT_MODES)[number];
/** A fault never outlives this (seconds). */
export const FAULT_TTL_MAX_SEC = 600;

export const DevFaultBody = z.strictObject({
  v: z.literal(1),
  provider: z.enum(FAULT_PROVIDERS),
  mode: z.enum(FAULT_MODES),
  ttlSec: z.int().min(1).max(FAULT_TTL_MAX_SEC),
});
export type DevFaultBody = z.infer<typeof DevFaultBody>;

/** The fault table after the change (what `/dev/import` renders). */
export const DevFaultData = z.object({
  faults: z.array(
    z.object({ provider: z.enum(FAULT_PROVIDERS), mode: z.enum(FAULT_MODES).exclude(["off"]), until: z.iso.datetime() }),
  ).max(FAULT_PROVIDERS.length),
});
export type DevFaultData = z.infer<typeof DevFaultData>;
