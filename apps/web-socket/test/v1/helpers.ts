/**
 * Shared harness for the protocol v1 tests (P1 plan §12.1), now run through the P2 server: the v2 handshake routes
 * sockets without `proto` to the v1 handlers while PROTOCOL_V1=on (phase-02 plan 7.4.1 step 2). An in-process
 * socket server, a mock of the web app's internal routes, and socket.io clients. Not a test file itself.
 *
 * Call `prepareEnv()` before `startSocketServer()`: the server reads its environment from `process.env`.
 */
import { createHmac } from "node:crypto";
import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createSocketServer, type SocketServerHandle } from "../../src/app";
import { loadEnv } from "../../src/config/env";
import { SILENT_LOGGER, type LivePersistence } from "../../src/ports";
import type { V1RuntimeOptions } from "../../src/v1/runtime";
import type { GameManager } from "../../src/v1/GameManager";
import type { GameData, PlayerInfo } from "../../src/v1/types";

export const TEST_SECRET = "test-internal-secret-0123456789abcdef";

/** Isolates the process from `apps/web-socket/.env` and from Sentry. */
export function prepareEnv(overrides: Record<string, string> = {}): void {
  process.env.DOTENV_CONFIG_PATH = "/nonexistent/.env";
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.SENTRY_DSN = "";
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "test";
  process.env.PROTOCOL_V1 = "on";
  // The legacy bare secret: v1 user tokens, the v1 x-internal-token calls and the static-token route.
  process.env.INTERNAL_API_SECRET = TEST_SECRET;
  delete process.env.LEGACY_INTERNAL_API_SECRET;
  delete process.env.SOCKET_TOKEN_SECRET;
  delete process.env.TIMING_PROFILE;
  process.env.ALLOWED_ORIGINS = "";
  Object.assign(process.env, overrides);
}

// -------------------------------------------------------------------------------------------
// Tokens (same format as apps/web/lib/socket-token.ts)
// -------------------------------------------------------------------------------------------

