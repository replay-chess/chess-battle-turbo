// In-memory abuse limits (phase-02 plan 7.4.1 step 1, 7.4.4 "Limit", 7.4.8). Nothing here touches the network or
// the database; every check is O(1) amortised. Time comes from the caller (`now`), so tests need no fake timers.
import { COMMANDS, type CommandName } from "@repo/contracts/socket/commands";
import {
  COMMAND_BUCKET,
  FLOOD_DISCONNECT_MS,
  HANDSHAKES_PER_IP_PER_MIN,
  HANDSHAKES_PER_USER_PER_MIN,
  SOCKETS_PER_IP,
  SOCKETS_PER_USER,
} from "@repo/contracts/socket/limits";

export type LimitResult = { ok: true } | { ok: false; retryAfterMs: number };

/** Token bucket: `burst` tokens, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = burst;
    this.updatedAt = now;
  }

  take(now: number): LimitResult {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.perSecond) / 1000);
    this.updatedAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil(((1 - this.tokens) * 1000) / this.perSecond) };
  }
}

/** At most `limit` hits in any `windowMs` (sliding log; `limit` is small, so the log stays tiny). */
export class SlidingWindow {
  private hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private prune(now: number) {
    const from = now - this.windowMs;
    let i = 0;
    while (i < this.hits.length && this.hits[i]! <= from) i++;
    if (i > 0) this.hits = this.hits.slice(i);
  }

  /** Records a hit when allowed. */
  take(now: number): LimitResult {
    this.prune(now);
    if (this.hits.length >= this.limit) {
      return { ok: false, retryAfterMs: Math.max(1, this.hits[0]! + this.windowMs - now) };
    }
    this.hits.push(now);
    return { ok: true };
  }

  /** Number of hits in the window (no hit recorded). */
  size(now: number): number {
    this.prune(now);
    return this.hits.length;
  }
}

export type CommandCheck = { ok: true } | { ok: false; retryAfterMs: number; disconnect: boolean };

/**
 * Per-socket command limiter (plan 7.4.8): one shared bucket (burst 20, 10/s) for all commands together, plus each
 * command's own window from the contract table. Being refused continuously for FLOOD_DISCONNECT_MS (no gap of a
 * full second without a refusal) asks the caller to disconnect the socket.
 */
export class CommandLimiter {
  private readonly bucket: TokenBucket;
  private readonly windows = new Map<CommandName, SlidingWindow>();
  private floodSince: number | null = null;
  private lastRefusalAt = Number.NEGATIVE_INFINITY;

  constructor(now: number) {
    this.bucket = new TokenBucket(COMMAND_BUCKET.burst, COMMAND_BUCKET.perSecond, now);
  }

  check(name: CommandName, now: number): CommandCheck {
    const spec = COMMANDS[name].rate;
    let refusal: LimitResult = { ok: true };
    if (spec) {
      let window = this.windows.get(name);
      if (!window) {
        window = new SlidingWindow(spec.limit, spec.windowMs);
        this.windows.set(name, window);
      }
      refusal = window.take(now);
    }
    // The shared bucket is charged only for commands their own window let through.
    if (refusal.ok) refusal = this.bucket.take(now);
    if (refusal.ok) {
      if (now - this.lastRefusalAt >= 1_000) this.floodSince = null;
      return { ok: true };
    }
    if (this.floodSince === null || now - this.lastRefusalAt >= 1_000) this.floodSince = now;
    this.lastRefusalAt = now;
    return { ok: false, retryAfterMs: refusal.retryAfterMs, disconnect: now - this.floodSince >= FLOOD_DISCONNECT_MS };
  }
}

export interface HandshakeLimitOptions {
  socketsPerUser: number;
  handshakesPerUserPerMin: number;
  socketsPerIp: number;
  handshakesPerIpPerMin: number;
  /** The per-IP guard is off until `bootAt + ipGuardBootGraceMs` (the restore reconnect burst). */
  ipGuardBootGraceMs: number;
}

export const DEFAULT_HANDSHAKE_LIMITS: Omit<HandshakeLimitOptions, "ipGuardBootGraceMs"> = {
  socketsPerUser: SOCKETS_PER_USER,
  handshakesPerUserPerMin: HANDSHAKES_PER_USER_PER_MIN,
  socketsPerIp: SOCKETS_PER_IP,
  handshakesPerIpPerMin: HANDSHAKES_PER_IP_PER_MIN,
};

/**
 * Handshake limits (plan 7.4.1 step 1, api-perf AP-17): per user first (≤ 10 open sockets, ≤ 20 handshakes a
 * minute), per IP only as a flood guard (≤ 500 open, ≤ 300 a minute), the IP guard suspended for 120 s after boot.
 * Open-socket counts are kept by `opened`/`closed`; the caller pairs every `opened` with exactly one `closed`.
 */
export class HandshakeLimiter {
  private readonly userOpen = new Map<string, number>();
  private readonly ipOpen = new Map<string, number>();
  private readonly userRate = new Map<string, SlidingWindow>();
  private readonly ipRate = new Map<string, SlidingWindow>();

  constructor(
    private readonly options: HandshakeLimitOptions,
    private readonly bootAt: number,
  ) {}

  private ipGuardOn(now: number): boolean {
    return now - this.bootAt >= this.options.ipGuardBootGraceMs;
  }

  private window(map: Map<string, SlidingWindow>, key: string, limit: number): SlidingWindow {
    let w = map.get(key);
    if (!w) {
      w = new SlidingWindow(limit, 60_000);
      map.set(key, w);
    }
    return w;
  }

  /** The flood guard, before the token is read. */
  checkIp(ip: string, now: number): boolean {
    if (!this.ipGuardOn(now)) return true;
    if ((this.ipOpen.get(ip) ?? 0) >= this.options.socketsPerIp) return false;
    return this.window(this.ipRate, ip, this.options.handshakesPerIpPerMin).take(now).ok;
  }

  /** The per-user limits, after the token verified. */
  checkUser(userRef: string, now: number): boolean {
    if ((this.userOpen.get(userRef) ?? 0) >= this.options.socketsPerUser) return false;
    return this.window(this.userRate, userRef, this.options.handshakesPerUserPerMin).take(now).ok;
  }

  opened(userRef: string, ip: string): void {
    this.userOpen.set(userRef, (this.userOpen.get(userRef) ?? 0) + 1);
    this.ipOpen.set(ip, (this.ipOpen.get(ip) ?? 0) + 1);
  }

  closed(userRef: string, ip: string): void {
    const u = (this.userOpen.get(userRef) ?? 1) - 1;
    if (u > 0) this.userOpen.set(userRef, u);
    else this.userOpen.delete(userRef);
    const i = (this.ipOpen.get(ip) ?? 1) - 1;
    if (i > 0) this.ipOpen.set(ip, i);
    else this.ipOpen.delete(ip);
  }

  openFor(userRef: string): number {
    return this.userOpen.get(userRef) ?? 0;
  }

  /** Drops idle rate windows (called by the eviction sweep so the maps never grow without bound). */
  prune(now: number): void {
    for (const [key, w] of this.userRate) if (w.size(now) === 0) this.userRate.delete(key);
    for (const [key, w] of this.ipRate) if (w.size(now) === 0) this.ipRate.delete(key);
  }
}
