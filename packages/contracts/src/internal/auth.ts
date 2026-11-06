// Internal request signing (phase-02 plan §7.5.1, api-design §2.11.6). Every `/internal/*` hop signs with
// signInternal() and every receiver checks with verifyInternal(); nobody writes the headers by hand, so a change of
// scheme touches only this file. Server-only: ESLint (`replay/no-internal-auth-in-client`) bans it from client code.
//
//   x-rc-kid: web
//   x-rc-ts:  1793563200                       (unix seconds; refused when |now − ts| > 60)
//   x-rc-sig: base64url(HMAC-SHA256(key[kid], ts + "\n" + METHOD + "\n" + path + "\n" + sha256hex(rawBody)))
//
// Keys: one env var, INTERNAL_API_SECRET = "kid:base64[,kid:base64]". A sender signs with the first entry; a receiver
// accepts every listed kid. A bare value without "kid:" is read as kid `web` (existing env files keep working during
// the rollout). The same key-ring format serves SOCKET_TOKEN_SECRET (../socket/token.ts).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const HEADER_KID = "x-rc-kid";
export const HEADER_TS = "x-rc-ts";
export const HEADER_SIG = "x-rc-sig";

/** |now − ts| above this is refused (seconds). */
export const INTERNAL_MAX_SKEW_SEC = 60;
/** Receivers remember seen signatures this long and refuse repeats. */
export const INTERNAL_REPLAY_WINDOW_MS = 120_000;
/** Minimum decoded key length of a `kid:base64` entry (256 bit). */
export const MIN_KEY_BYTES = 32;

const KID = /^[a-z0-9]{1,8}$/;
const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

// ── Key rings ───────────────────────────────────────────────────────────────────────────────────────────────────
export type KeyRing = {
  /** The kid a sender signs with (the first entry). Undefined for an empty ring. */
  readonly signingKid: string | undefined;
  readonly keys: ReadonlyMap<string, Buffer>;
};

export const EMPTY_KEY_RING: KeyRing = { signingKid: undefined, keys: new Map() };

/**
 * Parses "kid:base64[,kid:base64]". A value without ":" is a bare legacy secret: its UTF-8 bytes become the key of
 * `bareKid` (default `web`). Unset or blank → an empty ring (signing throws, verifying refuses everything).
 * A malformed value throws, so a typo in an env file fails the boot instead of silently refusing every call.
 */
export function parseKeyRing(raw: string | undefined | null, options: { bareKid?: string } = {}): KeyRing {
  const value = raw?.trim();
  if (!value) return EMPTY_KEY_RING;
  if (!value.includes(":")) {
    const kid = options.bareKid ?? "web";
    if (!KID.test(kid)) throw new Error("parseKeyRing: invalid bare kid");
    return { signingKid: kid, keys: new Map([[kid, Buffer.from(value, "utf8")]]) };
  }
  const keys = new Map<string, Buffer>();
  let signingKid: string | undefined;
  for (const [index, entry] of value.split(",").entries()) {
    const part = entry.trim();
    const colon = part.indexOf(":");
    const kid = part.slice(0, colon);
    const b64 = part.slice(colon + 1);
    // Never echo the entry: it holds key material.
    if (colon <= 0 || !KID.test(kid)) throw new Error(`parseKeyRing: entry ${index + 1} has an invalid kid`);
    if (!B64.test(b64)) throw new Error(`parseKeyRing: entry ${index + 1} (${kid}) is not base64`);
    const key = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length < MIN_KEY_BYTES) throw new Error(`parseKeyRing: key ${kid} is shorter than ${MIN_KEY_BYTES} bytes`);
    if (keys.has(kid)) throw new Error(`parseKeyRing: kid ${kid} is listed twice`);
    keys.set(kid, key);
    signingKid ??= kid;
  }
  return { signingKid, keys };
}

/** A ring that holds only the listed kids (a receiver that must not accept some kid of a shared env value). */
export function restrictKeyRing(ring: KeyRing, kids: readonly string[]): KeyRing {
  const keys = new Map([...ring.keys].filter(([kid]) => kids.includes(kid)));
  const signingKid = ring.signingKid && keys.has(ring.signingKid) ? ring.signingKid : keys.keys().next().value;
  return { signingKid, keys };
}

export function hmacBase64Url(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("base64url");
}

/** Timing-safe compare of two ASCII strings (false on a length mismatch, without an early exit on content). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Signing ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type RawBody = string | Uint8Array;

export function sha256Hex(body: RawBody): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The string that is signed. `path` is the request target as sent: pathname plus query string, if any. */
export function canonicalString(ts: number, method: string, path: string, body: RawBody): string {
  return `${ts}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`;
}

export type InternalHeaders = { [HEADER_KID]: string; [HEADER_TS]: string; [HEADER_SIG]: string };

export type SignInput = {
  keys: KeyRing;
  method: string;
  path: string;
  /** The exact bytes that will be sent ("" for no body). */
  body: RawBody;
  nowMs: number;
  /** Sign with this kid instead of the ring's first entry. */
  kid?: string;
};

/** The three headers for one request. Throws when the ring has no key to sign with. */
export function signInternal({ keys, method, path, body, nowMs, kid }: SignInput): InternalHeaders {
  const useKid = kid ?? keys.signingKid;
  const key = useKid ? keys.keys.get(useKid) : undefined;
  if (!useKid || !key) throw new Error("signInternal: no signing key (INTERNAL_API_SECRET)");
  const ts = Math.floor(nowMs / 1000);
  return {
    [HEADER_KID]: useKid,
    [HEADER_TS]: String(ts),
    [HEADER_SIG]: hmacBase64Url(key, canonicalString(ts, method, path, body)),
  };
}

