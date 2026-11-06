/**
 * Neon scale-to-zero (phase-02 plan 6.7, 12.4 `neon-suspend`; WP-A acceptance). Neon closes every client
 * connection when it suspends the compute; `pg_terminate_backend()` does the same thing to a local Postgres. Mid-game,
 * every connection of the "socket" client is terminated: the next checkpoint fails once with a transient error, the
 * pool is reset (`createPoolReset`), the statement is retried at once through `withTransientRetry`, succeeds, and is reported through `onTransient` (the socket counts it
 * as `ws.persist.reconnect`, not `ws.persist.fail`). The process stays up and the finish persists every ply.
 *
 * The socket-side copy (WS/test/neon-suspend.int.test.ts, WP-D) runs the same scenario through the outbox.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { INITIAL_FEN, createLiveGame } from "../src/games";
import {
  checkpointGame,
  createPoolReset,
  finishGame,
  isTransientDbError,
  loadLiveGame,
  withTransientRetry,
} from "../src/live";
import { OPERA_FINAL_FEN, OPERA_UCI, TEST_URL, assertLocalTestUrl, gameRow, makeUser, run } from "./helpers";

const APP = `rc_live_${run}`.slice(0, 60);

function withAppName(url: string, name: string): string {
  const u = new URL(url);
  u.searchParams.set("application_name", name);
  u.searchParams.set("connection_limit", "3");
  return u.toString();
}

describe("Neon suspend: transient reconnect (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let admin: PrismaClient;
  let socket: PrismaClient;
  let reset: () => Promise<void>;

  before(async () => {
    assertLocalTestUrl(TEST_URL!);
    admin = createPrismaClient({ datasourceUrl: TEST_URL });
    socket = createPrismaClient({ datasourceUrl: withAppName(TEST_URL!, APP) });
    reset = createPoolReset(socket, 0);
  });

  after(async () => {
    await socket.$disconnect();
    await admin.$disconnect();
  });

  /** What Neon does on suspend: close every connection of the socket client. */
  async function suspend(): Promise<number> {
    const rows = await admin.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
       WHERE application_name = ${APP} AND pid <> pg_backend_pid()`);
    return rows[0]!.n;
  }

  it("a checkpoint after the suspend fails once, is retried at once, and the finish keeps every ply", async () => {
    const w = await makeUser(admin, "nw");
    const b = await makeUser(admin, "nb");
    const g = await createLiveGame(socket, {
      mode: "FRIEND",
      creatorId: w.id,
      white: { userId: w.id, name: w.name },
      black: { userId: b.id, name: b.name },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 300,
      incrementSeconds: 0,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    assert.ok(await loadLiveGame(socket, g.ref));

    const plies = OPERA_UCI.split(" ");
    const cp = (n: number) =>
      checkpointGame(socket, {
        gameId: g.id,
        moves: plies.slice(0, n).join(" "),
        clocksMs: plies.slice(0, n).map((_, i) => 300_000 - i * 500),
        plyCount: n,
        fen: "x",
        whiteTimeMs: 290_000,
        blackTimeMs: 290_000,
        clockRunning: n % 2 === 0 ? "w" : "b",
        phase: "playing",
        phaseEndsAt: null,
        lastMoveAt: new Date(),
      });
    assert.equal((await cp(6)).applied, true);

    // Suspend mid-game (after ply 6).
    assert.ok((await suspend()) >= 1, "the socket client had an open connection");

    // The next statement fails once with a transient error; the pool is reset and the retry succeeds at once.
    const transients: unknown[] = [];
    const result = await withTransientRetry(() => cp(16), { onTransient: (e) => transients.push(e), reset });
    assert.equal(result.applied, true);
    assert.equal(transients.length, 1, "exactly one ws.persist.reconnect, no ws.persist.fail");
    assert.equal(isTransientDbError(transients[0]), true);

    // A second suspend right before the finish: the finish (one statement) is retried and stores all 33 plies.
    await suspend();
    const reconnects: unknown[] = [];
    const fin = await withTransientRetry(
      () =>
        finishGame(socket, {
          gameId: g.id,
          moves: OPERA_UCI,
          clocksMs: plies.map((_, i) => 300_000 - i * 500),
          plyCount: plies.length,
          fen: OPERA_FINAL_FEN,
          whiteTimeMs: 280_000,
          blackTimeMs: 279_000,
          method: "checkmate",
          winner: "w",
          pgn: "1. e4 … 17. Rd8# 1-0",
          endedAt: new Date(),
        }),
      { onTransient: (e) => reconnects.push(e), reset },
    );
    assert.equal(reconnects.length, 1);
    // If the first attempt committed before the connection dropped, the retry reports "already finished, same
    // end"; either way the game is finished exactly once.
    assert.ok(fin.finished || fin.conflict === false);
    const row = await gameRow(admin, g.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.plyCount, 33);
    assert.equal((row.moves as string).split(" ").length, 33);
    assert.equal((row.moveClocksMs as number[]).length, 33);
    const counted = await admin.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT "totalGamesPlayed" AS total FROM user_stats WHERE "userId" = ${w.id}`);
    assert.equal(counted[0]!.total, 1, "counted once");
  });

  it("the classification sees the real engine error of a terminated connection", async () => {
    await withTransientRetry(() => socket.$queryRaw(Prisma.sql`SELECT 1`), { reset });
    assert.ok((await suspend()) >= 1);
    let caught: unknown = null;
    try {
      await socket.$queryRaw(Prisma.sql`SELECT 1`);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "the first statement after a suspend fails");
    assert.equal(isTransientDbError(caught), true, String((caught as Error).message));
    // Without a reset the engine keeps answering P1017 for ≈ 15 s (measured, Prisma 6.17.1); with it, at once.
    await reset();
    await socket.$queryRaw(Prisma.sql`SELECT 1`);
  });
});
