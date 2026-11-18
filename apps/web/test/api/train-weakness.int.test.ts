/**
 * P6 Weakness Profile routes on a real Postgres (phase-06 plan §12.2): TR-5 `GET /api/train/weakness`, TR-12
 * `POST …/recompute`, TR-13 `POST …/seen` and TR-7's `weakness` drill, through route() with the injected auth seam.
 *
 * The data went through the product's pipelines (weakness-world.ts): real CC0 Lichess games and the oracle games, graded
 * and written as the worker writes them, B-W1's per-game inputs, the A6 bank extraction and B-W2's time-pressure tag,
 * and snapshots computed by the real `computeWeakness()` over the Q-W5 rows read back from Postgres. Members:
 *   A  (Asia/Kolkata, R1200_1600)  92 games vs B, banked, READY snapshot           ready / drill / seen / ETag
 *   B  (America/New_York)          the same games (the other side), no snapshot     IDOR, orphaned
 *   O  (UTC)                       22 analysed blitz games, no snapshot, no job      orphaned → auto-build
 *   F  (Europe/London)             22 analysed games, the recompute FAILED (3/3)     failed → Retry
 *   C  (UTC)                       12 analysed + 13 unanalysed, 13 ANALYZE_GAME jobs computing (grade step)
 *   Z  (UTC)                       nothing                                           insufficient, empty drill, scope
 * The puzzle fill uses the CI shard server (`e2e/mocks/puzzle-shards`, the real shard files). The worker kick goes to a
 * recording transport (no worker runs here). Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Chess } from "chess.js";
import { Prisma } from "@repo/db";
import { analyzeDedupeKey, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueJobSql } from "@repo/db/jobs";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { RecomputeResponse, WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessPayload } from "@repo/contracts/http/weakness";
import { AttemptsResult, SessionPayload, type AttemptIn } from "@repo/contracts/http/train";
import { isWeaknessCandidate, lichessMatch, TIME_PRESSURE_THEME, weaknessLabel } from "@repo/chess-training/themes";
import { createRequestStore, runWithRequestStore } from "@/lib/api/timing";
import { removeBankCard } from "@/lib/train/cards.server";
import { getSessionSummary } from "@/lib/train/sessions.server";
import { readWeakness } from "@/lib/train/weakness.server";
import { requestRecompute } from "@/lib/train/weakness-write.server";
import { SHARD_FIXTURES_DIR, startPuzzleShardServer } from "../../e2e/mocks/puzzle-shards";
import { count, lapsed, weaknessWorld, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const MIN = 60_000;
const DAY = 86_400_000;
const later = (ms: number) => new Date(WORLD_NOW.getTime() + ms);

describe("P6 weakness routes (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let shards: Awaited<ReturnType<typeof startPuzzleShardServer>>;
  let shardEnv: Record<string, string>;
  let A: Member, B: Member, O: Member, F: Member, C: Member, Z: Member, P: Member;

  const get = (m: Member | null, init: Parameters<typeof w.call>[4] = {}) => w.call("weakness", "GET", "/api/train/weakness", m, init);
  const recompute = (m: Member, body: unknown, init: Parameters<typeof w.call>[4] = {}) =>
    w.call("recompute", "POST", "/api/train/weakness/recompute", m, { body, ...init });
  const seen = (m: Member, body: unknown, init: Parameters<typeof w.call>[4] = {}) => w.call("seen", "POST", "/api/train/weakness/seen", m, { body, ...init });
  const drill = (m: Member, body: unknown, init: { key?: string; now?: Date } = {}) =>
    w.call("sessions", "POST", "/api/train/sessions", m, { body, headers: { "Idempotency-Key": init.key ?? w.uuid() }, now: init.now, env: shardEnv });
  async function payloadOf(m: Member, now = WORLD_NOW) {
    const r = await get(m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return { p: ok(WeaknessPayload).parse(await r.json()).data, res: r.res, recorded: r.recorded };
  }
  const job = async (m: Member) =>
    (
      await w.db.$queryRaw<{ status: string; attempts: number; priority: number; payload: Record<string, unknown>; runAt: Date; lastKickAt: Date | null; lastError: string | null }[]>(
        Prisma.sql`SELECT status::text AS status, attempts, priority, payload, "runAt", "lastKickAt", "lastError" FROM jobs WHERE "dedupeKey" = ${`weakness:${m.id}`}`,
      )
    )[0];
  const profile = async (m: Member) =>
    (
      await w.db.$queryRaw<{ v: number; seen: number; tc: string[]; months: number; puzzleRating: number }[]>(Prisma.sql`
        SELECT "weaknessVersion" AS v, "lastWeaknessSeenVersion" AS seen, "weaknessTimeClasses"::text[] AS tc, "weaknessMonths" AS months, "puzzleRating"
          FROM training_profiles WHERE "userId" = ${m.id}`)
    )[0];

  before(async () => {
    await w.setup();
    shards = await startPuzzleShardServer({ port: 0, dir: SHARD_FIXTURES_DIR });
    shardEnv = { PUZZLE_SHARD_BASE_URL: shards.baseUrl, PUZZLES_VERSION: "v1" };

    A = await w.member("weak-a", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    B = await w.member("weak-b", { timeZone: "America/New_York", rating: 1410 });
    await w.playCc0(A, B, { count: 62 });
    await w.playOracles(A, B, { count: 30 });

    O = await w.member("weak-o");
    const oOpp = await w.member("weak-o-opp");
    await w.playCc0(O, oOpp, { count: 22, timeClasses: ["BLITZ"], spacingDays: 3 });

    F = await w.member("weak-f", { timeZone: "Europe/London" });
    const fOpp = await w.member("weak-f-opp");
    await w.playCc0(F, fOpp, { count: 22, timeClasses: ["BLITZ"], from: 5, spacingDays: 2 });

    // P (FIX-1): 8 analysed games whose last recompute the worker's kill switch skipped (WEAKNESS_JOBS_ENABLED off).
    P = await w.member("weak-p");
    const pOpp = await w.member("weak-p-opp");
    await w.playCc0(P, pOpp, { count: 8, timeClasses: ["BLITZ"], from: 40, spacingDays: 2 });

    C = await w.member("weak-c");
    const cOpp = await w.member("weak-c-opp");
    await w.playCc0(C, cOpp, { count: 12, timeClasses: ["BLITZ"], from: 20, spacingDays: 1.5, newestDaysAgo: 30 });
    const pending = await w.playCc0(C, cOpp, { count: 13, timeClasses: ["BLITZ"], from: 32, spacingDays: 0.5, newestDaysAgo: 1, analysed: false });
    for (const ref of pending) {
      const [g] = await w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM games WHERE "referenceId" = ${ref}`);
      // The P4 import fan-out's statement (the product's enqueue, its payload validated).
      await w.db.$queryRaw(
        enqueueJobSql({
          kind: "ANALYZE_GAME",
          priority: JOB_PRIORITY.BACKLOG,
          dedupeKey: analyzeDedupeKey(g!.id),
          userId: C.id,
          gameId: g!.id,
          payload: { v: 1, gameId: String(g!.id), gameRef: ref, reason: "import" },
          runAt: later(-20 * MIN),
        }),
      );
    }
    Z = await w.member("weak-z");

    const inputs = await w.computeInputs([A, B, O, F, C]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    const analysedSides = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM game_players WHERE accuracy IS NOT NULL
      AND "userId" = ANY(${[A, B, O, F, C].map((m) => String(m.id))}::bigint[])`);
    assert.ok(analysedSides >= 200, `${analysedSides} analysed sides`);
    assert.equal(inputs.written, analysedSides, "B-W1 wrote every analysed side");
    const banked = await w.bank(A);
    assert.ok(banked >= 40, `${banked} of A's moments banked`);
    const built = await w.recompute(A);
    assert.equal(built.draft.status, "READY", "A's real games make a READY profile");
    assert.ok(built.draft.metrics.rows.length >= 1);
    assert.equal(built.bumped, true);
    assert.equal(built.version, 1);
    await w.failRecompute(F, later(-2 * DAY));
  });

  after(async () => {
    await shards?.close();
    await w.teardown();
  });

  // ── TR-5 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("TR-5 GET /api/train/weakness", () => {
    it("signed out → 401; a lapsed member → 402 subscription_required with details.reason; flag off → 404", async () => {
      const out = await get(A, { signedOut: true });
      assert.equal(out.res.status, 401);
      const lapsedRes = await get(A, { viewer: lapsed(w, A) });
      assert.equal(lapsedRes.res.status, 402);
      const err = ErrorEnvelope.parse(await lapsedRes.json()).error;
      assert.equal(err.code, "subscription_required");
      assert.ok(["trial_available", "trial_used", "expired", "payment_failed", "paused"].includes(String(err.details?.reason)), JSON.stringify(err.details));
      w.flags(false);
      try {
        const off = await get(A);
        assert.equal(off.res.status, 404);
        assert.equal(ErrorEnvelope.parse(await off.json()).error.code, "not_found");
      } finally {
        w.flags(true);
      }
    });

    it("a READY member: 200 that parses, private no-cache, a strong wk1 ETag, < 8 KB, live inBank from the bank, own examples", async () => {
      const r = await get(A);
      assert.equal(r.res.status, 200, await r.res.clone().text());
      assert.equal(r.res.headers.get("cache-control"), "private, no-cache");
      const etag = r.res.headers.get("etag")!;
      assert.match(etag, /^"wk1:\d{4}-\d{2}-\d{2}\.[0-9a-z]+:1:[0-9a-f]{16}:0:0"$/);
      const text = await r.res.clone().text();
      assert.ok(Buffer.byteLength(text, "utf8") < WEAKNESS_PAYLOAD_MAX_BYTES, `${Buffer.byteLength(text)} B`);
      const p = ok(WeaknessPayload).parse(JSON.parse(text)).data;
      assert.equal(p.status, "ready");
      assert.equal(p.version, 1);
      assert.equal(p.seenVersion, 0);
      assert.equal(p.progress, null);
      assert.equal(p.updating, null);
      assert.ok(p.top.length >= 1 && p.top.length <= 3);
      assert.ok(p.headline?.verified);
      assert.match(p.scopeLabel, /^\d+ games · rapid and blitz · since \w{3} 2026$/);
      // inBank: the live count of A's visible BANK cards whose mistake carries the pattern (Q-W2), re-counted here.
      for (const row of [...p.top, ...p.more]) {
        const n = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
          WHERE c."userId" = ${A.id} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL AND ${row.pattern} = ANY(m.themes)`);
        assert.equal(row.inBank, n, row.pattern);
        assert.equal(row.matchable, row.pattern !== TIME_PRESSURE_THEME && lichessMatch(row.pattern) !== null, row.pattern);
        if (row.example) {
          const owner = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE "referenceId" = ${row.example.mistakeRef} AND "userId" = ${A.id}`);
          assert.equal(owner, 1, "examples are the viewer's own mistakes");
        }
      }
      assert.ok(p.weekPlan.length >= 1 && p.weekPlan[0]!.href === `/train/weakness/${p.top[0]!.slug}`);
      assert.ok(p.weekPlan.every((x) => x.kind !== "lesson"), "no lessons before P8");
    });

    it("If-None-Match with the current tag → 304, no body, the same ETag", async () => {
      const first = await get(A);
      const etag = first.res.headers.get("etag")!;
      const again = await get(A, { headers: { "if-none-match": etag } });
      assert.equal(again.res.status, 304);
      assert.equal(await again.res.text(), "");
      assert.equal(again.res.headers.get("etag"), etag);
      const stale = await get(A, { headers: { "if-none-match": '"wk1:none:1:0000000000000000:0:0"' } });
      assert.equal(stale.res.status, 200);
    });

    it("the ETag moves when the bank changes (inBank), after TR-13 (seenVersion) and after a snapshot write", async () => {
      const { p: p0, res: r0 } = await payloadOf(A);
      const tag0 = r0.headers.get("etag")!;
      // The bank: W6 removes a card whose mistake carries the top pattern (the product's removal path).
      const row = [...p0.top, ...p0.more].find((r) => r.inBank > 0);
      assert.ok(row, "a row with cards in the bank");
      const [mk] = await w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT m.id FROM mistakes m JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
         WHERE m."userId" = ${A.id} AND m."hiddenAt" IS NULL AND ${row.pattern} = ANY(m.themes) ORDER BY m.id DESC LIMIT 1`);
      assert.ok(await removeBankCard(w.db, A.id, { mistakeId: mk!.id }, WORLD_NOW));
      // regression: weakness-hidden-example (FIX-1): the removal re-arms A's recompute (`removed`, now), so a profile
      // whose example was this mistake moves to a visible one.
      const [job] = await w.db.$queryRaw<{ status: string; trigger: string }[]>(Prisma.sql`
        SELECT status::text AS status, payload->>'trigger' AS trigger FROM jobs WHERE "dedupeKey" = ${`weakness:${A.id}`}`);
      assert.deepEqual(job, { status: "QUEUED", trigger: "removed" });
      const { p: p1, res: r1 } = await payloadOf(A);
      assert.equal([...p1.top, ...p1.more].find((r) => r.pattern === row.pattern)!.inBank, row.inBank - 1);
      const tag1 = r1.headers.get("etag")!;
      assert.notEqual(tag1, tag0);
      assert.equal((await get(A, { headers: { "if-none-match": tag0 } })).res.status, 200, "the old tag no longer matches");

      // TR-13: seenVersion 0 → 1.
      assert.equal((await seen(A, { version: 1 })).res.status, 204);
      const { p: p2, res: r2 } = await payloadOf(A);
      assert.equal(p2.seenVersion, 1);
      const tag2 = r2.headers.get("etag")!;
      assert.notEqual(tag2, tag1);

      // A snapshot write (the next day's recompute: same week, new computedAt → a new snapshotKey).
      await w.recompute(A, later(DAY));
      const { p: p3, res: r3 } = await payloadOf(A, later(DAY));
      assert.notEqual(p3.snapshotKey, p2.snapshotKey);
      assert.notEqual(r3.headers.get("etag"), tag2);
      assert.equal((await get(A, { now: later(DAY), headers: { "if-none-match": tag2 } })).res.status, 200);
    });

    it("never another member's data: B reads B's own state (no snapshot), with B's games only", async () => {
      const { p } = await payloadOf(B);
      assert.equal(p.snapshotKey, null);
      assert.equal(p.top.length, 0);
      assert.equal(p.version, 0);
      const analysed = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM game_players WHERE "userId" = ${B.id} AND accuracy IS NOT NULL
        AND "timeClass" IN ('RAPID', 'BLITZ') AND "endedAt" >= '2026-05-01'`);
      assert.ok(p.games.analysed <= analysed && p.games.analysed > 0);
      assert.ok(p.status === "computing" && p.progress?.orphaned === true, `${p.status} ${JSON.stringify(p.progress)}`);
    });

    it("the GET performs no write: the handler's statements are all reads, at most 2 round trips (7 statements)", async () => {
      const store = createRequestStore();
      const read = await runWithRequestStore(store, () => readWeakness(w.viewerOf(C), WORLD_NOW));
      assert.equal(store.writes, 0, store.writeOps.join(","));
      assert.ok(store.dbStatements <= 7, `${store.dbStatements} statements`);
      assert.equal(read.payload.status, "computing");
      // A READY member without pending work: step 1 only (4 statements). (The worker ran the recompute the bank-card
      // removal above armed.)
      await w.db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'DONE', "finishedAt" = (now() AT TIME ZONE 'UTC') WHERE "dedupeKey" = ${`weakness:${A.id}`} AND status = 'QUEUED'`);
      const readyStore = createRequestStore();
      await runWithRequestStore(readyStore, () => readWeakness(w.viewerOf(A), later(DAY)));
      assert.equal(readyStore.writes, 0);
      assert.equal(readyStore.dbStatements, 4);
    });

    it("computing (grade step): 12 of 25 analysed, 13 analyses queued; progress, target and the stalled flag from Q-W3b", async () => {
      const { p } = await payloadOf(C);
      assert.equal(p.status, "computing");
      assert.equal(p.games.inScope, 25);
      assert.equal(p.games.analysed, 12);
      assert.ok(p.progress);
      assert.equal(p.progress.analysed, 12);
      assert.equal(p.progress.target, 25);
      // Nothing would build the profile once the analyses finish below 20 (no snapshot, no recompute job): the page's
      // auto-build writes the INSUFFICIENT row with the preliminary patterns (§8.13 `orphaned`).
      assert.equal(p.progress.orphaned, true);
      assert.equal(p.progress.steps[1]!.key, "grade");
      assert.equal(p.progress.steps[1]!.state, "run");
      assert.equal(p.progress.steps[1]!.pct, 60);
      // The newest analysis finished more than 10 minutes ago while analyses are queued: stalled.
      const [last] = await w.db.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT max(ga."completedAt") AS t FROM game_players gp
        JOIN game_analyses ga ON ga."gameId" = gp."gameId" WHERE gp."userId" = ${C.id}`);
      assert.equal(p.progress.stalled, WORLD_NOW.getTime() - last!.t.getTime() > 10 * MIN);
      assert.match(p.scopeLabel, /^Rapid and blitz · since \w{3} 2026$/);
    });

    it("insufficient with nothing: 0 of 20, no progress, no offer", async () => {
      const { p } = await payloadOf(Z);
      assert.equal(p.status, "insufficient");
      assert.deepEqual(p.games, { analysed: 0, inScope: 0, pending: 1, required: 20, preliminaryFrom: 5 });
      assert.equal(p.progress, null);
      assert.equal(p.offers.includeBullet, null);
    });

    it("failed: the FAILED snapshot and the exhausted job, retryable", async () => {
      const { p } = await payloadOf(F);
      assert.equal(p.status, "failed");
      assert.deepEqual(p.failure, { code: "compute_error", retryable: true });
      assert.equal(p.progress, null);
    });

    it("regression: weakness-killswitch-loop — a build the kill switch skipped: failed 'updates paused', not retryable, never orphaned", async () => {
      const before = (await payloadOf(P)).p;
      assert.equal(before.progress?.orphaned, true, "8 analysed, no snapshot, no job: the page would auto-build");
      // The page's auto-build (TR-12), then the worker's skip with the kill switch on (its final batch: DONE, result
      // {skipped: "disabled"}; WK killswitch.int.test.ts proves the worker writes exactly that).
      assert.equal((await recompute(P, {})).res.status, 202);
      await w.db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'DONE', "finishedAt" = (now() AT TIME ZONE 'UTC'), "lockedBy" = NULL,
        result = '{"v":1,"skipped":"disabled"}'::jsonb WHERE "dedupeKey" = ${`weakness:${P.id}`}`);
      const { p } = await payloadOf(P);
      assert.equal(p.status, "failed");
      assert.deepEqual(p.failure, { code: "updates_paused", retryable: false });
      assert.equal(p.progress?.orphaned ?? false, false, "no auto-build loop");
    });

    it("orphaned (22 analysed, no snapshot, no job) → the page's auto-build POST arms the job; a stale QUEUED job is kicked once per 30 s", async () => {
      const { p } = await payloadOf(O);
      assert.equal(p.status, "computing");
      assert.equal(p.games.analysed, 22);
      assert.equal(p.progress?.orphaned, true);
      assert.equal(await job(O), undefined, "the GET enqueued nothing");

      const auto = await recompute(O, {});
      assert.equal(auto.res.status, 202, await auto.res.clone().text());
      const jobRow = (await job(O))!;
      assert.equal(jobRow.status, "QUEUED");
      assert.equal(jobRow.priority, JOB_PRIORITY.USER_OPENED);
      assert.equal(jobRow.payload.trigger, "user");
      assert.equal(jobRow.payload.userAt, WORLD_NOW.toISOString());
      const kicksBefore = w.kicks.length;
      await w.runAfter(auto.recorded);
      assert.equal(w.kicks.length, kicksBefore + 1, "TR-12 kicks after the response");
      assert.deepEqual(w.kicks.at(-1), { v: 1, reason: "weakness", kinds: ["RECOMPUTE_WEAKNESS"], runAt: WORLD_NOW.toISOString() });

      // No longer orphaned: the job is queued.
      const { p: q, recorded } = await payloadOf(O, later(10_000));
      assert.equal(q.progress?.orphaned, false);
      // Not overdue yet (runAt + 30 s): no kick.
      await w.runAfter(recorded, later(10_000));
      assert.equal((await job(O))!.lastKickAt, null);

      // 60 s later the job is still QUEUED (no worker): the first GET wins the CAS and kicks, a second within 30 s does not.
      const g1 = await get(O, { now: later(MIN) });
      assert.equal(g1.res.status, 200);
      assert.equal((await job(O))!.lastKickAt, null, "the CAS runs after the response, never in the handler");
      const k0 = w.kicks.length;
      await w.runAfter(g1.recorded, later(MIN));
      const g2 = await get(O, { now: later(MIN + 15_000) });
      await w.runAfter(g2.recorded, later(MIN + 15_000));
      assert.equal(w.kicks.length, k0 + 1, "exactly one kick for two GETs within 30 s");
      assert.ok((await job(O))!.lastKickAt);
      const g3 = await get(O, { now: later(2 * MIN) });
      await w.runAfter(g3.recorded, later(2 * MIN));
      assert.equal(w.kicks.length, k0 + 2, "30 s later the next GET may kick again");
    });
  });

  // ── TR-12 ────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("TR-12 POST /api/train/weakness/recompute", () => {
    it("the durable limit: 429 inside 600 s with Retry-After, still 429 after TRUNCATE rate_limit_buckets, 202 again after 601 s (x-rc-now)", async () => {
      // O asked at WORLD_NOW (the auto-build above).
      const again = await recompute(O, {}, { now: later(4 * MIN), realRateLimit: true });
      assert.equal(again.res.status, 429);
      const err = ErrorEnvelope.parse(await again.json()).error;
      assert.equal(err.code, "rate_limited");
      assert.equal(err.retryAfterSec, 360);
      assert.equal(again.res.headers.get("retry-after"), "360");
      // A Neon scale-to-zero empties the UNLOGGED burst table; the limit is read from the job row, so it holds.
      await w.db.$executeRawUnsafe("TRUNCATE rate_limit_buckets");
      const afterSuspend = await recompute(O, {}, { now: later(9 * MIN), realRateLimit: true });
      assert.equal(afterSuspend.res.status, 429);
      const sec = ErrorEnvelope.parse(await afterSuspend.json()).error.retryAfterSec!;
      assert.ok(sec >= 1 && sec <= 600 && sec === 60, String(sec));
      // x-rc-now (test hooks + the e2e token) moves ctx.now past the window.
      const token = "p6-e2e-token";
      const ms = later(601_000).getTime();
      const moved = await recompute(O, {}, { headers: { "x-rc-now": String(ms), "x-e2e-token": token }, env: { E2E_TEST_TOKEN: token } });
      assert.equal(moved.res.status, 202, await moved.res.clone().text());
      const body = ok(RecomputeResponse).parse(await moved.json()).data;
      assert.deepEqual(body, { status: "computing", queuedAt: new Date(ms).toISOString(), scopeChanged: false });
      assert.equal((await job(O))!.payload.userAt, new Date(ms).toISOString());
    });

    it("validation: DAILY, duplicates, months 4 → 400 with fields; a body over 1 KB → 413", async () => {
      for (const body of [{ timeClasses: ["DAILY"] }, { timeClasses: ["BLITZ", "BLITZ"] }, { months: 4 }, { timeClasses: [] }, { scope: "x" }]) {
        const r = await recompute(Z, body, { now: later(DAY) });
        assert.equal(r.res.status, 400, JSON.stringify(body));
        const e = ErrorEnvelope.parse(await r.json()).error;
        assert.equal(e.code, "validation_failed");
        assert.ok(e.fields && Object.keys(e.fields).length > 0, JSON.stringify(e));
      }
      const big = await recompute(Z, null, { rawBody: JSON.stringify({ timeClasses: ["BLITZ"], pad: "x".repeat(1100) }), now: later(DAY) });
      assert.equal(big.res.status, 413);
      assert.equal(await job(Z), undefined, "nothing was enqueued");
    });

    it("a scope change creates the profile (with P5's rating seed) and is stored; a 429 leaves the scope as it was", async () => {
      assert.equal(await profile(Z), undefined);
      const r = await recompute(Z, { timeClasses: ["BULLET", "BLITZ", "RAPID"] }, { now: later(DAY) });
      assert.equal(r.res.status, 202, await r.res.clone().text());
      assert.equal(ok(RecomputeResponse).parse(await r.json()).data.scopeChanged, true);
      const p = (await profile(Z))!;
      assert.deepEqual(p.tc, ["RAPID", "BLITZ", "BULLET"]);
      assert.equal(Number(p.months), 6);
      assert.equal(Number(p.puzzleRating), 1500, "a member without linked ratings keeps the default seed");
      assert.equal((await job(Z))!.payload.trigger, "scope");
      // Inside the window: 429, and the scope stays.
      const refused = await recompute(Z, { months: 12 }, { now: later(DAY + MIN) });
      assert.equal(refused.res.status, 429);
      assert.equal(Number((await profile(Z))!.months), 6);
      // The same scope again (after the window) is not a change.
      const same = await recompute(Z, { timeClasses: ["RAPID", "BULLET", "BLITZ"], months: 6 }, { now: later(DAY + 11 * MIN) });
      assert.equal(ok(RecomputeResponse).parse(await same.json()).data.scopeChanged, false);
      // The page's scope label follows the stored scope.
      const { p: page } = await payloadOf(Z, later(DAY + 11 * MIN));
      assert.deepEqual(page.scope.timeClasses, ["RAPID", "BLITZ", "BULLET"]);
    });

    it("Retry on FAILED: attempts back to 0, QUEUED at USER_OPENED, the page computes again", async () => {
      const before = (await job(F))!;
      assert.equal(before.status, "FAILED");
      assert.equal(before.attempts, 3);
      const r = await recompute(F, {});
      assert.equal(r.res.status, 202);
      const after = (await job(F))!;
      assert.equal(after.status, "QUEUED");
      assert.equal(after.attempts, 0);
      assert.equal(after.lastError, null);
      assert.equal(after.priority, JOB_PRIORITY.USER_OPENED);
      const { p } = await payloadOf(F);
      assert.equal(p.status, "computing");
      assert.equal(p.failure, null);
    });

    it("two concurrent requests → exactly one 202", async () => {
      const m = await w.member("weak-race");
      const viewer = w.viewerOf(m);
      const now = later(3 * DAY);
      const results = await Promise.allSettled([requestRecompute(viewer, {}, now), requestRecompute(viewer, {}, now), requestRecompute(viewer, {}, now)]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      const refused = results.filter((x): x is PromiseRejectedResult => x.status === "rejected");
      assert.equal(refused.length, 2);
      for (const x of refused) assert.equal((x.reason as { code?: string }).code, "rate_limited");
      assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM jobs WHERE "userId" = ${m.id}`), 1);
    });

    it("402 for a lapsed member, 404 with the flag off", async () => {
      assert.equal((await recompute(Z, {}, { viewer: lapsed(w, Z) })).res.status, 402);
      w.flags(false);
      try {
        assert.equal((await recompute(Z, {}, { now: later(5 * DAY) })).res.status, 404);
      } finally {
        w.flags(true);
      }
    });
  });

  // ── TR-13 ────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("TR-13 POST /api/train/weakness/seen", () => {
    it("204; a version above weaknessVersion is clamped; a lower one is a no-op; repeats are idempotent; 402; 404 off", async () => {
      const v = Number((await profile(A))!.v);
      assert.ok(v >= 1);
      const r = await seen(A, { version: v + 50 });
      assert.equal(r.res.status, 204);
      assert.equal(Number((await profile(A))!.seen), v, "clamped to the real version");
      assert.equal((await seen(A, { version: 0 })).res.status, 204);
      assert.equal(Number((await profile(A))!.seen), v, "GREATEST: never lowered");
      assert.equal((await seen(A, { version: v })).res.status, 204);
      assert.equal(Number((await profile(A))!.seen), v);
      assert.equal((await seen(Z, { version: 3 })).res.status, 204, "a profile without a version stays at 0");
      assert.equal(Number((await profile(Z))!.seen), 0);
      assert.equal((await seen(A, { version: -1 })).res.status, 400);
      assert.equal((await seen(A, { version: 1 }, { viewer: lapsed(w, A) })).res.status, 402);
      w.flags(false);
      try {
        assert.equal((await seen(A, { version: v })).res.status, 404);
      } finally {
        w.flags(true);
      }
    });
  });

  // ── TR-7 weakness drill ──────────────────────────────────────────────────────────────────────────────────────
  describe("TR-7 POST /api/train/sessions {kind: 'weakness'}", () => {
    /** The Lichess themes the CI shard server holds (the shard files committed under chess-fixtures). */
    const shardThemes = () => new Set(readdirSync(path.join(SHARD_FIXTURES_DIR, "v1")).filter((d) => !d.endsWith(".json")));

    /**
     * A's first profile row that matches Lichess puzzles the shard server holds and has own positions in the bank; the
     * profile's rows may all be unmatched (time pressure, pawn structure), then any such candidate A has cards for.
     */
    async function matchableRow() {
      const served = shardThemes();
      const ok_ = (k: string) => k !== TIME_PRESSURE_THEME && isWeaknessCandidate(k) && served.has(lichessMatch(k) ?? "");
      const { p } = await payloadOf(A, later(DAY));
      const row = [...p.top, ...p.more].find((r) => r.matchable && r.inBank > 0 && ok_(r.pattern));
      if (row) return row.pattern;
      const themes = await w.db.$queryRaw<{ t: string; n: number }[]>(Prisma.sql`SELECT t, count(*)::int AS n FROM mistakes m
        JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK' CROSS JOIN LATERAL unnest(m.themes) t
        WHERE m."userId" = ${A.id} AND m."hiddenAt" IS NULL GROUP BY t ORDER BY n DESC, t`);
      const t = themes.map((x) => x.t).find(ok_);
      assert.ok(t, `A has a matched weakness theme in the bank: ${JSON.stringify(themes)}`);
      return t;
    }

    it("201: own positions interleaved with matched puzzles, 'Weakness drill', never counted toward the cap; the row in training_sessions", async () => {
      const pattern = await matchableRow();
      const key = w.uuid();
      const r = await drill(A, { kind: "weakness", pattern, size: 10, mix: true }, { key, now: later(DAY + 5 * MIN) });
      assert.equal(r.res.status, 201, await r.res.clone().text());
      const s = ok(SessionPayload).parse(await r.json()).data;
      assert.equal(s.kind, "weakness");
      assert.equal(s.header.title, "Weakness drill");
      assert.equal(s.countsTowardCap, false);
      assert.equal(s.capRemaining, null);
      assert.deepEqual(s.theme, { key: pattern, label: weaknessLabel(pattern) });
      assert.ok(s.items.length > 0 && s.items.length <= 20);
      const own = s.items.filter((i) => i.kind !== "puzzle");
      const puzzles = s.items.filter((i) => i.kind === "puzzle");
      assert.ok(own.length >= 1 && own.length <= 6, `${own.length} own`);
      assert.equal(own.length + puzzles.length, s.items.length);
      // o p o p …, then the rest.
      const order = s.items.map((i) => (i.kind === "puzzle" ? "p" : "o")).join("");
      const k = Math.min(own.length, puzzles.length);
      assert.equal(order.slice(0, 2 * k), "op".repeat(k), order);
      for (const l of s.queueLabels.filter((x) => puzzles.some((p) => p.itemId === x.itemId))) assert.equal(l.label, "Lichess puzzle · matched to your rating");
      const [row] = await w.db.$queryRaw<{ kind: string; source: string; theme: string; countsTowardCap: boolean; mix: boolean; size: number }[]>(Prisma.sql`
        SELECT kind::text AS kind, source, theme, "countsTowardCap", mix, size FROM training_sessions WHERE "referenceId" = ${s.ref}`);
      assert.deepEqual({ ...row!, size: Number(row!.size) }, { kind: "WEAKNESS", source: "weakness", theme: pattern, countsTowardCap: false, mix: true, size: s.items.length });

      // The same key → the same session (replayed); the same key with another body → 422; a new key with the same
      // body within 2 h → the ACTIVE session (200).
      const replay = await drill(A, { kind: "weakness", pattern, size: 10, mix: true }, { key, now: later(DAY + 6 * MIN) });
      assert.equal(replay.res.headers.get("idempotent-replayed"), "true");
      assert.equal(ok(SessionPayload).parse(await replay.json()).data.ref, s.ref);
      const reused = await drill(A, { kind: "weakness", pattern, size: 20, mix: true }, { key, now: later(DAY + 6 * MIN) });
      assert.equal(reused.res.status, 422);
      assert.equal(ErrorEnvelope.parse(await reused.json()).error.code, "idempotency_key_reused");
      const active = await drill(A, { kind: "weakness", pattern, size: 10, mix: true }, { now: later(DAY + 30 * MIN) });
      assert.equal(active.res.status, 200);
      assert.equal(ok(SessionPayload).parse(await active.json()).data.ref, s.ref);

      // Grading an own position goes through W1 like any bank card, and the bank's daily cap does not move.
      const item = own[0]!;
      const attempt: AttemptIn = {
        clientAttemptId: w.uuid(),
        sessionRef: s.ref,
        itemId: item.itemId,
        cardRef: item.cardRef,
        puzzleId: null,
        kind: item.kind,
        solved: true,
        firstTry: true,
        hintsUsed: 0,
        wrongMovesUci: [],
        solutionShown: false,
        timeMs: 9_000,
        grade: "good",
        suggestedGrade: "good",
        cardReps: item.cardReps,
        reviewedAt: later(DAY + 7 * MIN).toISOString(),
      };
      const graded = await w.call("attempts", "POST", "/api/train/attempts", A, { body: { attempts: [attempt] }, now: later(DAY + 7 * MIN) });
      assert.equal(graded.res.status, 200, await graded.res.clone().text());
      assert.equal(ok(AttemptsResult).parse(await graded.json()).data.results[0]!.status, "ok");
      const days = await w.db.$queryRaw<{ br: number; ni: number }[]>(Prisma.sql`
        SELECT COALESCE(sum("bankReviewed"), 0)::int AS br, COALESCE(sum("newIntroduced"), 0)::int AS ni FROM training_days WHERE "userId" = ${A.id}`);
      assert.deepEqual(days[0], { br: 0, ni: 0 }, "a weakness drill never counts toward the bank cap");

      // The summary: "{label} drill · {n} positions".
      const summary = await getSessionSummary(w.viewerOf(A), s.ref, later(DAY + 8 * MIN));
      assert.equal(summary.kind, "weakness");
      assert.equal(summary.eyebrow, `${weaknessLabel(pattern)} drill · ${s.items.length} ${s.items.length === 1 ? "position" : "positions"}`);
      assert.ok(summary.next.puzzles.href.includes(`theme=${encodeURIComponent(lichessMatch(pattern)!)}`));
    });

    // drill-legality (plan §12.5 `drill-legality.test.ts`; FIX-1): every item of composed weakness sessions, own
    // positions from A's real bank and matched Lichess puzzles from the shard server, replays its solution legally from
    // `fen` + `setup` with chess.js: the setup then user, reply, user …, and each accepted first move is legal too.
    it("drill-legality: every item of a 20-position mixed drill replays its solution legally", async () => {
      const pattern = await matchableRow();
      const sessions = [];
      const mixed = await drill(A, { kind: "weakness", pattern, size: 20, mix: true }, { now: later(DAY + 50 * MIN) });
      assert.ok([200, 201].includes(mixed.res.status), await mixed.res.clone().text());
      sessions.push(ok(SessionPayload).parse(await mixed.json()).data);
      let checked = 0;
      let puzzles = 0;
      for (const s of sessions) {
        for (const item of s.items) {
          const chess = new Chess(item.fen);
          const play = (uci: string, what: string) => {
            try {
              chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) });
            } catch {
              assert.fail(`${item.itemId} (${item.kind}): ${what} ${uci} is illegal in ${chess.fen()}`);
            }
          };
          for (const m of item.setup) play(m, "setup");
          assert.equal(chess.turn(), item.orient, `${item.itemId}: the member to move after the setup`);
          const start = chess.fen();
          for (const alt of item.accept) {
            const c = new Chess(start);
            assert.doesNotThrow(() => c.move({ from: alt.slice(0, 2), to: alt.slice(2, 4), ...(alt.length > 4 ? { promotion: alt[4] } : {}) }), `${item.itemId}: accepted ${alt}`);
          }
          item.solution.forEach((m, k) => play(m, k % 2 === 0 ? "user move" : "reply"));
          assert.equal(item.solution.length % 2, 1, `${item.itemId}: the solution ends on the member's move`);
          checked++;
          if (item.kind === "puzzle") puzzles++;
        }
      }
      assert.ok(checked >= 10 && puzzles >= 1, `${checked} items, ${puzzles} puzzles`);
    });

    it("time pressure: own positions only (puzzles have no clock), mix stored off", async () => {
      const tp = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
        WHERE c."userId" = ${A.id} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL AND ${TIME_PRESSURE_THEME} = ANY(m.themes)`);
      assert.ok(tp > 0, "B-W2 tagged some of A's bank under a minute");
      const r = await drill(A, { kind: "weakness", pattern: TIME_PRESSURE_THEME, size: 10, mix: true }, { now: later(DAY + 40 * MIN) });
      assert.equal(r.res.status, 201, await r.res.clone().text());
      const s = ok(SessionPayload).parse(await r.json()).data;
      assert.equal(s.items.length, Math.min(10, tp));
      assert.ok(s.items.every((i) => i.kind !== "puzzle"));
      const [row] = await w.db.$queryRaw<{ mix: boolean }[]>(Prisma.sql`SELECT mix FROM training_sessions WHERE "referenceId" = ${s.ref}`);
      assert.equal(row!.mix, false);
    });

    it("no own positions + a matched pattern → matched puzzles only; nothing to drill → 400 empty_drill; unknown → 400 unknown_pattern", async () => {
      const r = await drill(Z, { kind: "weakness", pattern: "fork", size: 10, mix: false }, { now: later(2 * DAY) });
      assert.equal(r.res.status, 201, await r.res.clone().text());
      const s = ok(SessionPayload).parse(await r.json()).data;
      assert.ok(s.items.length > 0 && s.items.every((i) => i.kind === "puzzle"), `mix forced on with zero own positions: ${JSON.stringify({ n: s.items.length, kinds: s.items.map((i) => i.kind), empty: s.empty })}`);

      const empty = await drill(Z, { kind: "weakness", pattern: TIME_PRESSURE_THEME, size: 10, mix: true }, { now: later(2 * DAY) });
      assert.equal(empty.res.status, 400);
      const e = ErrorEnvelope.parse(await empty.json()).error;
      assert.equal(e.code, "validation_failed");
      assert.equal(e.details?.reason, "empty_drill");

      const unknown = await drill(A, { kind: "weakness", pattern: "notAPattern", size: 10, mix: true }, { now: later(2 * DAY) });
      assert.equal(unknown.res.status, 400);
      assert.equal(ErrorEnvelope.parse(await unknown.json()).error.details?.reason, "unknown_pattern");
      const malformed = await drill(A, { kind: "weakness", pattern: "Fork!", size: 12, mix: true }, { now: later(2 * DAY) });
      assert.equal(malformed.res.status, 400);
    });

    it("404 with the flag off; 402 lapsed; the 31st session of the hour → 429 session_limit", async () => {
      w.flags(false);
      try {
        const off = await drill(A, { kind: "weakness", pattern: "fork", size: 10, mix: true }, { now: later(3 * DAY) });
        assert.equal(off.res.status, 404);
      } finally {
        w.flags(true);
      }
      const lapsedRes = await w.call("sessions", "POST", "/api/train/sessions", A, {
        body: { kind: "weakness", pattern: "fork", size: 10, mix: true },
        headers: { "Idempotency-Key": w.uuid() },
        viewer: lapsed(w, A),
        env: shardEnv,
      });
      assert.equal(lapsedRes.res.status, 402);

      // 30 sessions in the hour (practice lists never reuse), then the weakness drill is refused, counted from the rows.
      const t = later(4 * DAY);
      for (let i = 0; i < 30; i++) {
        const r = await w.call("sessions", "POST", "/api/train/sessions", A, {
          body: { kind: "bank", source: "bank", practice: true },
          headers: { "Idempotency-Key": w.uuid() },
          now: new Date(t.getTime() + i * 1000),
          env: shardEnv,
        });
        assert.equal(r.res.status, 201, await r.res.clone().text());
      }
      const limited = await drill(A, { kind: "weakness", pattern: TIME_PRESSURE_THEME, size: 10, mix: true }, { now: new Date(t.getTime() + 40_000) });
      assert.equal(limited.res.status, 429);
      const e = ErrorEnvelope.parse(await limited.json()).error;
      assert.equal(e.details?.reason, "session_limit");
      assert.ok(e.retryAfterSec! > 0 && e.retryAfterSec! <= 3600);
    });
  });
});
