/* eslint-disable @typescript-eslint/no-explicit-any -- test acks and events are checked by assertions, not by types */
// Shared harness for the protocol v2 tests (phase-02 plan 12.4, without a database): an in-process socket server
// on a random port, an in-memory LivePersistence holding `LiveGameRecord`s, v2 tokens minted with a test key, and
// socket.io clients that speak `proto: 2`. Not a test file itself.
import { randomBytes } from "node:crypto";
import type { LiveGameRecord } from "@repo/db/live";
import { parseSocketKeyRing, mintSocketToken } from "@repo/contracts/socket/token";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createSocketServer, type SocketServerHandle } from "../src/app";
import { loadEnv, type ServerEnv } from "../src/config/env";
import { timingFor, type Timing } from "../src/config/timing";
import type { LiveSession } from "../src/game/LiveSession";
import { SILENT_LOGGER, createMemoryMetrics, type LivePersistence, type RematchOutcome, type TelemetryProps } from "../src/ports";
import { startPlyOf, type AbortedBy, type GameResult, type JournalLine, type Side } from "@repo/game-core";

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** The Opera Game legend start (White to move at move 10, startPly 18): a study-phase start. */
export const OPERA_START_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";

export const TEST_KEY = randomBytes(32).toString("base64");
export const SOCKET_TOKEN_SECRET = `t1:${TEST_KEY}`;

