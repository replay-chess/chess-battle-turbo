// The e2e socket servers (phase-02 plan 12.6, 12.0 "Test hooks P2 adds"; WP-I).
//
// Three v2 socket servers serve an e2e run, all from source (`tsx apps/web-socket/src/index.ts`), all with an
// explicit environment (the server has no dotenv, so apps/web-socket/.env, which holds production values, is never
// read):
//
//   :3002  the app's own socket (NEXT_PUBLIC_WEBSOCKET_URL), real timings, PROTOCOL_V1=on for the legacy specs and
//          the flags-off project. Started by playwright.config.ts (`socketServerCommand("main")`).
//   :3102  the fixture socket, TIMING_PROFILE=fast (study 3 s, first move 3 s, grace 3 s, rematch TTL 3 s, resume
//          wait 5 s) and PROTOCOL_V1=off (upgrade_required). Started by playwright.config.ts (`"fast"`).
//   :3103  the restartable fixture socket: spawned and killed by the `restartable` fixture below (restart-resume,
//          upgrade-required's restart), only in the `game-serial` project, which runs after every other project.
//
// The plan's "one fixture server per worker" is narrowed to one shared fast server plus one restartable server that
// runs alone: every v2 server restores every live game of the shared database at boot (restoreList, plan 6.6.8) and
// would time out the games another server is running, so only a server that boots when nothing else plays may
// restart (request to WP-D: a test-only RESTORE_SCOPE=journal would lift this).
//
// The browser always opens ws://localhost:3002 (a build-time URL). `linkContext()` installs a WebSocket route on a
// browser context that pipes every socket.io connection to the chosen server, aborts the polling fallback (so a
// page can never silently reach the wrong server), and can cut the link to simulate a dropped network.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { parse as parseEnv } from "dotenv";
import { ringSignedBy, WORKER_URL } from "./analysis-worker";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WS_DIR = path.resolve(WEB_DIR, "../web-socket");

/**
 * E2E_PORT_OFFSET moves every local e2e server by the same amount (web 3000, sockets 3002/3102/3103, sink 4011), so
 * two checkouts (git worktrees) can run the suite side by side. CI and a plain local run use offset 0. The web app's
 * NEXT_PUBLIC_WEBSOCKET_URL must name the shifted main port (the link below only routes that one).
 */
export const E2E_PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0) || 0;
export const WEB_PORT = 3000 + E2E_PORT_OFFSET;
export const MAIN_SOCKET_PORT = 3002 + E2E_PORT_OFFSET;
export const FAST_SOCKET_PORT = 3102 + E2E_PORT_OFFSET;
export const RESTARTABLE_SOCKET_PORT = 3103 + E2E_PORT_OFFSET;
export const DEFAULT_SINK_PORT = 4011 + E2E_PORT_OFFSET;
export type SocketKind = "main" | "fast" | "restartable";
export const SOCKET_PORTS: Record<SocketKind, number> = {
  main: MAIN_SOCKET_PORT,
  fast: FAST_SOCKET_PORT,
  restartable: RESTARTABLE_SOCKET_PORT,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Branch `dev` of Neon project withered-cake-82837167 (the same allow-list as @repo/db/seed-guards). */
const DEV_HOST = /^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/;

export class SocketFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocketFixtureError";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * The socket's DATABASE_URL: E2E_SOCKET_DATABASE_URL, else apps/web-socket/.env.local-dev (the replay_realtime role
 * on the Neon dev branch, gitignored), else DATABASE_URL (CI: the Docker Postgres). Refuses every host but a local
 * Postgres and the Neon dev endpoint. The value is never logged.
 */
export function socketDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  let url = env.E2E_SOCKET_DATABASE_URL;
  if (!url) {
    try {
      url = parseEnv(readFileSync(path.join(WS_DIR, ".env.local-dev"))).DATABASE_URL;
    } catch {
      // CI has no local env file.
    }
  }
  url ||= env.DATABASE_URL;
  if (!url) throw new SocketFixtureError("no DATABASE_URL for the e2e socket server");
  const host = hostOf(url);
  if (!LOCAL_HOSTS.has(host) && !DEV_HOST.test(host)) {
    throw new SocketFixtureError(`refusing to run the e2e socket against ${host}: only a local Postgres or the Neon dev branch`);
  }
  return url;
}

/** Fresh per process: the fixture signs /internal/broadcast with it; it never leaves this machine. */
const OPS_KEY = randomBytes(32).toString("base64");

function journalRoot(): string {
  return process.env.E2E_JOURNAL_ROOT || path.join(WEB_DIR, "test-results", "socket-journal");
}

