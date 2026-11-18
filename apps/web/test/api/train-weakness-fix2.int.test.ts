/**
 * FIX-2 (review round 2) on a real Postgres, through the product's pipelines (weakness-world.ts: real CC0 Lichess games
 * graded and written as the worker writes them, B-W1's inputs, the A6 bank, snapshots from the real computeWeakness()):
 *   - regression: weakness-count-drift — TR-5 counts exactly the worker's analysed set (the newest 300 in scope, usable
 *     or healable inputs): a member whose snapshot is INSUFFICIENT because some analysed rows cannot be read (−1) or are
 *     being re-analysed reads "insufficient", never "computing" (and auto-building) for good;
 *   - regression: weakness-hide-rearm-limit — hiding mistakes (W6 / A6 off, on, off …) arms at most ONE recompute, and
 *     never earlier than TR-12's 600 s after the last run; an already hidden mistake arms nothing;
 *   - regression: weakness-preview-skipped-cards — Q-W2 leaves out cards skipped until the next release, as Q-W7 (the
 *     drill's own positions) does, so the preview's "{own} from your games" is the session's.
 * Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import { removeBankCard, skipCard } from "@/lib/train/cards.server";
import { weaknessOwnCardsSql } from "@/lib/train/sessions.server";
import { scopeCountsSql } from "@/lib/train/weakness.server";
import { weaknessWorld, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const SEC = 1_000;

describe("P6 FIX-2 weakness reads and arms (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let D: Member, H: Member;

  const get = (m: Member, now = WORLD_NOW) => w.call("weakness", "GET", "/api/train/weakness", m, { now });
  async function payloadOf(m: Member, now = WORLD_NOW) {
    const r = await get(m, now);
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(WeaknessPayload).parse(await r.json()).data;
  }
  const job = async (m: Member) =>
    (
      await w.db.$queryRaw<{ status: string; payload: Record<string, unknown>; runAt: Date; finishedAt: Date | null }[]>(
        Prisma.sql`SELECT status::text AS status, payload, "runAt", "finishedAt" FROM jobs WHERE "dedupeKey" = ${`weakness:${m.id}`}`,
      )
    )[0];

  before(async () => {
    await w.setup();
    D = await w.member("drift", { timeZone: "Europe/Berlin", rating: 1500 });
    const dOpp = await w.member("drift-opp");
    await w.playCc0(D, dOpp, { count: 24, timeClasses: ["BLITZ"], from: 2, spacingDays: 2 });
    H = await w.member("hide", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    const hOpp = await w.member("hide-opp");
    await w.playCc0(H, hOpp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(H, hOpp, { count: 30, spacingDays: 2 });
    const inputs = await w.computeInputs([D, H]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    const banked = await w.bank(H);
    assert.ok(banked >= 10, `H's moments banked: ${banked}`);
    assert.equal((await w.recompute(H)).draft.status, "READY");
  });

  after(async () => {
    await w.teardown();
  });

  it("regression: weakness-count-drift — rows the worker cannot use are not counted; an INSUFFICIENT profile stays insufficient", async () => {
    const sides = await w.db.$queryRaw<{ gameId: bigint }[]>(Prisma.sql`
      SELECT "gameId" FROM game_players WHERE "userId" = ${D.id} AND accuracy IS NOT NULL ORDER BY "endedAt" DESC, "gameId" DESC`);
    assert.equal(sides.length, 24);
    // 3 rows whose stored analysis could not be read by the heal (−1), 2 whose re-analysis is running (inputs 0,
    // completedAt cleared by P3): the worker counts 19 of 24.
    const failed = sides.slice(0, 3).map((s) => String(s.gameId));
    const redo = sides.slice(3, 5).map((s) => String(s.gameId));
    await w.db.$executeRaw(Prisma.sql`UPDATE game_players SET "weaknessInputsV" = -1 WHERE "userId" = ${D.id} AND "gameId" = ANY(${failed}::bigint[])`);
    await w.db.$executeRaw(Prisma.sql`UPDATE game_players SET "weaknessInputsV" = 0 WHERE "userId" = ${D.id} AND "gameId" = ANY(${redo}::bigint[])`);
    await w.db.$executeRaw(Prisma.sql`UPDATE game_analyses SET "completedAt" = NULL WHERE "gameId" = ANY(${redo}::bigint[])`);
    const built = await w.recompute(D);
    assert.equal(built.draft.status, "INSUFFICIENT");
    assert.equal(built.draft.gamesAnalysed, 19, "the worker's own count");
    const p = await payloadOf(D);
    assert.equal(p.games.analysed, 19, "TR-5 counts the same set");
    assert.equal(p.status, "insufficient", JSON.stringify({ status: p.status, progress: p.progress }));
    assert.notEqual(p.progress?.orphaned, true, "no auto-build: building again would write the same row");
    // A row healed back (its analysis finished) is counted again: the page builds once more.
    await w.db.$executeRaw(Prisma.sql`UPDATE game_analyses SET "completedAt" = ${WORLD_NOW} WHERE "gameId" = ANY(${redo}::bigint[])`);
    const p2 = await payloadOf(D);
    assert.equal(p2.games.analysed, 21);
    assert.deepEqual([p2.status, p2.progress?.orphaned], ["computing", true]);
  });

  it("the analysed count stops at the scope's newest maxGames, as Q-W5's LIMIT 300 does (Q-W3's own parameter)", async () => {
    const scope = resolveScope(null);
    const since = scopeSince(WORLD_NOW, "Asia/Kolkata", scope.months);
    const all = await w.db.$queryRaw<{ timeClass: string | null; n: number; analysed: number }[]>(scopeCountsSql(H.id, since, scope.timeClasses, 300));
    const ten = await w.db.$queryRaw<{ timeClass: string | null; n: number; analysed: number }[]>(scopeCountsSql(H.id, since, scope.timeClasses, 10));
    const sum = (rows: { n: number; analysed: number }[], k: "n" | "analysed") => rows.reduce((s, r) => s + Number(r[k]), 0);
    const [truth] = await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM game_players
      WHERE "userId" = ${H.id} AND accuracy IS NOT NULL AND "timeClass" IN ('RAPID', 'BLITZ') AND "endedAt" >= ${since}`);
    assert.ok(truth!.n > 10);
    assert.equal(sum(all, "analysed"), truth!.n);
    assert.equal(sum(ten, "analysed"), 10, "only the newest 10 in scope count");
    // FIX-3 (review item 3): the scope part is Q-W5's own set (the newest maxGames in scope), so "in scope" stops there
    // too, as the worker's progress probe and J4 count it (it was "every in-scope game among the newest 1,000").
    const inScope = (rows: { timeClass: string | null; n: number }[]) =>
      rows.filter((r) => r.timeClass !== null && (scope.timeClasses as string[]).includes(r.timeClass)).reduce((s, r) => s + Number(r.n), 0);
    assert.equal(inScope(ten), 10, "games in scope: the newest maxGames, as the worker counts them");
    assert.ok(inScope(all) > 10);
  });

  it("regression: weakness-hide-rearm-limit — repeated hides arm one recompute, never before TR-12's 600 s after the last run", async () => {
    // H's recompute ran a minute ago (the job row a finished run leaves).
    const finished = new Date(Date.now() - 60 * SEC);
    await w.db.$executeRaw(Prisma.sql`INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "runAt", payload, status, attempts, "maxAttempts", "finishedAt", "createdAt")
      VALUES ('RECOMPUTE_WEAKNESS', ${`weakness:${H.id}`}, ${H.id}, 50, ${finished}, '{"v":1,"trigger":"user"}'::jsonb, 'DONE', 1, 3, ${finished}, ${finished})
      ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'DONE', "finishedAt" = ${finished}, "runAt" = ${finished}, payload = '{"v":1,"trigger":"user"}'::jsonb`);
    const mistakes = await w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT m.id FROM mistakes m JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
       WHERE m."userId" = ${H.id} AND m."hiddenAt" IS NULL ORDER BY m.id LIMIT 3`);
    assert.equal(mistakes.length, 3);
    // The first real hide arms once, at the earliest finishedAt + 600 s.
    assert.ok(await removeBankCard(w.db, H.id, { mistakeId: mistakes[0]!.id }, WORLD_NOW, { weakness: true }));
    const armed = (await job(H))!;
    assert.equal(armed.status, "QUEUED");
    assert.equal(armed.payload.trigger, "removed");
    assert.ok(armed.runAt.getTime() >= finished.getTime() + 600 * SEC - SEC, `runAt ${armed.runAt.toISOString()}`);
    // More hides (other mistakes), the A6 path on an already hidden mistake (no card left), and un-hide / re-hide
    // toggles: the pending row is left exactly as it is.
    await removeBankCard(w.db, H.id, { mistakeId: mistakes[1]!.id }, WORLD_NOW, { weakness: true });
    for (let i = 0; i < 5; i++) {
      await removeBankCard(w.db, H.id, { mistakeId: mistakes[0]!.id }, WORLD_NOW, { weakness: true });
      await w.db.$executeRaw(Prisma.sql`UPDATE mistakes SET "hiddenAt" = NULL WHERE id = ${mistakes[2]!.id}`);
      await removeBankCard(w.db, H.id, { mistakeId: mistakes[2]!.id }, WORLD_NOW, { weakness: true });
    }
    const after = (await job(H))!;
    assert.deepEqual([after.status, after.runAt.getTime()], ["QUEUED", armed.runAt.getTime()], "never pulled forward");
    const rows = await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM jobs WHERE "dedupeKey" = ${`weakness:${H.id}`}`);
    assert.equal(rows[0]!.n, 1);
    // A finished row: an already hidden mistake arms nothing.
    await w.db.$executeRaw(Prisma.sql`UPDATE jobs SET status = 'DONE', "finishedAt" = ${finished} WHERE "dedupeKey" = ${`weakness:${H.id}`}`);
    await removeBankCard(w.db, H.id, { mistakeId: mistakes[0]!.id }, WORLD_NOW, { weakness: true });
    assert.equal((await job(H))!.status, "DONE", "no visible → hidden change, no arm");
  });

  it("regression: weakness-preview-skipped-cards — TR-5's inBank leaves out skipped cards, as the drill's own pick does", async () => {
    const p0 = await payloadOf(H);
    const row = [...p0.top, ...p0.more].find((r) => r.inBank >= 2);
    assert.ok(row, "a row with at least 2 positions in the bank");
    const own0 = await w.db.$queryRaw<{ key: string }[]>(weaknessOwnCardsSql(H.id, WORLD_NOW, row.pattern));
    assert.equal(own0.length, Math.min(40, row.inBank), "Q-W2 and Q-W7 agree before");
    const card = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`
      SELECT c."itemKey" FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
       WHERE c."userId" = ${H.id} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL AND ${row.pattern} = ANY(m.themes) LIMIT 1`))[0]!;
    await skipCard(w.viewerOf(H), card.itemKey, null, WORLD_NOW);
    const p1 = await payloadOf(H);
    const after = [...p1.top, ...p1.more].find((r) => r.pattern === row.pattern)!;
    assert.equal(after.inBank, row.inBank - 1, "the skipped card waits for tomorrow's release");
    const own1 = await w.db.$queryRaw<{ key: string }[]>(weaknessOwnCardsSql(H.id, WORLD_NOW, row.pattern));
    assert.equal(own1.length, Math.min(40, after.inBank), "the preview describes the drill that starts");
  });
});