/** A cuid-shaped ref (`/^c[a-z0-9]{20,31}$/`, the contract's Ref). */
export function ref(): string {
  const bytes = randomBytes(24);
  let out = "c";
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

export function testEnv(overrides: Record<string, string | undefined> = {}): ServerEnv {
  return loadEnv({
    APP_ENV: "test",
    SOCKET_TOKEN_SECRET,
    PROTOCOL_V1: "off",
    ...overrides,
  });
}

/** Fast server timings, shortened further for unit tests. */
export function testTiming(patch: Partial<Timing["machine"]> = {}, rest: Partial<Omit<Timing, "machine">> = {}): Timing {
  const base = timingFor({ timingProfile: "fast", overrides: {} });
  return {
    ...base,
    ipGuardBootGraceMs: 0,
    spectatorsUpdateMinMs: 50,
    ...rest,
    machine: { ...base.machine, firstMoveMs: 5_000, graceMs: 5_000, rematchMs: 5_000, ...patch },
  };
}

export interface User {
  ref: string;
  id: bigint;
  name: string;
}

let userId = 100n;
export function user(name: string): User {
  userId += 1n;
  return { ref: ref(), id: userId, name };
}

export interface RecordInput {
  ref?: string;
  white: User | null;
  black: User | null;
  status?: LiveGameRecord["status"];
  mode?: LiveGameRecord["mode"];
  startingFen?: string;
  studySeconds?: number;
  initialTimeSeconds?: number;
  incrementSeconds?: number;
  moves?: string;
  phase?: LiveGameRecord["phase"];
  tournament?: LiveGameRecord["tournament"];
}

let gameId = 1000n;
export function record(input: RecordInput): LiveGameRecord {
  gameId += 1n;
  const now = new Date();
  const p = (u: User | null) => (u ? { userId: u.id, ref: u.ref, name: u.name, rating: 1500, title: null, avatarUrl: null } : null);
  return {
    id: gameId,
    ref: input.ref ?? ref(),
    status: input.status ?? (input.white && input.black ? "IN_PROGRESS" : "WAITING_FOR_OPPONENT"),
    mode: input.mode === undefined ? "FRIEND" : input.mode,
    rated: false,
    timeClass: "BLITZ",
    startingFen: input.startingFen ?? INITIAL_FEN,
    startPly: startPlyOf(input.startingFen ?? INITIAL_FEN),
    studySeconds: input.studySeconds ?? 0,
    initialTimeSeconds: input.initialTimeSeconds ?? 300,
    incrementSeconds: input.incrementSeconds ?? 0,
    moves: input.moves ?? "",
    moveClocksMs: [],
    plyCount: input.moves ? input.moves.split(" ").length : 0,
    fen: null,
    whiteTimeMs: null,
    blackTimeMs: null,
    clockRunning: null,
    phase: input.phase ?? "WAITING",
    phaseEndsAt: null,
    lastMoveAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    endMethod: null,
    outcome: null,
    botElo: null,
    creatorId: input.white?.id ?? input.black?.id ?? 1n,
    opponentId: null,
    rematchOfId: null,
    rematchOfRef: null,
    chessPositionId: null,
    openingId: null,
    tournament: input.tournament ?? null,
    meta: null,
    white: p(input.white),
    black: p(input.black),
    whiteName: input.white?.name ?? null,
    blackName: input.black?.name ?? null,
    whiteRating: input.white ? 1500 : null,
    blackRating: input.black ? 1500 : null,
  };
}

/** In-memory persistence: records every call; `createRematch` inserts a swapped child record. */
export class MemoryPersistence implements LivePersistence {
  readonly records = new Map<string, LiveGameRecord>();
  loads = 0;
  readonly journalLines: { ref: string; line: JournalLine }[] = [];
  readonly checkpoints: { ref: string; reason: string; plies: number }[] = [];
  readonly finishes: { ref: string; result: GameResult; moves: string }[] = [];
  readonly aborts: { ref: string; result: GameResult; abortedBy: AbortedBy }[] = [];
  readonly rematches: { parent: string; offeredBy: Side; acceptedBy: Side; child: string }[] = [];
  /** Delay before load resolves (concurrency tests). */
  loadDelayMs = 0;

  add(r: LiveGameRecord): LiveGameRecord {
    this.records.set(r.ref, r);
    return r;
  }

  async load(ref: string): Promise<LiveGameRecord | null> {
    this.loads++;
    if (this.loadDelayMs) await new Promise((r) => setTimeout(r, this.loadDelayMs));
    const r = this.records.get(ref);
    return r ? structuredClone(r) : null;
  }

  journal(session: LiveSession, line: JournalLine): void {
    this.journalLines.push({ ref: session.ref, line });
  }

  checkpoint(session: LiveSession, reason: "move" | "phase" | "freeze"): void {
    this.checkpoints.push({ ref: session.ref, reason, plies: session.state.moves.length });
  }

  async finish(session: LiveSession, result: GameResult): Promise<{ committed: boolean }> {
    const already = this.finishes.some((f) => f.ref === session.ref);
    this.finishes.push({ ref: session.ref, result, moves: session.state.moves.join(" ") });
    const r = this.records.get(session.ref);
    if (r && !already) {
      r.status = "COMPLETED";
      r.endMethod = result.method.toUpperCase() as LiveGameRecord["endMethod"];
      r.outcome = result.winner === "w" ? "WHITE" : result.winner === "b" ? "BLACK" : "DRAW";
      r.moves = session.state.moves.join(" ");
      r.completedAt = new Date(result.endedAt);
    }
    return { committed: !already };
  }

  async abort(session: LiveSession, result: GameResult, abortedBy: AbortedBy): Promise<{ committed: boolean }> {
    this.aborts.push({ ref: session.ref, result, abortedBy });
    const r = this.records.get(session.ref);
    if (r) {
      r.status = "ABORTED";
      r.endMethod = "ABORTED";
      r.outcome = "NONE";
    }
    return { committed: true };
  }

  async createRematch(session: LiveSession, offeredBy: Side, acceptedBy: Side): Promise<RematchOutcome> {
    await session.whenEnded();
    const parent = this.records.get(session.ref);
    if (!parent || parent.status !== "COMPLETED") return { ok: false, code: "internal" };
    const child = { ...structuredClone(parent), ref: ref(), status: "IN_PROGRESS" as const, phase: "WAITING" as const };
    child.white = parent.black;
    child.black = parent.white;
    child.whiteName = parent.blackName;
    child.blackName = parent.whiteName;
    child.moves = "";
    child.endMethod = null;
    child.outcome = null;
    child.completedAt = null;
    this.records.set(child.ref, child);
    this.rematches.push({ parent: session.ref, offeredBy, acceptedBy, child: child.ref });
    return { ok: true, newRef: child.ref };
  }
}

export class MemoryTelemetry {
  readonly events: { event: string; distinctId: string; props: TelemetryProps }[] = [];
  capture(event: string, distinctId: string, props: TelemetryProps): void {
    this.events.push({ event, distinctId, props });
  }
}

export interface TestServer {
  url: string;
  handle: SocketServerHandle;
  persistence: MemoryPersistence;
  telemetry: MemoryTelemetry;
  metrics: ReturnType<typeof createMemoryMetrics>;
  close(): Promise<void>;
}

export async function startServer(
  opts: { env?: Record<string, string | undefined>; timing?: Timing; persistence?: MemoryPersistence } = {},
): Promise<TestServer> {
  const persistence = opts.persistence ?? new MemoryPersistence();
  const telemetry = new MemoryTelemetry();
  const metrics = createMemoryMetrics();
  const handle = createSocketServer({
    env: testEnv(opts.env),
    persistence,
    telemetry,
    metrics,
    log: SILENT_LOGGER,
    timing: opts.timing ?? testTiming(),
    drainTimeoutMs: 1_000,
  });
  const port = await handle.listen(0, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${port}`,
    handle,
    persistence,
    telemetry,
    metrics,
    close: async () => {
      closeAllClients();
      await handle.shutdown();
    },
  };
}

export function token(u: User, opts: { ent?: number; env?: "test" | "dev"; keyRing?: string; ttlSec?: number } = {}): string {
  const ent = opts.ent ?? Math.floor(Date.now() / 1000) + 86_400;
  return mintSocketToken(
    { sub: u.ref, env: opts.env ?? "test", ent, role: "user", name: u.name, ...(opts.ttlSec ? { ttlSec: opts.ttlSec } : {}) },
    parseSocketKeyRing(opts.keyRing ?? SOCKET_TOKEN_SECRET),
    Date.now(),
  ).token;
}

const open = new Set<ClientSocket>();

export function client(url: string, auth: Record<string, unknown>): ClientSocket {
  const socket = ioClient(url, { transports: ["websocket"], reconnection: false, forceNew: true, auth });
  open.add(socket);
  return socket;
}

/** A connected v2 client; resolves with the socket and its `session:hello`. */
export async function connect(
  url: string,
  u: User,
  opts: { ent?: number } = {},
): Promise<{ socket: ClientSocket; hello: { bootId: string; useq: number; serverNow: number } }> {
  const socket = client(url, { token: token(u, opts), proto: 2 });
  const hello = waitFor<{ bootId: string; useq: number; serverNow: number }>(socket, "session:hello");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
  return { socket, hello: await hello };
}

/** Resolves with the connect_error message. */
export function connectError(url: string, auth: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<string> {
  const socket = ioClient(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth,
    ...(extraHeaders ? { extraHeaders } : {}),
  });
  open.add(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => reject(new Error("connected, expected connect_error")));
    socket.once("connect_error", (err) => resolve(err.message));
  });
}

export function closeAllClients(): void {
  for (const s of open) s.close();
  open.clear();
}

/** An acked command (`emitWithAck` with a timeout). */
export function cmd<T = any>(socket: ClientSocket, name: string, payload?: unknown, timeoutMs = 3_000): Promise<T> {
  return socket.timeout(timeoutMs).emitWithAck(name, payload) as Promise<T>;
}

export function waitFor<T = any>(socket: ClientSocket, event: string, timeoutMs = 3_000, filter?: (p: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (filter && !filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Records every payload of the given events, in arrival order. */
export function record_(socket: ClientSocket, events: string[]): { event: string; payload: any }[] {
  const seen: { event: string; payload: any }[] = [];
  for (const event of events) socket.on(event, (payload: unknown) => seen.push({ event, payload }));
  return seen;
}
export { record_ as recordEvents };

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function until(predicate: () => boolean, timeoutMs = 3_000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await delay(10);
  }
}

/** Both players connected and joined; resolves when the game left `waiting`. */
export async function startGame(server: TestServer, w: User, b: User, rec: Partial<RecordInput> = {}) {
  const game = server.persistence.add(record({ white: w, black: b, ...rec }));
  const W = await connect(server.url, w);
  const B = await connect(server.url, b);
  const jw = await cmd(W.socket, "game:join", { ref: game.ref });
  const jb = await cmd(B.socket, "game:join", { ref: game.ref });
  return { game, W: W.socket, B: B.socket, jw, jb, session: () => server.handle.registry.get(game.ref)! };
}

export const OPERA_UCI = [
  "e2e4", "e7e5", "g1f3", "d7d6", "d2d4", "c8g4", "d4e5", "g4f3", "d1f3", "d6e5", "f1c4", "g8f6", "f3b3", "d8e7",
  "b1c3", "c7c6", "c1g5", "b7b5", "c3b5", "c6b5", "c4b5", "b8d7", "e1c1", "a8d8", "d1d7", "d8d7", "h1d1", "e7e6",
  "b5d7", "f6d7", "b3b8", "d7b8", "d1d8",
];

let moveCounter = 0;
export function moveId(): string {
  moveCounter += 1;
  return `m${moveCounter.toString(36)}`;
}

/** Plays `uci` for the side to move (absolute ply = plies played, startPly 0). */
export function move(socket: ClientSocket, gameRef: string, ply: number, uci: string, extra: Record<string, unknown> = {}) {
  return cmd(socket, "game:move", { ref: gameRef, ply, uci, clientMoveId: moveId(), ...extra });
}
