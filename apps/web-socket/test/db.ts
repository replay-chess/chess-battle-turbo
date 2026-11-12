/* eslint-disable @typescript-eslint/no-explicit-any -- rows are checked by assertions */
// Database harness of the socket integration suite (phase-02 plan 12.4): a real Postgres after
// `prisma migrate deploy` + packages/db/sql/roles.sql (CI service or a local Docker container), the production
// composition (src/boot.ts: outbox + journal + restore + HTTP) on a random port, users and live games inserted with
// @repo/db, and the socket's queries counted through Prisma's `query` event. Skipped unless TEST_DATABASE_URL is set;
// refuses any host but localhost (the tests write rows). TEST_REALTIME_DATABASE_URL (the replay_realtime role) is
// used for the server's own client when set, which proves the role's grants.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@repo/db";
import { createLiveGame } from "@repo/db/games";
import { bootServer, type BootedServer } from "../src/boot";
import type { Timing } from "../src/config/timing";
import { staticLoopLag } from "../src/obs/metrics";
import { SILENT_LOGGER, createMemoryMetrics, type TelemetryProps } from "../src/ports";
import type { Socket as ClientSocket } from "socket.io-client";
import { INITIAL_FEN, closeAllClients, cmd, connect, delay, move, ref, testEnv, testTiming, type User } from "./helpers";

export const TEST_URL = process.env.TEST_DATABASE_URL;
export const REALTIME_URL = process.env.TEST_REALTIME_DATABASE_URL ?? TEST_URL;
/** `describe(..., { skip: DB_SKIP })`. */
export const DB_SKIP: string | false = TEST_URL ? false : "TEST_DATABASE_URL not set";

export function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`refusing to run the socket integration tests against ${host}: use a local Postgres`);
  }
}

let admin: PrismaClient | null = null;
/** The owner connection (inserts fixtures, reads rows, terminates backends). */
export function adminDb(): PrismaClient {
  assertLocal(TEST_URL!);
  admin ??= new PrismaClient({ datasourceUrl: TEST_URL! });
  return admin;
}

export interface CountedDb {
  db: PrismaClient;
  queries(): number;
  appName: string;
}

let appN = 0;
/** The socket's client (replay_realtime when configured), tagged with an application_name, queries counted. */
export function socketDb(): CountedDb {
  assertLocal(REALTIME_URL!);
  appN++;
  const appName = `rc_ws_int_${process.pid}_${appN}`;
  const u = new URL(REALTIME_URL!);
  u.searchParams.set("application_name", appName);
  u.searchParams.set("connection_limit", "3");
  const db = new PrismaClient({ datasourceUrl: u.toString(), log: [{ emit: "event", level: "query" }] });
  let n = 0;
  db.$on("query", () => {
    n++;
  });
  return { db, queries: () => n, appName };
}

/** Inserts a user (and its legacy user_stats row). `ref` is cuid-shaped, as the token contract requires. */
export async function makeUser(label: string): Promise<User> {
  const db = adminDb();
  const userRef = ref();
  const name = `${label}_${userRef.slice(-5)}`.slice(0, 40);
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO users ("referenceId", code, "googleId", email, name, "updatedAt")
    VALUES (${userRef}, ${`code-${userRef}`}, ${`google-${userRef}`}, ${`${userRef}@test.invalid`}, ${name}, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO user_stats ("referenceId", "userId", "updatedAt") VALUES (${`s${userRef}`.slice(0, 30)}, ${id}, now())`);
  return { ref: userRef, id, name };
}

export interface GameOptions {
  startingFen?: string;
  initialTimeSeconds?: number;
  incrementSeconds?: number;
  mode?: "FRIEND" | "ONLINE";
}

/** A live friend game with both seats filled (IN_PROGRESS, phase WAITING), as the legacy writers create it. */
export async function makeGame(white: User, black: User, opts: GameOptions = {}): Promise<{ id: bigint; ref: string }> {
  const r = await createLiveGame(adminDb(), {
    mode: opts.mode ?? "FRIEND",
    creatorId: white.id,
    white: { userId: white.id, name: white.name, rating: 1500 },
    black: { userId: black.id, name: black.name, rating: 1400 },
    startingFen: opts.startingFen ?? INITIAL_FEN,
    initialTimeSeconds: opts.initialTimeSeconds ?? 300,
    incrementSeconds: opts.incrementSeconds ?? 0,
    status: "IN_PROGRESS",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { id: r.id, ref: r.ref };
}

export async function gameRow(id: bigint): Promise<any> {
  const rows = await adminDb().$queryRaw<any[]>(Prisma.sql`
    SELECT status::text AS status, phase::text AS phase, "endMethod"::text AS "endMethod", outcome::text AS outcome,
           result::text AS result, moves, "moveClocksMs", "plyCount", fen, pgn, meta, "whiteTimeMs", "blackTimeMs",
           "clockRunning", "rematchOfId", "whitePlayerId", "blackPlayerId", "lastMoveAt", "completedAt"
      FROM games WHERE id = ${id}`);
  return rows[0];
}

export async function gameByRef(ref: string): Promise<any> {
  const rows = await adminDb().$queryRaw<any[]>(Prisma.sql`
    SELECT id, status::text AS status, phase::text AS phase, "rematchOfId", "whitePlayerId", "blackPlayerId", "plyCount"
      FROM games WHERE "referenceId" = ${ref}`);
  return rows[0];
}

export async function userStats(userId: bigint): Promise<{ total: number; won: number; lost: number; drawn: number; version: number }> {
  const rows = await adminDb().$queryRaw<any[]>(Prisma.sql`
    SELECT s."totalGamesPlayed" AS total, s."gamesWon" AS won, s."gamesLost" AS lost, s."gamesDrawn" AS drawn,
           u."gamesVersion" AS version
      FROM users u JOIN user_stats s ON s."userId" = u.id WHERE u.id = ${userId}`);
  return rows[0];
}

export async function playerResults(gameId: bigint): Promise<Record<string, string | null>> {
  const rows = await adminDb().$queryRaw<{ color: string; result: string | null }[]>(Prisma.sql`
    SELECT color, result::text AS result FROM game_players WHERE "gameId" = ${gameId}`);
  return Object.fromEntries(rows.map((r) => [r.color, r.result]));
}

/** What Neon does on suspend: closes every connection of one client. */
export async function terminateBackends(appName: string): Promise<number> {
  const rows = await adminDb().$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
     WHERE application_name = ${appName} AND pid <> pg_backend_pid()`);
  return rows[0]!.n;
}