/** The full environment of one e2e socket server (plan 7.9). Secrets come from the run's env, never from git. */
export function socketServerEnv(
  kind: SocketKind,
  opts: { webAppUrl?: string; extraOrigins?: string[]; sinkPort?: number; strict?: boolean } = {},
) {
  const port = SOCKET_PORTS[kind];
  const web = opts.webAppUrl ?? `http://localhost:${WEB_PORT}`;
  const origins = [...new Set([web, `http://localhost:${WEB_PORT}`, ...(opts.extraOrigins ?? [])])];
  const webInternal = process.env.INTERNAL_API_SECRET?.trim();
  // The web signs with its own ring (a bare value is kid `web`); the fixture adds an `ops` kid for the broadcast.
  // P3: a run ring that also holds `ws` and `wk` (fixtures/analysis-worker.ts) is reordered so the socket signs its
  // worker kicks with `ws`, and keeps `wk` so the worker's analysis:* emits and /internal/load probes verify.
  const internal = [
    webInternal && !webInternal.includes(":")
      ? `web:${Buffer.from(webInternal).toString("base64")}`
      : ringSignedBy(webInternal, "ws")
          .split(",")
          .filter((e) => !/^(webwk|opswk):/.test(e.trim()))
          .join(","),
    `ops:${OPS_KEY}`,
  ]
    .filter(Boolean)
    .join(",");
  // Without the web app's token secret the server boots (APP_ENV=test does not require it) but refuses every v2
  // handshake, and the game pages sit in `loading` with no error. `strict` (every spawn this module does itself)
  // refuses; the config-time call (Playwright webServer env, also evaluated by `--list` in jobs with no secrets and
  // by the v1-only flags-off run) only warns. regression: REGRESSION-2.
  const tokenSecret = process.env.SOCKET_TOKEN_SECRET?.trim() ?? "";
  if (!tokenSecret) {
    const msg = "SOCKET_TOKEN_SECRET is not set: source apps/web/.env.test (or set it as ci.yml does)";
    if (opts.strict) throw new SocketFixtureError(msg);
    console.warn(`[socket-server] ${msg}; v2 handshakes will be refused`);
  }
  const journal = path.join(journalRoot(), kind);
  mkdirSync(journal, { recursive: true });
  const env: Record<string, string> = {
    APP_ENV: "test",
    PORT: String(port),
    WEB_APP_URL: web,
    ALLOWED_ORIGINS: origins.join(","),
    PROTOCOL_V1: kind === "main" ? "on" : "off",
    DATABASE_URL: socketDatabaseUrl(),
    JOURNAL_DIR: journal,
    SOCKET_TOKEN_SECRET: tokenSecret,
    INTERNAL_API_SECRET: internal,
    SENTRY_DSN: "",
    POSTHOG_HOST: `http://127.0.0.1:${opts.sinkPort ?? Number(process.env.POSTHOG_SINK_PORT ?? DEFAULT_SINK_PORT)}`,
    POSTHOG_PROJECT_KEY: "phc_e2e_local_sink",
    LOG_LEVEL: process.env.E2E_SOCKET_LOG_LEVEL ?? "warn",
    // P3: the socket kicks the e2e analysis worker after a live finish (phase-03 plan §7.6).
    ANALYSIS_WORKER_URL: WORKER_URL,
  };
  if (kind !== "main") env.TIMING_PROFILE = "fast";
  // The v1 path (main server, PROTOCOL_V1=on) sends `x-internal-token` to the web's legacy chess routes, which compare
  // it with the web's INTERNAL_API_SECRET verbatim. So LEGACY must be that exact string: an explicit value wins, else
  // the web's own value (bare or `web:<b64>`). Without it the flags-off v1 specs 401 on every move (FIX-A).
  const legacy = process.env.LEGACY_INTERNAL_API_SECRET?.trim() || webInternal;
  if (kind === "main" && legacy) env.LEGACY_INTERNAL_API_SECRET = legacy;
  return env;
}

/** The command Playwright's webServer runs (from source; `tsx`, no watch). */
export const SOCKET_SERVER_COMMAND = "pnpm --filter web-socket exec tsx src/index.ts";

export type ReadyBody = { ready: boolean; restored: boolean; draining?: boolean };

export async function socketReady(port: number): Promise<ReadyBody | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(2_000) });
    return (await res.json()) as ReadyBody;
  } catch {
    return null;
  }
}

export async function waitForSocketReady(port: number, timeoutMs = 90_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await socketReady(port);
    if (r?.ready && r.restored) return;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new SocketFixtureError(`socket server on :${port} not ready within ${timeoutMs} ms`);
}

