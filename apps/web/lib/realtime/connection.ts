// One socket per tab (P2 plan 5.2.1, client-data-layer 5.1). Lazy and ref-counted: `acquire(hold)` connects,
// the last release lets it idle; `room(key, join, leave)` re-runs `join` after every (re)connect (the snapshot
// resync of plan 5.2.2); commands always use acks with a timeout. The token is seeded by RealtimeBoot from the
// server render (no HTTP round trip) and refreshed 2 minutes before it expires, on `io server disconnect` and on
// `connect_error "unauthorized"` (every 3 s for up to 2 minutes: the in-game `in_game_refresh` chip).
//
// Protocol v2 only: the handshake carries `{ token, proto: 2, build }`. The legacy screen (flag off) keeps its own
// v1 socket inside features/game/legacy.

import { io, type Socket } from "socket.io-client";
import type { SocketTokenData } from "@repo/contracts/http/socket-token";
import type { CommandAck, CommandName, CommandPayload } from "@repo/contracts/socket/commands";
import { shouldResync, type HelloState } from "./resync";

export type ConnState = "idle" | "connecting" | "live" | "reconnecting" | "offline" | "unauthorized" | "upgrade_required";
export type Hold = "user" | "game" | "queue" | "lobby" | "activation" | "review";

/** Holds that keep the socket up while the tab is hidden (a live game must not drop for a hidden tab). */
const CRITICAL: ReadonlySet<Hold> = new Set<Hold>(["game", "queue", "activation"]);
export const HIDDEN_DISCONNECT_MS = 5 * 60_000;
export const TOKEN_REFRESH_BEFORE_S = 120;
export const AUTH_RETRY_EVERY_MS = 3_000;
export const AUTH_RETRY_FOR_MS = 120_000;
export const AUTH_RECOVERED_SHOW_MS = 3_000;
export const COMMAND_TIMEOUT_MS = 5_000;

/** `{ token, expiresAt }` with expiresAt in unix seconds (the contracts type of GET /api/socket-token). */
export type SocketToken = SocketTokenData;

/** The in-game auth chip (V3SessionExpired `in_game_refresh` / `in_game_ok`). */
export type AuthStatus =
  | { kind: "ok" }
  | { kind: "refreshing"; retryAt: number; since: number }
  | { kind: "recovered"; until: number }
  | { kind: "failed" };

export interface RealtimeConfig {
  url: string;
  buildId: string;
  fetchToken(): Promise<SocketToken | null>;
}

export class RealtimeError extends Error {
  constructor(public readonly code: "not_connected" | "timeout") {
    super(code);
    this.name = "RealtimeError";
  }
}

// socket.io listeners are `(...args: any[]) => void`; ours take one typed payload.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => void;
type LooseSocket = Socket;

