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

  /**
   * The suspend lands on the socket client's connection while `op`'s statement is on it: an admin transaction holds
   * the game row, `op` starts and waits for the row, and the suspend closes its connection under it. Closing an idle
   * connection instead left it to the driver whether the next statement met the dead connection or a fresh one (CI
   * 43452098148: the finish after the second suspend went through with 0 reconnects where the test expects 1), so the
   * transient path this spec is about ran or not by timing. Returns `op`'s promise (already started).
   */
  async function suspendDuring<T>(gameId: bigint, op: () => Promise<T>): Promise<{ result: Promise<T>; terminated: number }> {
    let result!: Promise<T>;
    let terminated = 0;
    await admin.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM games WHERE id = ${gameId} FOR UPDATE`);
        result = op();
        result.catch(() => undefined);
        const until = Date.now() + 10_000;
        for (;;) {
          const [w] = await admin.$queryRaw<{ n: number }[]>(Prisma.sql`
            SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ${APP} AND wait_event_type = 'Lock'`);
          if (w!.n > 0) break;
          if (Date.now() > until) throw new Error("the socket client's statement never reached the game row");
          await new Promise((r) => setTimeout(r, 20));
        }
        terminated = await suspend();
      },
      { timeout: 20_000 },
    );
    return { result, terminated };
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

    // Suspend mid-game (after ply 6), under the next checkpoint: it fails once with a transient error; the pool is
    // reset and the retry succeeds at once.
    const transients: unknown[] = [];
    const first = await suspendDuring(g.id, () => withTransientRetry(() => cp(16), { onTransient: (e) => transients.push(e), reset }));
    assert.ok(first.terminated >= 1, "the socket client had an open connection");
    const result = await first.result;
    assert.equal(result.applied, true);
    assert.equal(transients.length, 1, "exactly one ws.persist.reconnect, no ws.persist.fail");
    assert.equal(isTransientDbError(transients[0]), true);

    // A second suspend under the finish: the finish (one statement) is retried and stores all 33 plies.
    const reconnects: unknown[] = [];
    const finish = () =>
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
      });
    const second = await suspendDuring(g.id, () => withTransientRetry(finish, { onTransient: (e) => reconnects.push(e), reset }));
    assert.ok(second.terminated >= 1, "the finish's connection was closed under it");
    const fin = await second.result;
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