export class MemoryTelemetry {
  readonly events: { event: string; distinctId: string; props: TelemetryProps }[] = [];
  capture(event: string, distinctId: string, props: TelemetryProps): void {
    this.events.push({ event, distinctId, props });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export interface DbServer {
  url: string;
  booted: BootedServer;
  sql: CountedDb;
  metrics: ReturnType<typeof createMemoryMetrics>;
  telemetry: MemoryTelemetry;
  journalDir: string | null;
  /** Drain (SIGTERM path) and disconnect. */
  close(): Promise<void>;
}

export function newJournalDir(): string {
  return mkdtempSync(join(tmpdir(), "rc-ws-journal-"));
}

/** Boots the production composition on a random port and runs the boot restore. */
export async function startDbServer(
  opts: {
    timing?: Timing;
    env?: Record<string, string | undefined>;
    journalDir?: string | null;
    sql?: CountedDb;
    onEmitParse?: (event: string) => void;
    restore?: boolean;
    /** Narrows the boot restore to this window (1 = only this server's own journal files). */
    restoreWindowMs?: number;
    /** P3: captures the worker kicks (with ANALYSIS_WORKER_URL and a ws key in `env`). */
    kickFetch?: typeof fetch;
  } = {},
): Promise<DbServer> {
  const sql = opts.sql ?? socketDb();
  const metrics = createMemoryMetrics();
  const telemetry = new MemoryTelemetry();
  const journalDir = opts.journalDir === undefined ? newJournalDir() : opts.journalDir;
  const booted = await bootServer({
    env: testEnv(opts.env),
    db: sql.db,
    log: SILENT_LOGGER,
    metrics,
    telemetry,
    timing: opts.timing ?? testTiming({}, { checkpointMaxAgeMs: 300 }),
    journalDir,
    journal: { fsyncEveryMs: 20 },
    loopLag: staticLoopLag(0),
    drainTimeoutMs: 5_000,
    outbox: { backoffBaseMs: 100 },
    ...(opts.onEmitParse ? { onEmitParse: opts.onEmitParse } : {}),
    ...(opts.restoreWindowMs !== undefined ? { restoreWindowMs: opts.restoreWindowMs } : {}),
    ...(opts.kickFetch ? { kickFetch: opts.kickFetch } : {}),
  });
  const port = await booted.handle.listen(0, "127.0.0.1");
  if (opts.restore !== false) await booted.restore();
  return {
    url: `http://127.0.0.1:${port}`,
    booted,
    sql,
    metrics,
    telemetry,
    journalDir,
    close: async () => {
      closeAllClients();
      await booted.stop();
      await sql.db.$disconnect();
    },
  };
}

export async function disconnectAdmin(): Promise<void> {
  await admin?.$disconnect();
  admin = null;
}

/** Two members, a live game, both connected and joined (the game leaves `waiting`). */
export async function startDbGame(server: { url: string; booted: BootedServer }, opts: GameOptions = {}) {
  const w = await makeUser("w");
  const b = await makeUser("b");
  const game = await makeGame(w, b, opts);
  const W = await connect(server.url, w);
  const B = await connect(server.url, b);
  const jw = await cmd(W.socket, "game:join", { ref: game.ref });
  const jb = await cmd(B.socket, "game:join", { ref: game.ref });
  return { w, b, game, W: W.socket, B: B.socket, jw, jb, session: () => server.booted.handle.registry.get(game.ref)! };
}

/** Plays `ucis` alternately from `startPly` (absolute), ≤ 10 moves a second per socket. */
export async function playLine(W: ClientSocket, B: ClientSocket, gameRef: string, ucis: readonly string[], startPly = 0, whiteFirst = true) {
  const acks: any[] = [];
  for (let i = 0; i < ucis.length; i++) {
    const whiteMoves = (i % 2 === 0) === whiteFirst;
    if (i > 0) await delay(55);
    const ack = await move(whiteMoves ? W : B, gameRef, startPly + i, ucis[i]!);
    if (!ack.ok) throw new Error(`ply ${startPly + i + 1} ${ucis[i]}: ${JSON.stringify(ack)}`);
    acks.push(ack);
  }
  return acks;
}
