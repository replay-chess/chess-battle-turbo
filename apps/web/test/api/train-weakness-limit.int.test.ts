/**
 * FIX-3 (review round 3, D-P6-FIX3-5) on a real Postgres, through the product's pipelines (weakness-world.ts: real CC0
 * Lichess games graded and written as the worker writes them, B-W1's inputs, the A6 bank, a READY snapshot from the real
 * computeWeakness()), the real TR-12 route and the real `removeBankCard`:
 *   - regression: weakness-one-member-limit — ONE durable limit for every member-triggered arm: a hide (W6 / A6) stamps
 *     the instant of the run it armed, so TR-12 right after it is refused (429) and a hide right after TR-12 arms its
 *     run no earlier than 600 s after TR-12's. No sequence of member calls gets two runs inside 600 s (FIX-2: hide then
 *     TR-12 ran twice, 2 ms apart).
 * Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { removeBankCard } from "@/lib/train/cards.server";
import { weaknessWorld, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const SEC = 1_000;
const LIMIT = 600 * SEC;

describe("P6 FIX-3 one recompute limit for member calls (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let H: Member, K: Member;

  type JobRow = { status: string; payload: Record<string, unknown>; runAt: Date; finishedAt: Date | null; now: Date };
  const job = async (m: Member) =>
    (
      await w.db.$queryRaw<JobRow[]>(
        Prisma.sql`SELECT status::text AS status, payload, "runAt", "finishedAt", (now() AT TIME ZONE 'UTC') AS now FROM jobs WHERE "dedupeKey" = ${`weakness:${m.id}`}`,
      )
    )[0];
  /** What the worker's completion leaves: the run armed for `m` happened, DONE now (payload kept, as rerunIfFlagged). */
  const runFinished = (m: Member) =>
    w.db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'DONE', "finishedAt" = (now() AT TIME ZONE 'UTC'), "lockedBy" = NULL
                                 WHERE "dedupeKey" = ${`weakness:${m.id}`}`);
  /** TR-12 at the database's own clock (the hide arm reads it). */
  const recompute = async (m: Member) => {
    const [row] = await w.db.$queryRaw<{ now: Date }[]>(Prisma.sql`SELECT (now() AT TIME ZONE 'UTC') AS now`);
    const now = row!.now;
    return w.call("recompute", "POST", "/api/train/weakness/recompute", m, { body: {}, now });
  };
  const bankMistakes = (m: Member) =>
    w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT m.id FROM mistakes m JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
       WHERE m."userId" = ${m.id} AND m."hiddenAt" IS NULL ORDER BY m.id LIMIT 3`);
  /** A member's last run finished long ago (no member arm in the window). */
  const quiet = (m: Member) => {
    const long = new Date(Date.now() - 3 * 3_600 * SEC);
    return w.db.$executeRaw(Prisma.sql`INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "runAt", payload, status, attempts, "maxAttempts", "finishedAt", "createdAt")
      VALUES ('RECOMPUTE_WEAKNESS', ${`weakness:${m.id}`}, ${m.id}, 50, ${long}, '{"v":1,"trigger":"weekly"}'::jsonb, 'DONE', 1, 3, ${long}, ${long})
      ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'DONE', "finishedAt" = ${long}, "runAt" = ${long}, payload = '{"v":1,"trigger":"weekly"}'::jsonb`);
  };

  before(async () => {
    await w.setup();
    H = await w.member("limit-h", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    K = await w.member("limit-k", { timeZone: "Europe/Berlin", rating: 1350, ratingBand: "R1200_1600" });
    const opp = await w.member("limit-opp");
    await w.playCc0(H, opp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(H, opp, { count: 30, spacingDays: 2 });
    await w.playCc0(K, opp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(K, opp, { count: 30, spacingDays: 2 });
    const inputs = await w.computeInputs([H, K]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    assert.ok((await w.bank(H)) >= 3);
    assert.ok((await w.bank(K)) >= 3);
    assert.equal((await w.recompute(H)).draft.status, "READY");
    assert.equal((await w.recompute(K)).draft.status, "READY");
  });

  after(async () => {
    await w.teardown();
  });

  it("regression: weakness-one-member-limit — hide then TR-12 is refused; TR-12 then hide waits 600 s; never two member runs in 600 s", async () => {
    // 1. Hide first: the run is armed now and stamped as the member's.
    await quiet(H);
    const [m1, m2] = await bankMistakes(H);
    assert.ok(m1 && m2);
    assert.ok(await removeBankCard(w.db, H.id, { mistakeId: m1.id }, WORLD_NOW, { weakness: true }));
    const hid = (await job(H))!;
    assert.equal(hid.status, "QUEUED");
    assert.equal(hid.payload.trigger, "removed");
    assert.ok(Math.abs(hid.runAt.getTime() - hid.now.getTime()) < 5 * SEC, "due now (the last run was hours ago)");
    assert.ok(typeof hid.payload.userAt === "string", "the hide's run is stamped as a member-armed run");
    const run1 = hid.runAt.getTime();
    await runFinished(H);
    // TR-12 right after: refused, retry when 600 s have passed since that run.
    const r = await recompute(H);
    assert.equal(r.res.status, 429, await r.res.clone().text());
    const sec = ((await r.json()) as { error?: { retryAfterSec?: number } }).error?.retryAfterSec ?? 0;
    assert.ok(sec > 590 && sec <= 600, `retryAfterSec ${sec}`);
    assert.equal((await job(H))!.status, "DONE", "nothing armed");
    // Another hide: armed, but never earlier than 600 s after the first member run, and stamped with its own instant.
    assert.ok(await removeBankCard(w.db, H.id, { mistakeId: m2.id }, WORLD_NOW, { weakness: true }));
    const second = (await job(H))!;
    assert.equal(second.status, "QUEUED");
    assert.ok(second.runAt.getTime() >= run1 + LIMIT - SEC, `second member run ${second.runAt.toISOString()} vs first ${new Date(run1).toISOString()}`);
    assert.equal(new Date(String(second.payload.userAt)).getTime(), second.runAt.getTime());
    // TR-12 now: still refused (the pending member run is the next one), retry after it + 600 s (≤ 1,200 s).
    const r2 = await recompute(H);
    assert.equal(r2.res.status, 429);

    // 2. TR-12 first, then a hide: the hide's run waits 600 s after TR-12's.
    await quiet(K);
    const t = await recompute(K);
    assert.equal(t.res.status, 202, await t.res.clone().text());
    const tr = (await job(K))!;
    const run0 = tr.runAt.getTime();
    await runFinished(K);
    const [k1] = await bankMistakes(K);
    assert.ok(k1);
    assert.ok(await removeBankCard(w.db, K.id, { mistakeId: k1.id }, WORLD_NOW, { weakness: true }));
    const after = (await job(K))!;
    assert.equal(after.status, "QUEUED");
    assert.ok(after.runAt.getTime() >= run0 + LIMIT - SEC, `the hide's run ${after.runAt.toISOString()} vs TR-12's ${new Date(run0).toISOString()}`);
  });
});
