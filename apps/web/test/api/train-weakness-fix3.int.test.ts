/**
 * FIX-3 (review round 3) on a real Postgres, through the product's pipelines (weakness-world.ts: real CC0 Lichess games
 * graded and written as the worker writes them, B-W1's inputs, the A6 bank, snapshots from the real computeWeakness()):
 *   - regression: weakness-count-beyond-1000 (review item 3) — TR-5 counts the worker's set (the scope's newest 300,
 *     time classes filtered BEFORE the limit), however many newer games of other time classes the member has: 30
 *     analysed blitz games behind 1,000 newer bullet games (set-based clones of one of the member's real games, the
 *     volume gate's technique) read 30, as the worker's Q-W5 and progress probe count them (the 1,000-row read said 0);
 *     the bullet games still reach the "include bullet" offer's count;
 *   - regression: weakness-hide-flag-off (review item 12) — with the `weakness` flag off, removing a bank card (W6) or
 *     switching a moment off (A6) writes no RECOMPUTE_WEAKNESS row, even with a READY profile; with it on the hide arms
 *     the member's recompute as before;
 *   - regression: home-weakness-empty-bank (review item 11) — the Home bank line names the top weakness only while the
 *     bank holds cards of it; with none it is P5's most common bank theme (D-P6-FIX3-W2).
 * Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { RouteHandler } from "@/lib/api/route";
import { removeCard } from "@/lib/train/cards.server";
import { setMomentInBank } from "@/lib/train/links.server";
import { scopeCountsSql } from "@/lib/train/weakness.server";
import { weaknessInputsStatement } from "../../../analysis-worker/src/weakness/load";
import { probeStatement } from "../../../analysis-worker/src/weakness/progressEmitter";
import { installTestDeps, noParams, request } from "../helpers/route-harness";
import { weaknessWorld, WEAKNESS_ENV, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const CLONES = 1_000;

describe("P6 FIX-3 weakness counts, flag-off hides and the Home line (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let D: Member, H: Member;

  async function payloadOf(m: Member, now = WORLD_NOW) {
    const r = await w.call("weakness", "GET", "/api/train/weakness", m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(WeaknessPayload).parse(await r.json()).data;
  }
  const job = async (m: Member) =>
    (
      await w.db.$queryRaw<{ status: string; payload: Record<string, unknown>; runAt: Date; finishedAt: Date | null }[]>(
        Prisma.sql`SELECT status::text AS status, payload, "runAt", "finishedAt" FROM jobs WHERE "dedupeKey" = ${`weakness:${m.id}`}`,
      )
    )[0] ?? null;
  /** The member's live BANK cards, with their mistake's themes and the review moment that banked them. */
  const cards = (m: Member) =>
    w.db.$queryRaw<{ itemKey: string; themes: string[]; gameRef: string; ply: number }[]>(Prisma.sql`
      SELECT DISTINCT ON (c."itemKey") c."itemKey", mi.themes, g."referenceId" AS "gameRef", mo.ply::int AS ply
        FROM training_cards c JOIN mistakes mi ON mi.id = c."mistakeId"
        JOIN mistake_occurrences mo ON mo."mistakeId" = mi.id JOIN games g ON g.id = mo."gameId"
       WHERE c."userId" = ${m.id} AND c.deck = 'BANK' AND mi."hiddenAt" IS NULL
       ORDER BY c."itemKey", mo."gameId", mo.ply`);
  /** HOME-1 through the real route handler (route(), the DAL, FLAGS_OVERRIDE through the real flag evaluation). */
  async function home(m: Member, now = WORLD_NOW) {
    const route = (await import("@/app/api/home/route")) as { GET: RouteHandler };
    const t = installTestDeps({ userId: `user_${m.ref}`, viewer: w.viewerOf(m), env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV }, clock: now.getTime() });
    try {
      const res = await route.GET(request("/api/home"), noParams({}));
      const raw = await res.text();
      assert.equal(res.status, 200, raw);
      return ok(HomeData).parse(JSON.parse(raw)).data;
    } finally {
      t.restore();
    }
  }

  before(async () => {
    await w.setup();
    // D: 30 analysed blitz games 30…59 days back (in scope); the 1,000 newer bullet games come in the test.
    D = await w.member("cnt", { timeZone: "Europe/Berlin", rating: 1500 });
    const dOpp = await w.member("cnt-opp");
    await w.playCc0(D, dOpp, { count: 30, timeClasses: ["BLITZ"], newestDaysAgo: 30, spacingDays: 1 });
    H = await w.member("hide3", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    const hOpp = await w.member("hide3-opp");
    await w.playCc0(H, hOpp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(H, hOpp, { count: 30, spacingDays: 2 });
    const inputs = await w.computeInputs([D, H]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    const banked = await w.bank(H);
    assert.ok(banked >= 10, `H's moments banked: ${banked}`);
    assert.equal((await w.recompute(H)).draft.status, "READY");
  });

  after(async () => {
    w.flags(true);
    await w.teardown();
  });

  it("regression: weakness-count-beyond-1000 — 1,000 newer bullet games do not hide the scope's analysed games from TR-5", async () => {
    const scope = resolveScope(null);
    assert.ok(!scope.timeClasses.includes("BULLET"), "the default scope leaves bullet out");
    const since = scopeSince(WORLD_NOW, D.timeZone, scope.months);
    // The worker's counts: Q-W5 (the recompute's inputs) and the progress probe, on the same rows.
    const workerCount = async () => {
      const st = weaknessInputsStatement(String(D.id), since, scope.timeClasses);
      const rows = await w.db.$queryRawUnsafe<{ accuracy: number | null; weaknessInputsV: number }[]>(st.text, ...st.values);
      const pr = probeStatement(String(D.id), since, scope);
      const probe = (await w.db.$queryRawUnsafe<{ analysed: number; inScope: number }[]>(pr.text, ...pr.values))[0]!;
      return {
        q5: rows.filter((r) => r.accuracy !== null && Number(r.weaknessInputsV) >= 1).length,
        probe: Number(probe.analysed),
        inScope: Number(probe.inScope),
      };
    };
    const before1 = await workerCount();
    assert.equal(before1.q5, 30, "30 analysed in-scope games");
    assert.equal((await payloadOf(D)).games.analysed, 30);

    // 1,000 newer BULLET copies of one of D's real games (re-keyed, re-dated 1…1,000 minutes before now), set-based in
    // one transaction, as the §9.1 volume gate clones its members.
    const cols = async (t: string) =>
      (await w.db.$queryRaw<{ c: string }[]>(Prisma.sql`SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${t} ORDER BY ordinal_position`)).map((r) => r.c);
    const [src] = await w.db.$queryRaw<{ g: bigint }[]>(Prisma.sql`SELECT "gameId" AS g FROM game_players WHERE "userId" = ${D.id} ORDER BY "endedAt" DESC LIMIT 1`);
    const gc = await cols("games");
    const pc = await cols("game_players");
    const ov = (o: Record<string, string>) => (c: string) => o[c] ?? `src."${c}"`;
    const now = `'${WORLD_NOW.toISOString()}'::timestamptz AT TIME ZONE 'UTC'`;
    const ended = `${now} - make_interval(mins => m.k::int)`;
    const gO = ov({ id: "m.new", referenceId: `left(md5(src."referenceId" || m.k || 'fx3'), length(src."referenceId"))`, externalId: "NULL", timeClass: `'BULLET'`, rematchOfId: "NULL", endedAt: ended });
    const pO = ov({ gameId: "m.new", timeClass: `'BULLET'`, endedAt: ended, linkedAccountId: "NULL", purgeLinkId: "NULL" });
    await w.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE fx3map ON COMMIT DROP AS SELECT k, nextval(pg_get_serial_sequence('games', 'id')) AS new FROM generate_series(1, ${CLONES}) k`);
      await tx.$executeRawUnsafe(`INSERT INTO games (${gc.map((c) => `"${c}"`).join(",")}) SELECT ${gc.map(gO).join(",")} FROM games src CROSS JOIN fx3map m WHERE src.id = ${src!.g}`);
      await tx.$executeRawUnsafe(
        `INSERT INTO game_players (${pc.map((c) => `"${c}"`).join(",")}) SELECT ${pc.map(pO).join(",")} FROM game_players src CROSS JOIN fx3map m WHERE src."gameId" = ${src!.g} AND src."userId" = ${D.id}`,
      );
    });

    const after1 = await workerCount();
    assert.deepEqual(after1, before1, "the bullet games are outside the worker's scope");
    const p = await payloadOf(D);
    assert.equal(p.games.analysed, after1.q5, "TR-5 counts the worker's analysed set");
    assert.equal(p.games.analysed, after1.probe, "…and the worker's progress probe's");
    assert.equal(p.games.inScope, after1.inScope, "in scope: the same newest-300 set");
    // The bullet games still reach the offer's count (the other time classes' bounded part).
    const counts = await w.db.$queryRaw<{ timeClass: string | null; n: number }[]>(scopeCountsSql(D.id, since, scope.timeClasses, scope.maxGames));
    assert.equal(Number(counts.find((c) => c.timeClass === "BULLET")?.n ?? 0), CLONES);
  });

  it("regression: weakness-hide-flag-off — with the flag off W6 and A6 hides write no weakness job; on, the hide arms", async () => {
    const viewer = w.viewerOf(H);
    const list = await cards(H);
    assert.ok(list.length >= 3, `H's live cards: ${list.length}`);
    const before1 = await job(H);
    w.flags(false);
    try {
      assert.deepEqual(await removeCard(viewer, list[0]!.itemKey, WORLD_NOW), { removed: true });
      const a6 = await setMomentInBank(viewer, list[1]!.gameRef, list[1]!.ply, false, WORLD_NOW);
      assert.ok(a6 !== "admin_noop" && a6.inBank === false && a6.card === null);
      const hidden = await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM training_cards c
        WHERE c."userId" = ${H.id} AND c."itemKey" = ANY(${[list[0]!.itemKey, list[1]!.itemKey]}::text[])`);
      assert.equal(hidden[0]!.n, 0, "both cards left the bank");
      assert.deepEqual(await job(H), before1, "no RECOMPUTE_WEAKNESS row written or changed with the flag off");
    } finally {
      w.flags(true);
    }
    assert.deepEqual(await removeCard(viewer, list[2]!.itemKey, WORLD_NOW), { removed: true });
    const armed = await job(H);
    assert.ok(armed, "flag on: the hide arms the member's recompute");
    assert.equal(armed.status, "QUEUED");
    assert.equal(armed.payload.trigger, "removed");
  });

  it("regression: home-weakness-empty-bank — the Home line names the top weakness only while the bank holds its cards", async () => {
    const p = await payloadOf(H);
    assert.equal(p.status, "ready");
    const top = p.top[0]!;
    const withCards = await home(H);
    if (top.inBank > 0) {
      assert.deepEqual(withCards.bank.topTheme, { label: top.label.slice(0, 40), n: top.inBank, source: "weakness" });
    }
    // Remove every bank card carrying the top pattern (W6, the product's own remove).
    const viewer = w.viewerOf(H);
    for (const c of (await cards(H)).filter((x) => x.themes.includes(top.pattern))) {
      await removeCard(viewer, c.itemKey, WORLD_NOW);
    }
    assert.equal((await payloadOf(H)).top[0]!.inBank, 0, "no card of the top weakness is left");
    const empty = await home(H);
    const line = empty.bank.topTheme;
    assert.notEqual(line?.source, "weakness", `the line names a weakness with 0 in bank: ${JSON.stringify(line)}`);
    if (line) assert.ok(line.n > 0, "P5's fallback: the most common bank theme, with cards");
  });
});