/** Signs and sends one ops call (POST /internal/broadcast) to a fixture server started by this process. */
export async function signedOps(port: number, pathName: string, body: unknown): Promise<Response> {
  const { parseKeyRing, signInternal } = await import("@repo/contracts/internal/auth");
  const raw = JSON.stringify(body);
  const headers = signInternal({ keys: parseKeyRing(`ops:${OPS_KEY}`), method: "POST", path: pathName, body: raw, nowMs: Date.now(), kid: "ops" });
  return fetch(`http://127.0.0.1:${port}${pathName}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: raw });
}

/** A socket server process this test owns (the restartable one). */
export class FixtureSocketServer {
  private child: ChildProcess | null = null;
  private log: string[] = [];
  constructor(readonly kind: SocketKind = "restartable") {}

  get port(): number {
    return SOCKET_PORTS[this.kind];
  }

  /** Last lines of the server's stdout/stderr (attached to failing tests). */
  output(): string {
    return this.log.slice(-200).join("");
  }

  async start(timeoutMs = 90_000): Promise<void> {
    if (this.child) return;
    if (await socketReady(this.port)) throw new SocketFixtureError(`port ${this.port} is already serving a socket server`);
    const child = spawn(path.join(WS_DIR, "node_modules/.bin/tsx"), ["src/index.ts"], {
      cwd: WS_DIR,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...socketServerEnv(this.kind, { strict: true }) } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (b: Buffer) => {
      this.log.push(b.toString());
      if (this.log.length > 400) this.log.splice(0, 200);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
    await waitForSocketReady(this.port, timeoutMs);
  }

  /** SIGTERM = the deploy path (drain: clocks frozen, checkpoints flushed); SIGKILL = a crash. */
  async stop(signal: "SIGTERM" | "SIGKILL" = "SIGTERM", timeoutMs = 30_000): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((res) => child.once("exit", () => res()));
    child.kill(signal);
    await Promise.race([exited, new Promise((res) => setTimeout(res, timeoutMs))]);
    if (this.child === child) {
      child.kill("SIGKILL");
      await exited;
    }
    this.child = null;
  }

  async restart(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
    await this.stop(signal);
    await this.start();
  }

  /** `server:restarting {restartAt}` to every game room, as the deploy workflow's broadcast step does. */
  async broadcastRestart(inSeconds = 5): Promise<{ restartAt: number; rooms: number }> {
    const res = await signedOps(this.port, "/internal/broadcast", { v: 1, type: "restart", inSeconds });
    if (res.status !== 202) throw new SocketFixtureError(`broadcast answered ${res.status}`);
    return (await res.json()) as { restartAt: number; rooms: number };
  }
}

// ─── Browser link ───────────────────────────────────────────────────────────────────────────────────────────────

/** Not an engine.io packet type: engine.io-parser decodes it as `{ type: "error" }`, a failed transport. */
export const REFUSED_FRAME = "x";

const SOCKET_WS = new RegExp(`^wss?://(localhost|127\\.0\\.0\\.1):${MAIN_SOCKET_PORT}/socket\\.io/`);
const SOCKET_POLL = new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${MAIN_SOCKET_PORT}/socket\\.io/`);

export type SocketLink = {
  readonly kind: SocketKind;
  /** Upstream connections opened through this link so far. */
  readonly connections: number;
  /** Drops every open socket and refuses new ones while on (a network loss the page cannot see coming). */
  setDown(down: boolean): Promise<void>;
  /** Frames the page received, newest last (text only, for assertions on server events). */
  frames(): readonly string[];
  /** A position in the received frames that stays valid when old frames are dropped (`framesSince`). */
  mark(): number;
  /** Every frame received since `mark()`; throws if some of them were already dropped (never passes vacuously). */
  framesSince(mark: number): readonly string[];
  /** Frames the page sent (text only): commands such as `42N["move",{…}]`. */
  sent(): readonly string[];
  /** Refuses the next handshakes with a socket.io CONNECT_ERROR carrying `code` (e.g. upgrade_required). */
  refuseWith(code: string | null): void;
  /** Delays every frame from the page to the server (optimistic-UI specs). */
  delayOutgoing(ms: number): void;
  /** Answers the next `event` command itself with `ack` (after `delayMs`) instead of forwarding it: a forced ack. */
  forceAck(event: string, ack: unknown, delayMs?: number): void;
};

/**
 * Pipes the context's socket.io WebSockets to the chosen server. Node's WebSocket sends no Origin header, which the
 * server allows (non-browser clients); the browser's own Origin check is covered by the main server's specs.
 */
export async function linkContext(context: BrowserContext, kind: SocketKind): Promise<SocketLink> {
  const port = SOCKET_PORTS[kind];
  const routes = new Set<{ page: WebSocketRoute; up: WebSocket | null }>();
  const frames: string[] = [];
  /** Frames dropped from the front of `frames` (the window keeps the last 1000–2000). */
  let dropped = 0;
  const sentFrames: string[] = [];
  let down = false;
  let refuse: string | null = null;
  let delay = 0;
  let connections = 0;
  const forced = new Map<string, { ack: unknown; delayMs: number }>();

  await context.route(SOCKET_POLL, (route) => route.abort("connectionrefused"));
  await context.routeWebSocket(SOCKET_WS, (ws) => {
    const entry: { page: WebSocketRoute; up: WebSocket | null } = { page: ws, up: null };
    routes.add(entry);
    let upOpen = false;
    const closePage = () => {
      routes.delete(entry);
      // An upstream that never opened is a refused connection (the server is down or restarting). A browser sees a
      // transport error then (behind Caddy: a 502 on the upgrade) and socket.io-client retries on its backoff. A
      // routed WebSocket can only close cleanly, and engine.io-client ignores a clean close before its handshake: the
      // attempt then waited out the client's 10 s connect timeout, longer than the restart's resume wait plus grace
      // (restart-resume abandoned a player that way, CI run 43037495714). An unknown engine.io packet type decodes
      // as the parser's `error` packet, which the client handles as that failed transport.
      if (!upOpen) {
        try {
          ws.send(REFUSED_FRAME);
        } catch {
          // page side already gone
        }
      }
      ws.close({ code: 1000, reason: "upstream closed" }).catch(() => undefined);
    };
    if (down) return void closePage();
    if (refuse) {
      // engine.io OPEN, then socket.io CONNECT_ERROR for namespace "/" (what the server sends from a refused handshake).
      const code = refuse;
      ws.send(`0${JSON.stringify({ sid: `e2e${Date.now()}`, upgrades: [], pingInterval: 10000, pingTimeout: 8000, maxPayload: 16000 })}`);
      ws.onMessage((m) => {
        if (typeof m === "string" && m.startsWith("40")) ws.send(`44${JSON.stringify({ message: code, data: { code } })}`);
      });
      return;
    }
    const target = ws.url().replace(/^wss?:\/\/[^/]+/, `ws://127.0.0.1:${port}`);
    const up = new WebSocket(target);
    up.binaryType = "arraybuffer";
    entry.up = up;
    connections++;
    const pending: (string | Buffer)[] = [];
    up.onopen = () => {
      upOpen = true;
      for (const m of pending.splice(0)) up.send(m);
    };
    up.onmessage = (e: MessageEvent) => {
      const data = typeof e.data === "string" ? e.data : Buffer.from(e.data as ArrayBuffer);
      if (typeof data === "string") {
        frames.push(data);
        if (frames.length > 2000) {
          frames.splice(0, 1000);
          dropped += 1000;
        }
      }
      try {
        ws.send(data);
      } catch {
        // page side already gone
      }
    };
    up.onclose = closePage;
    up.onerror = closePage;
    ws.onMessage((m) => {
      if (typeof m === "string") {
        sentFrames.push(m);
        if (sentFrames.length > 2000) sentFrames.splice(0, 1000);
        const cmd = /^42(\d+)\["([^"]+)"/.exec(m);
        const f = cmd ? forced.get(cmd[2]!) : undefined;
        if (cmd && f) {
          forced.delete(cmd[2]!);
          setTimeout(() => {
            try {
              ws.send(`43${cmd[1]}${JSON.stringify([f.ack])}`);
            } catch {
              // page gone
            }
          }, f.delayMs);
          return;
        }
      }
      const send = () => {
        if (up.readyState === WebSocket.OPEN) up.send(m);
        else if (up.readyState === WebSocket.CONNECTING) pending.push(m);
      };
      if (delay > 0) setTimeout(send, delay);
      else send();
    });
    ws.onClose(() => {
      routes.delete(entry);
      try {
        up.close();
      } catch {
        // already closed
      }
    });
  });

  return {
    kind,
    get connections() {
      return connections;
    },
    async setDown(on) {
      down = on;
      if (on) {
        for (const r of [...routes]) {
          r.up?.close();
          await r.page.close({ code: 1000, reason: "e2e link down" }).catch(() => undefined);
          routes.delete(r);
        }
      }
    },
    frames: () => frames,
    mark: () => dropped + frames.length,
    framesSince(mark) {
      if (mark < dropped) throw new Error(`framesSince(${mark}): frames up to ${dropped} were already dropped`);
      return frames.slice(mark - dropped);
    },
    sent: () => sentFrames,
    refuseWith(code) {
      refuse = code;
    },
    delayOutgoing(ms) {
      delay = ms;
    },
    forceAck(event, ack, delayMs = 0) {
      forced.set(event, { ack, delayMs });
    },
  };
}