export function makeSocketToken(sub: string, secret = TEST_SECRET, ttlSeconds = 300): string {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

// -------------------------------------------------------------------------------------------
// Games
// -------------------------------------------------------------------------------------------

export function player(ref: string): PlayerInfo {
  return { userReferenceId: ref, name: `Player ${ref}`, code: ref.toUpperCase(), profilePictureUrl: null };
}

let gameCounter = 0;
export function uniqueRef(prefix: string): string {
  gameCounter += 1;
  return `${prefix}-${process.pid}-${gameCounter}`;
}

export interface MakeGameInput {
  ref: string;
  creator: string;
  opponent?: string | null;
  status?: GameData["status"];
  startingFen?: string;
  initialTimeSeconds?: number;
  gameData?: Record<string, unknown>;
}

export function makeGame(input: MakeGameInput): GameData {
  const initial = input.initialTimeSeconds ?? 300;
  return {
    referenceId: input.ref,
    creatorId: input.creator,
    opponentId: input.opponent ?? null,
    chessPositionId: null,
    startingFen: input.startingFen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    initialTimeSeconds: initial,
    incrementSeconds: 0,
    creatorTimeRemaining: initial,
    opponentTimeRemaining: initial,
    status: input.status ?? "IN_PROGRESS",
    gameData: { gameMode: "friend", ...(input.gameData ?? {}) } as GameData["gameData"],
    creator: player(input.creator),
    ...(input.opponent ? { opponent: player(input.opponent) } : {}),
  };
}

// -------------------------------------------------------------------------------------------
// Mock web app (game-by-ref, move, game-over, game-state), following the H2/H4 contracts
// -------------------------------------------------------------------------------------------

export interface RecordedCall {
  path: string;
  token: string | undefined;
  body: any;
  at: number;
}

export interface MockWebApi {
  url: string;
  games: Map<string, GameData>;
  calls: RecordedCall[];
  callsTo(path: string, ref?: string): RecordedCall[];
  /** Next N answers on `path` are this status (for retry tests). */
  failNext(path: string, status: number, times: number): void;
  /** Next N requests on `path` are answered only after `ms` (for timeout tests). */
  slowNext(path: string, ms: number, times: number): void;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function envelope(code: string, message: string) {
  return { error: { code, message, requestId: "test" } };
}

export async function startMockWebApi(): Promise<MockWebApi> {
  const games = new Map<string, GameData>();
  const calls: RecordedCall[] = [];
  const failures = new Map<string, { status: number; times: number }>();
  const slowdowns = new Map<string, { ms: number; times: number }>();

  const server: HttpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const token = req.headers["x-internal-token"] as string | undefined;
    const body = req.method === "POST" ? await readBody(req) : null;
    calls.push({ path: url.pathname, token, body, at: Date.now() });

    const slowdown = slowdowns.get(url.pathname);
    if (slowdown && slowdown.times > 0) {
      slowdown.times -= 1;
      await new Promise((resolve) => setTimeout(resolve, slowdown.ms));
    }

    const failure = failures.get(url.pathname);
    if (failure && failure.times > 0) {
      failure.times -= 1;
      send(res, failure.status, envelope("internal", "Injected failure"));
      return;
    }

    const internal = token === TEST_SECRET;

    const byRef = /^\/api\/chess\/game-by-ref\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && byRef) {
      const game = games.get(decodeURIComponent(byRef[1]!));
      if (!game) return send(res, 404, { success: false, error: "Game not found" });
      if (internal) return send(res, 200, { success: true, data: game });
      // H4 invite projection
      const gd = (game.gameData ?? {}) as Record<string, unknown>;
      return send(res, 200, {
        success: true,
        data: {
          ...game,
          creatorTimeRemaining: null,
          opponentTimeRemaining: null,
          gameData: { creatorColor: gd.creatorColor, gameMode: gd.gameMode },
        },
      });
    }

    if (req.method !== "POST") return send(res, 404, envelope("not_found", "No route"));
    if (!internal) return send(res, 401, envelope("unauthorized", "Sign in to continue."));
    const game = body?.gameReferenceId ? games.get(body.gameReferenceId) : undefined;
    if (!game) return send(res, 404, envelope("not_found", "Game not found."));

    if (url.pathname === "/api/chess/move") {
      if (game.status !== "IN_PROGRESS") return send(res, 409, envelope("conflict", "The game is no longer in progress."));
      const stored = (game.gameData?.moveHistory ?? []) as unknown[];
      if (body.moveHistory.length < stored.length) {
        return send(res, 409, envelope("conflict", "A newer move history is already stored."));
      }
      game.gameData = { ...game.gameData, fen: body.fen, moveHistory: body.moveHistory };
      game.creatorTimeRemaining = body.whiteTime;
      game.opponentTimeRemaining = body.blackTime;
      return send(res, 200, { success: true, data: { game: { referenceId: game.referenceId } } });
    }

    if (url.pathname === "/api/chess/game-over") {
      if (game.status !== "IN_PROGRESS") return send(res, 409, envelope("conflict", "The game is no longer in progress."));
      game.status = "COMPLETED";
      (game as GameData & { result?: string }).result = body.result;
      game.gameData = {
        ...game.gameData,
        fen: body.fen,
        ...(Array.isArray(body.moveHistory) ? { moveHistory: body.moveHistory } : {}),
      };
      return send(res, 200, { success: true, data: { gameReferenceId: game.referenceId, status: "COMPLETED" } });
    }

    if (url.pathname === "/api/chess/game-state") {
      if (game.status !== "IN_PROGRESS") return send(res, 409, envelope("conflict", "The game is no longer in progress."));
      game.creatorTimeRemaining = body.whiteTime;
      game.opponentTimeRemaining = body.blackTime;
      return send(res, 200, { success: true });
    }

    return send(res, 404, envelope("not_found", "No route"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    games,
    calls,
    callsTo(path, ref) {
      return calls.filter((c) => c.path === path && (ref === undefined || c.body?.gameReferenceId === ref));
    },
    failNext(path, status, times) {
      failures.set(path, { status, times });
    },
    slowNext(path, ms, times) {
      slowdowns.set(path, { ms, times });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// -------------------------------------------------------------------------------------------
// In-process socket server
// -------------------------------------------------------------------------------------------

export interface RunningSocketServer {
  url: string;
  handle: SocketServerHandle & { gameManager: GameManager };
  close(): Promise<void>;
}

/** v1 never touches the v2 persistence port; any call is a test failure. */
const NO_PERSISTENCE: LivePersistence = {
  load: () => Promise.reject(new Error("v1 test: no v2 persistence")),
  journal() {},
  checkpoint() {},
  finish: () => Promise.resolve({ committed: false }),
  abort: () => Promise.resolve({ committed: false }),
  createRematch: () => Promise.resolve({ ok: false, code: "internal" }),
};

export async function startSocketServer(
  options: V1RuntimeOptions & { drainTimeoutMs?: number } = {},
): Promise<RunningSocketServer> {
  const { drainTimeoutMs = 2000, ...v1 } = options;
  const server = createSocketServer({
    env: loadEnv(process.env),
    persistence: NO_PERSISTENCE,
    log: SILENT_LOGGER,
    v1,
    drainTimeoutMs,
  });
  const port = await server.listen(0, "127.0.0.1");
  const gameManager = server.v1!.gameManager;
  return {
    url: `http://127.0.0.1:${port}`,
    handle: Object.assign(server, { gameManager }),
    close: () => server.shutdown(),
  };
}

// -------------------------------------------------------------------------------------------
// Clients
// -------------------------------------------------------------------------------------------

const openClients = new Set<ClientSocket>();

/** A connected client. Pass `token: null` for an empty handshake. */
export async function connectClient(url: string, sub: string | null, opts: { token?: string } = {}): Promise<ClientSocket> {
  const token = opts.token ?? (sub ? makeSocketToken(sub) : undefined);
  const socket = ioClient(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: token ? { token } : {},
  });
  openClients.add(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
  return socket;
}

/** Connects and expects the handshake to be refused; resolves with the error message. */
export function expectConnectError(url: string, auth: Record<string, unknown>): Promise<string> {
  const socket = ioClient(url, { transports: ["websocket"], reconnection: false, forceNew: true, auth });
  openClients.add(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => reject(new Error("connected, expected connect_error")));
    socket.once("connect_error", (err) => resolve(err.message));
  });
}

export function closeAllClients(): void {
  for (const socket of openClients) socket.close();
  openClients.clear();
}

/** Resolves with the next `event` payload, or rejects after `timeoutMs`. */
export function waitFor<T = any>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

/** Collects every payload of `event` until read. */
export function collect<T = any>(socket: ClientSocket, event: string): T[] {
  const seen: T[] = [];
  socket.on(event, (payload: T) => seen.push(payload));
  return seen;
}

/** Polls `predicate` until true or `timeoutMs`. */
export async function until(predicate: () => boolean, timeoutMs = 3000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Joins both players and resolves with their `game_started` payloads. The first join is
 * awaited (its session exists) before the second is sent.
 */
export async function joinBoth(
  api: MockWebApi,
  gameRef: string,
  first: { socket: ClientSocket; ref: string },
  second: { socket: ClientSocket; ref: string },
): Promise<{ first: any; second: any }> {
  const firstStarted = waitFor(first.socket, "game_started");
  const secondStarted = waitFor(second.socket, "game_started");
  const fetchesBefore = api.callsTo(`/api/chess/game-by-ref/${gameRef}`).length;
  first.socket.emit("join_game", { gameReferenceId: gameRef, userReferenceId: first.ref });
  await until(() => api.callsTo(`/api/chess/game-by-ref/${gameRef}`).length > fetchesBefore, 3000, "first join fetch");
  await delay(30);
  second.socket.emit("join_game", { gameReferenceId: gameRef, userReferenceId: second.ref });
  return { first: await firstStarted, second: await secondStarted };
}