// ── Verifying ───────────────────────────────────────────────────────────────────────────────────────────────────
export type AuthFailReason = "missing" | "malformed" | "unknown_kid" | "stale" | "bad_sig" | "replay";
export type VerifyResult = { ok: true; kid: string } | { ok: false; reason: AuthFailReason };

/** Header lookup for a Fetch `Headers`, a Node `IncomingHttpHeaders` or a plain object. */
export type HeaderSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function header(source: HeaderSource, name: string): string | undefined {
  if (typeof (source as { get?: unknown }).get === "function") {
    return (source as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Remembers signatures for INTERNAL_REPLAY_WINDOW_MS (in memory; one per receiving process). A signature can only
 * verify within ±60 s of its ts, so a 2-minute memory covers its whole valid life.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();
  constructor(private readonly windowMs = INTERNAL_REPLAY_WINDOW_MS) {}

  /** True the first time `sig` is seen inside the window; false for a repeat. */
  checkAndRemember(sig: string, nowMs: number): boolean {
    this.prune(nowMs);
    if (this.seen.has(sig)) return false;
    this.seen.set(sig, nowMs + this.windowMs);
    return true;
  }

  prune(nowMs: number): void {
    for (const [sig, expiresAt] of this.seen) {
      if (expiresAt > nowMs) break; // insertion order = expiry order
      this.seen.delete(sig);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

export type VerifyInput = {
  headers: HeaderSource;
  method: string;
  path: string;
  body: RawBody;
  keys: KeyRing;
  nowMs: number;
  /** Receivers pass one shared guard; omitted only in tests and one-shot tools. */
  replay?: ReplayGuard;
};

/**
 * Checks the three headers. Every failure answers 401 with no detail on the wire; `reason` is for the metric
 * `ws.internal.auth_fail{reason}` only. The replay check runs last, so a forged request never fills the guard.
 */
export function verifyInternal({ headers, method, path, body, keys, nowMs, replay }: VerifyInput): VerifyResult {
  const kid = header(headers, HEADER_KID);
  const tsRaw = header(headers, HEADER_TS);
  const sig = header(headers, HEADER_SIG);
  if (!kid || !tsRaw || !sig) return { ok: false, reason: "missing" };
  if (!KID.test(kid) || !/^\d{1,12}$/.test(tsRaw) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) {
    return { ok: false, reason: "malformed" };
  }
  const key = keys.keys.get(kid);
  if (!key) return { ok: false, reason: "unknown_kid" };
  const ts = Number(tsRaw);
  if (Math.abs(Math.floor(nowMs / 1000) - ts) > INTERNAL_MAX_SKEW_SEC) return { ok: false, reason: "stale" };
  if (!safeEqual(hmacBase64Url(key, canonicalString(ts, method, path, body)), sig)) return { ok: false, reason: "bad_sig" };
  if (replay && !replay.checkAndRemember(sig, nowMs)) return { ok: false, reason: "replay" };
  return { ok: true, kid };
}

// ── Per-caller allow-lists (§7.5.1) ─────────────────────────────────────────────────────────────────────────────
/** Kids: `web` (Vercel → socket), `ops` (CLI and deploy inside the container); P3 adds `wk`, P12 may add `ws`. */
export const INTERNAL_KIDS = ["web", "ops", "wk", "ws"] as const;
export type InternalKid = (typeof INTERNAL_KIDS)[number];

/** The socket server's internal paths. */
export const INTERNAL_PATHS = [
  "/internal/emit",
  "/internal/tournament-event",
  "/internal/broadcast",
  "/internal/drain",
  "/internal/metrics",
] as const;
export type InternalPath = (typeof INTERNAL_PATHS)[number];

/** An event name or a `domain:*` prefix pattern. */
export type EventPattern = `${string}:*` | `${string}:${string}`;

export type KidPolicy = {
  readonly paths: readonly InternalPath[];
  /** "all" = every event of the emit registry; otherwise exact names and `domain:*` patterns. */
  readonly events: "all" | readonly EventPattern[];
};

/**
 * The default policy the socket server enforces (WS/src/http/allow.ts reads it). `web` may emit every registered
 * event; `wk` (P3+) only its analysis-side domains; `ops` only reaches broadcast, drain and metrics. A forged
 * `entitlement:changed` therefore needs the web key.
 */
export const INTERNAL_POLICY: Readonly<Record<InternalKid, KidPolicy>> = {
  web: { paths: ["/internal/emit", "/internal/tournament-event", "/internal/metrics"], events: "all" },
  wk: {
    paths: ["/internal/emit"],
    events: ["analysis:*", "import:*", "weakness:*", "bank:*", "compare:*", "review:*", "games:changed", "export:ready"],
  },
  ops: { paths: ["/internal/broadcast", "/internal/drain", "/internal/metrics"], events: [] },
  ws: { paths: [], events: [] },
};

function isInternalKid(kid: string): kid is InternalKid {
  return (INTERNAL_KIDS as readonly string[]).includes(kid);
}

export function eventMatches(pattern: EventPattern, event: string): boolean {
  return pattern.endsWith(":*") ? event.startsWith(pattern.slice(0, -1)) : pattern === event;
}

/** May this kid call this path? Unknown kids may call nothing. */
export function kidMayCall(kid: string, path: string, policy = INTERNAL_POLICY): boolean {
  if (!isInternalKid(kid)) return false;
  return (policy[kid].paths as readonly string[]).includes(path);
}

/** May this kid emit this event through `/internal/emit`? (The event must also be in the emit registry.) */
export function kidMayEmit(kid: string, event: string, policy = INTERNAL_POLICY): boolean {
  if (!isInternalKid(kid) || !kidMayCall(kid, "/internal/emit", policy)) return false;
  const events = policy[kid].events;
  return events === "all" || events.some((p) => eventMatches(p, event));
}
