/**
 * HOME-1 `GET /api/home` on a real Postgres (phase-05 plan §12.2 "HOME-1"): the populated, new_user, analysing and
 * clean variants from the persona states, the `import` block from a P4 import run, the bank card and the week; reads
 * only (GET purity); 402 for a non-member.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { countQueries } from "../helpers/query-counter";
import { installTestDeps } from "../helpers/route-harness";
import { getHomeData } from "@/lib/home/home.server";
import { nonMember, trainWorld, WORLD_NOW } from "./train/train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe("P5 HOME-1 (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  const home = async (m: Parameters<typeof w.call>[3], now = WORLD_NOW) => {
    const r = await w.call("home", "GET", "/api/home", m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
    return ok(HomeData).parse(await r.json()).data;
  };

  it("populated: Continue on the first key moment, the bank card (due, thumbs, top theme, next batch), the week, recent games", async () => {
    const m = await w.member("home");
    await w.persona(m, "bank-member");
    const h = await home(m);
    assert.equal(h.state, "populated");
    assert.equal(h.greeting.part, "evening");
    assert.equal(h.greeting.name, m.name);
    assert.ok(h.continue);
    assert.equal(h.continue!.kind, "moments");
    assert.ok(h.continue!.keyMomentCount > 0);
    assert.ok(h.continue!.lastMove, "the board shows the move before the moment");
    assert.equal(h.continue!.analysis.status, "done");
    assert.equal(h.bank.due, 4);
    assert.equal(h.bank.total, 41);
    assert.equal(h.bank.estMin, 3);
    assert.equal(h.bank.thumbs.length, 4);
    assert.ok(h.bank.topTheme && h.bank.topTheme.n > 0);
    assert.ok(h.bank.nextBatch);
    assert.equal(h.week.days.length, 7);
    assert.ok(h.recent.length > 0 && h.recent.length <= 8);
    assert.equal(h.startHere, null);
    assert.equal(h.import, null);
    assert.equal(h.hasLinkedAccount, false);
  });

  it("new_user: no games, no bank, no import; the legend position when one is featured; reads only", async () => {
    const m = await w.member("homenew");
    await w.persona(m, "home-new");
    const h = await home(m);
    assert.equal(h.state, "new_user");
    assert.equal(h.continue, null);
    assert.equal(h.recent.length, 0);
    assert.deepEqual(h.bank, { due: 0, total: 0, estMin: 0, topTheme: null, thumbs: [], nextBatch: null });
    assert.equal(h.week.aria, "No games yet this week");
    const featured = await w.db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM chess_positions WHERE "isActive" AND featured`);
    if (Number(featured[0]!.n) > 0) {
      assert.ok(h.startHere);
      assert.match(h.startHere!.href, /^\/position\/c[a-z0-9]+$/);
    } else {
      assert.equal(h.startHere, null);
    }
    const t = installTestDeps({ clock: WORLD_NOW.getTime() });
    try {
      const q = await countQueries(() => getHomeData(w.viewerOf(m), WORLD_NOW));
      assert.equal(q.writes, 0, `HOME-1 wrote: ${q.writeOps.join(", ")}`);
    } finally {
      t.restore();
    }
  });

  it("analysing, then clean: the newest game's analysis state drives Continue", async () => {
    const m = await w.member("homean");
    const rep = await w.persona(m, "bank-empty");
    const ref = Object.values(rep.gameRefs)[0]!;
    await w.db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'RUNNING' WHERE "referenceId" = ${ref}`);
    const running = await home(m);
    assert.equal(running.continue!.kind, "analysing");
    assert.equal(running.continue!.analysis.status, "running");
    assert.equal(running.state, "populated");
    await w.db.$executeRaw(Prisma.sql`UPDATE games SET "analysisStatus" = 'DONE' WHERE "referenceId" = ${ref}`);
    await w.db.$executeRaw(Prisma.sql`UPDATE game_players SET "momentsCount" = 0 WHERE "userId" = ${m.id}
      AND "gameId" = (SELECT id FROM games WHERE "referenceId" = ${ref})`);
    const clean = await home(m);
    assert.equal(clean.continue!.kind, "clean");
    assert.equal(clean.continue!.lastMove === null || Array.isArray(clean.continue!.lastMove), true);
  });

  it("import_running: P4's active run as the Home row (provider, counts)", async () => {
    const m = await w.member("homeimp");
    await w.persona(m, "home-new");
    const acc = await w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "updatedAt")
      VALUES (${m.id}, 'CHESSCOM', ${`ext-${m.ref}`}, 'knightowl_88', 'knightowl_88', now()) RETURNING id`);
    await w.db.$executeRaw(Prisma.sql`
      INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, phase, seen, total, imported, "startedAt", "updatedAt")
      VALUES (${`cimp${m.ref.slice(1, 22)}`}, ${m.id}, ${acc[0]!.id}, 'CHESSCOM', 'INITIAL', 'RUNNING', 'saving', 480, 480, 212,
              ${new Date(WORLD_NOW.getTime() - 120_000).toISOString()}::timestamptz AT TIME ZONE 'UTC', now())`);
    const h = await home(m);
    assert.deepEqual({ ...h.import, etaSec: undefined }, { provider: "chesscom", imported: 212, total: 480, etaSec: undefined });
    assert.ok(h.import!.etaSec !== null && h.import!.etaSec > 0);
    assert.equal(h.state, "populated", "an import running is not a new user");
  });

  it("a non-member → 402", async () => {
    const m = await w.member("homelapsed");
    await w.persona(m, "home-new");
    const r = await w.call("home", "GET", "/api/home", m, { viewer: nonMember(w, m) });
    assert.equal(r.res.status, 402);
  });
});
