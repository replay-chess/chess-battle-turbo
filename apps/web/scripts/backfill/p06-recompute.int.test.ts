/**
 * B-W3 enqueue-weakness-recompute (phase-06 plan 6.6, 7.4.1) on a real Postgres after `prisma migrate deploy`, with
 * the rows of real games: rated CC0 Lichess games (real moves, clocks and Lichess engine evals) between members,
 * graded by the worker's grader and written with every row the worker writes (the P3 seed writer). Member A has 8
 * analysed games and no snapshot, member B 8 and a snapshot of the current algorithm written from the engine's own
 * FAILED document, member C 3 (under the threshold) and member D 8 with a snapshot of an older algorithm.
 * Checks: the dry count; the apply arms the one RECOMPUTE_WEAKNESS row per member through the shared §7.4.1 upsert
 * (trigger algo, priority HOUSEKEEPING, runAt inside the 30-minute spread, QUEUED, three attempts); a second apply arms
 * nothing (the pending rows); --verify counts the members still without a current snapshot; the audit row.
 * Isolation: `jobs` and `audit_logs` are copied into a private schema and the runs happen in a transaction with
 * `SET LOCAL search_path = <schema>, public`; the members are this file's own users. Skipped unless TEST_DATABASE_URL
 * is set (a local Docker Postgres or the CI service; never Neon).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@repo/db";
import { buildWeaknessMetrics } from "@repo/db/json";
import { buildFixture, type SeedMember } from "@repo/db/seed/builders";
import { writeFixtures } from "@repo/db/seed/writer";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { cc0Game, cc0TimedIndexes } from "@repo/chess-analysis/fixtures/weakness-inputs";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, weaknessDedupeKey } from "@repo/contracts/internal/jobs";
import { loadBaseline } from "@repo/chess-training/baselines/load";
import { failedMetrics } from "@repo/chess-training/weakness/compute";
import { ALGO_VERSION } from "@repo/chess-training/weakness/constants";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { BackfillDb } from "./p04-common";
import { SPREAD_SEC, countRecomputeCandidates, countStillMissing, runEnqueueRecompute } from "./enqueue-weakness-recompute";
import { recordP6Backfill } from "./p06-common";

const url = process.env.TEST_DATABASE_URL;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const SCHEMA = `p06rc_${RUN}`;
const NOW = new Date("2026-11-17T19:00:00.000Z");
const DAY = 86_400_000;

describe("B-W3 enqueue-weakness-recompute (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  let prisma: PrismaClient;
  const users: bigint[] = [];
  const m: Record<"a" | "b" | "c" | "d" | "o", SeedMember> = {} as never;

  const q = <T = Record<string, unknown>>(sql: Prisma.Sql) => prisma.$queryRaw<T[]>(sql);
  const scoped = <T>(fn: (tx: BackfillDb) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path = ${SCHEMA}, public`);
      return fn(tx as unknown as BackfillDb);
    });

  async function member(label: string): Promise<SeedMember> {
    const n = users.length + 1;
    const ref = `cp6rc${RUN}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0");
    const [r] = await q<{ id: bigint }>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "updatedAt")
      VALUES (${ref}, ${`code-${RUN}-${n}`}, ${`g-${RUN}-${n}`}, ${`${label}-${RUN}@test.invalid`}, ${`${label}_${n}`}, 'Asia/Kolkata', now())
      RETURNING id`);
    users.push(r!.id);
    return { id: r!.id, ref, name: `${label}_${n}`, rating: 1400 };
  }

  async function snapshot(userId: bigint, algoVersion: number): Promise<void> {
    const scope = resolveScope(null);
    // The engine's own FAILED document, validated by the column's writer, as the worker would store it.
    const metrics = buildWeaknessMetrics(
      JSON.parse(
        JSON.stringify(
          failedMetrics({ code: "inputs_corrupt", at: NOW, scope, since: scopeSince(NOW, "Asia/Kolkata", scope.months), inScope: 8, analysed: 8, baseline: loadBaseline() }),
        ),
      ),
    );
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO weakness_snapshots ("userId", "weekStart", "algoVersion", status, "timeClasses", since, "gamesInScope", "gamesAnalysed", metrics)
      VALUES (${userId}, DATE '2026-11-16', ${algoVersion}::smallint, 'FAILED', ARRAY['RAPID','BLITZ']::"TimeClass"[], ${NOW}, 8, 8, ${JSON.stringify(metrics)}::jsonb)`);
  }

  before(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    for (const t of ["jobs", "audit_logs"]) await prisma.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}.${t} (LIKE public.${t} INCLUDING ALL)`);
    for (const k of ["a", "b", "c", "d", "o"] as const) m[k] = await member(`rc-${k}`);
    const plan: [SeedMember, number][] = [[m.a, 8], [m.b, 8], [m.c, 3], [m.d, 8]];
    const timed = cc0TimedIndexes();
    const fixtures = [];
    let next = 0;
    for (const [who, count] of plan) {
      for (let k = 0; k < count; k++) {
        const i = timed[next++ % timed.length]!;
        const g = cc0Game(i);
        const outcome = g.winner === "white" ? "WHITE" : g.winner === "black" ? "BLACK" : "DRAW";
        const res = (side: "w" | "b") => (outcome === "DRAW" ? "draw" : (outcome === "WHITE") === (side === "w") ? "win" : "loss");
        const f = buildFixture({
          key: `p6rc-${who.ref}-${i}`,
          scope: RUN,
          member: who,
          memberColor: k % 2 === 0 ? "w" : "b",
          // A member game against `o`, whose sides are outside the scripts' member scope.
          opponent: { kind: "member", member: m.o },
          mode: "ONLINE",
          startFen: INITIAL_FEN,
          moves: g.input.moves,
          tc: { initialSeconds: g.initialTimeSeconds, incrementSeconds: g.incrementSeconds },
          outcome,
          method: "RESIGNATION",
          completedAt: new Date(NOW.getTime() - (next + 1) * DAY),
          analysis: {
            kind: "done",
            input: { ...g.input, members: [{ side: "w", result: res("w") }, { side: "b", result: res("b") }] },
            provenance: "lichess-oracle",
            reason: "live_end",
            priority: JOB_PRIORITY.GAME_ENDED,
          },
          tag: "p6-recompute",
        });
        f.game.moveClocksMs = g.moveClocksMs;
        fixtures.push(f);
      }
    }
    await writeFixtures(prisma, fixtures);
    await snapshot(m.b.id, ALGO_VERSION);
    await snapshot(m.d.id, ALGO_VERSION - 1);
  });

  after(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    if (users.length) {
      const ids = users.map(String);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "userId" = ANY(${ids}::bigint[])`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM games WHERE "creatorId" = ANY(${ids}::bigint[])`);
      await prisma.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ANY(${ids}::bigint[])`);
    }
    await prisma.$disconnect();
  });

  it("arms one row per member who needs a build, through the shared upsert, and never twice", async () => {
    const scope = { userIds: [m.a.id, m.b.id, m.c.id, m.d.id] };
    assert.equal(await scoped((tx) => countRecomputeCandidates(tx, scope)), 2, "A (no snapshot) and D (an older algorithm)");
    assert.equal(await scoped((tx) => countStillMissing(tx, scope)), 2);

    const r = await scoped((tx) => runEnqueueRecompute(tx, { ...scope, now: NOW, limit: 1 }));
    assert.deepEqual([r.armed, r.batches], [2, 2]);
    const jobs = await q<{ kind: string; dedupeKey: string; userId: bigint; priority: number; status: string; maxAttempts: number; payload: { v: number; trigger: string }; runAt: Date }>(
      Prisma.sql`SELECT kind::text AS kind, "dedupeKey", "userId", priority, status::text AS status, "maxAttempts", payload, "runAt"
                   FROM ${Prisma.raw(SCHEMA)}.jobs ORDER BY "userId"`,
    );
    assert.deepEqual(jobs.map((j) => j.userId), [m.a.id, m.d.id]);
    for (const j of jobs) {
      assert.equal(j.kind, "RECOMPUTE_WEAKNESS");
      assert.equal(j.dedupeKey, weaknessDedupeKey(j.userId));
      assert.equal(j.priority, JOB_PRIORITY.HOUSEKEEPING);
      assert.equal(j.status, "QUEUED");
      assert.equal(j.maxAttempts, JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS);
      assert.equal(j.payload.v, 1);
      assert.equal(j.payload.trigger, "algo");
      const offset = j.runAt.getTime() - NOW.getTime();
      assert.ok(offset >= 0 && offset < SPREAD_SEC * 1000, `runAt ${j.runAt.toISOString()}`);
    }

    const again = await scoped((tx) => runEnqueueRecompute(tx, { ...scope, now: NOW }));
    assert.equal(again.armed, 0, "a pending row is not armed again");
    assert.equal(await scoped((tx) => countRecomputeCandidates(tx, scope)), 0);

    // The worker built A's and D's snapshots (simulated by the row it writes): --verify finds nobody left.
    await snapshot(m.a.id, ALGO_VERSION);
    await prisma.$executeRaw(Prisma.sql`UPDATE weakness_snapshots SET "algoVersion" = ${ALGO_VERSION}::smallint WHERE "userId" = ${m.d.id}`);
    assert.equal(await scoped((tx) => countStillMissing(tx, scope)), 0);

    await scoped((tx) => recordP6Backfill(tx, "weakness_recompute", { armed: r.armed, batches: r.batches }));
    const audits = await q<{ action: string }>(Prisma.sql`SELECT action FROM ${Prisma.raw(SCHEMA)}.audit_logs`);
    assert.deepEqual(audits.map((x) => x.action), ["backfill.weakness_recompute"]);
  });
});