export class RealtimeConnection {
  private socket: LooseSocket | null = null;
  private state: ConnState = "idle";
  private auth: AuthStatus = { kind: "ok" };
  private lastLiveAt = 0;
  private readonly listeners = new Set<() => void>();
  private readonly holds = new Map<Hold, number>();
  private readonly rejoin = new Map<string, () => Promise<void>>();
  private readonly helloListeners = new Set<(hello: HelloState, resync: boolean) => void>();
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private token: SocketToken | null = null;
  private hello: HelloState | null = null;
  private lastUseq = 0;
  private destroyed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly cfg: RealtimeConfig) {}

  /** From the server render (RealtimeBoot), so the first connect needs no GET /api/socket-token. */
  seedToken(t: SocketToken | null): void {
    if (t && (!this.token || t.expiresAt > this.token.expiresAt)) this.token = t;
  }

  /** Ref-counted; the first hold connects, the last release disconnects. */
  acquire(reason: Hold): () => void {
    this.holds.set(reason, (this.holds.get(reason) ?? 0) + 1);
    this.ensure();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.holds.get(reason) ?? 1) - 1;
      if (n <= 0) this.holds.delete(reason);
      else this.holds.set(reason, n);
      if (this.holds.size === 0) this.idle();
    };
  }

  /** Persistent room membership: `join` runs now (if live) and after every reconnect; returns the leave function. */
  room(key: string, join: () => Promise<void>, leave: () => void): () => void {
    this.rejoin.set(key, join);
    if (this.state === "live") void join();
    return () => {
      if (this.rejoin.get(key) === join) this.rejoin.delete(key);
      if (this.state === "live") leave();
    };
  }

  /** Registers an event handler without connecting; holds decide when the socket is up. */
  on<P>(event: string, fn: (payload: P) => void): () => void {
    const s = this.build();
    s.on(event, fn as AnyHandler);
    return () => {
      s.off(event, fn as AnyHandler);
    };
  }

  /** Acked command with a timeout. Rejects with RealtimeError("not_connected" | "timeout"). */
  async command<N extends CommandName>(
    name: N,
    payload: CommandPayload<N>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<CommandAck<N>> {
    const s = this.socket;
    if (!s || this.state !== "live") throw new RealtimeError("not_connected");
    try {
      return (await s.timeout(timeoutMs).emitWithAck(name, payload)) as CommandAck<N>;
    } catch {
      throw new RealtimeError("timeout");
    }
  }

  /** Fire-and-forget emit (game:leave). */
  emit(name: CommandName, payload: unknown): void {
    if (this.socket && this.state === "live") this.socket.emit(name, payload, () => {});
  }

  /** Notes a user-room event's `useq` (plan 7.4.1 step 6) for the reconnect resync decision. */
  noteUseq(useq: number): void {
    if (useq > this.lastUseq) this.lastUseq = useq;
  }

  /** `session:hello` listeners: the boolean says whether user-level caches must be refetched. */
  onHello(fn: (hello: HelloState, resync: boolean) => void): () => void {
    this.helloListeners.add(fn);
    return () => {
      this.helloListeners.delete(fn);
    };
  }

  getState = (): ConnState => this.state;
  getAuth = (): AuthStatus => this.auth;
  getHello = (): HelloState | null => this.hello;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  isLive = (): boolean => this.state === "live";
  /** ms since the socket was last live (Infinity when it never was). */
  liveGapMs = (): number => (this.lastLiveAt ? Date.now() - this.lastLiveAt : Infinity);

  /** Sign-out: drops the socket and the token. */
  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    for (const c of this.cleanups.splice(0)) c();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.token = null;
    this.holds.clear();
    this.rejoin.clear();
    this.setState("idle");
  }

  // ── internals ──

  private ensure(): void {
    if (this.destroyed) return;
    const s = this.build();
    if (!s.connected && !s.active) {
      this.setState("connecting");
      s.connect();
    }
  }

  private idle(): void {
    this.clearTimers();
    this.socket?.disconnect();
    this.setState("idle");
  }

  private build(): LooseSocket {
    if (this.socket) return this.socket;
    const s: LooseSocket = io(this.cfg.url, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      upgrade: false,
      tryAllTransports: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      auth: (cb) => {
        void this.freshToken().then((t) => cb({ token: t?.token, proto: 2, build: this.cfg.buildId }));
      },
    });
    s.on("connect", () => {
      this.lastLiveAt = Date.now();
      if (this.auth.kind === "refreshing") this.setAuth({ kind: "recovered", until: Date.now() + AUTH_RECOVERED_SHOW_MS });
      this.setState("live");
      this.armRefresh();
      for (const join of this.rejoin.values()) void join();
    });
    s.on("session:hello", (hello: HelloState) => {
      const prev = this.hello;
      const resync = shouldResync(prev, hello, this.lastUseq);
      this.hello = hello;
      this.lastUseq = Math.max(this.lastUseq, hello.useq);
      for (const l of this.helloListeners) l(hello, resync);
    });
    s.on("disconnect", (reason) => {
      this.lastLiveAt = Date.now();
      this.disarmRefresh();
      if (this.holds.size === 0) return this.setState("idle");
      if (reason === "io server disconnect") {
        // The server kicked us (token revoked, deploy): get a fresh token, then reconnect.
        void this.freshToken(true).then(() => {
          if (this.holds.size > 0) s.connect();
        });
      }
      this.setState(online() ? "reconnecting" : "offline");
    });
    s.on("connect_error", (err: Error) => {
      if (err.message === "upgrade_required") return this.setState("upgrade_required");
      if (err.message === "unauthorized") {
        this.token = null;
        this.setState("unauthorized");
        if (!s.active) this.retryUnauthorized(s);
        return;
      }
      if (this.state !== "unauthorized") this.setState(online() ? "reconnecting" : "offline");
    });

    if (typeof window !== "undefined") {
      const onOnline = () => {
        if (this.holds.size && !s.connected) s.connect();
      };
      const onOffline = () => {
        if (this.holds.size && this.state !== "idle") this.setState("offline");
      };
      const onVis = () => this.onVisibility();
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVis);
      this.cleanups.push(() => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVis);
      });
    }
    this.socket = s;
    return s;
  }

  /** Token 401: retry the token fetch every 3 s for up to 2 min, then give up (the open game continues). */
  private retryUnauthorized(s: LooseSocket): void {
    const since = this.auth.kind === "refreshing" ? this.auth.since : Date.now();
    if (Date.now() - since > AUTH_RETRY_FOR_MS) {
      this.setAuth({ kind: "failed" });
      return;
    }
    const retryAt = Date.now() + AUTH_RETRY_EVERY_MS;
    this.setAuth({ kind: "refreshing", retryAt, since });
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = setTimeout(() => {
      this.authTimer = null;
      void this.freshToken(true).then((t) => {
        if (this.destroyed || this.holds.size === 0) return;
        if (t) s.connect();
        else this.retryUnauthorized(s);
      });
    }, AUTH_RETRY_EVERY_MS);
  }

  private onVisibility(): void {
    if (document.hidden) {
      const critical = [...this.holds.keys()].some((h) => CRITICAL.has(h));
      if (!critical && this.holds.size) {
        this.hiddenTimer = setTimeout(() => this.socket?.disconnect(), HIDDEN_DISCONNECT_MS);
      }
    } else {
      if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
      if (this.holds.size && this.socket && !this.socket.connected && !this.socket.active) this.socket.connect();
    }
  }

  /** Refresh the token 2 minutes before `exp` while connected and hand it to the server (`session:refresh_token`). */
  private armRefresh(): void {
    this.disarmRefresh();
    const t = this.token;
    if (!t) return;
    const inMs = Math.max(5_000, (t.expiresAt - TOKEN_REFRESH_BEFORE_S) * 1000 - Date.now());
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.freshToken(true).then((fresh) => {
        if (fresh && this.state === "live") {
          void this.command("session:refresh_token", { token: fresh.token }).catch(() => {});
        }
        this.armRefresh();
      });
    }, inMs);
  }

  private disarmRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private clearTimers(): void {
    this.disarmRefresh();
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.hiddenTimer = null;
    this.authTimer = null;
  }

  private async freshToken(force = false): Promise<SocketToken | null> {
    const now = Date.now() / 1000;
    if (!force && this.token && this.token.expiresAt - TOKEN_REFRESH_BEFORE_S > now) return this.token;
    try {
      const t = await this.cfg.fetchToken();
      if (t) this.token = t;
      return t;
    } catch {
      return null;
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    if (s === "live" && this.auth.kind === "failed") this.auth = { kind: "ok" };
    for (const l of this.listeners) l();
  }

  private setAuth(a: AuthStatus): void {
    this.auth = a;
    for (const l of this.listeners) l();
  }
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** GET /api/socket-token (envelope `{ data: { token, expiresAt } }`); null on 401/402 or a network error. */
export async function fetchSocketToken(): Promise<SocketToken | null> {
  const res = await fetch("/api/socket-token", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Partial<SocketToken> } & Partial<SocketToken>;
  const data = body.data ?? body;
  return typeof data.token === "string" && typeof data.expiresAt === "number"
    ? { token: data.token, expiresAt: data.expiresAt }
    : null;
}

// ── the tab singleton (created by RealtimeBoot) ──

let instance: RealtimeConnection | null = null;

export function getRealtime(): RealtimeConnection | null {
  return instance;
}

/** Creates the singleton once per tab (idempotent); later calls only seed a newer token. */
export function bootRealtime(cfg: RealtimeConfig, token: SocketToken | null): RealtimeConnection {
  if (!instance) instance = new RealtimeConnection(cfg);
  instance.seedToken(token);
  return instance;
}

/** Sign-out (client-data-layer 6.6). */
export function destroyRealtime(): void {
  instance?.destroy();
  instance = null;
}
