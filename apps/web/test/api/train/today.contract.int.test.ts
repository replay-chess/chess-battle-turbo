/**
 * R1 `GET /api/train/today`, R4 `GET /api/train/themes` and R8 `GET /api/me/badges` on a real Postgres after
 * `prisma migrate deploy` (phase-05 plan §12.2 "R1 today"): the plan is created once and frozen across calls; two
 * concurrent first reads produce one plan (COALESCE); the training day rolls over at 04:00 local; a new member's plan;
 * GET purity (only R1's two registered `daily_plan` writes, none on the second call; R4 / R8 never write); the
 * response parses with the contract.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { Badges, ThemesResult, TrainToday } from "@repo/contracts/http/train";
import { countQueries, routeStatements } from "../../helpers/query-counter";
import { getTrainToday } from "@/lib/train/today.server";
import { count, trainWorld, WORLD_NOW } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

function writesOf(recorded: { logs: { message: string; context: Record<string, unknown> }[] }): number {
  const line = [...recorded.logs].reverse().find((l) => l.message === "api");
  return Number(line?.context.dbStatements ?? -1);
}

describe("P5 R1 today, R4 themes, R8 badges (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  it("bank-member: the hub's numbers, the plan frozen once, a second read writes nothing", async () => {
    const m = await w.member("today");
    await w.persona(m, "bank-member");
    await w.db.$executeRaw(Prisma.sql`UPDATE training_days SET plan = NULL WHERE "userId" = ${m.id}`);
    const first = await w.call("today", "GET", "/api/train/today", m);
    assert.equal(first.res.status, 200, await first.res.clone().text());
    assert.equal(first.res.headers.get("cache-control"), "private, no-store");
    const today = ok(TrainToday).parse(await first.json()).data;
    assert.equal(today.dayKey, "2026-11-12");
    assert.equal(today.weekdayLabel, "Thursday");
    assert.equal(today.due.shown, 4);
    assert.equal(today.due.raw, 4);
    assert.equal(today.due.cap, 10);
    assert.equal(today.allTraining.bank.total, 41);
    assert.equal(today.plan.total, 2);
    assert.equal(today.plan.done, 0);
    assert.equal(today.plan.steps[0]!.kind, "bank");
    assert.equal(today.plan.steps[0]!.status, "due");
    assert.equal(today.plan.steps[1]!.kind, "puzzles");
    assert.equal(today.plan.cta.kind, "start");
    assert.match(today.plan.cta.label, /^Start Today's Plan · ~\d+ min$/);
    assert.equal(today.plannedMinutes, today.plan.steps.reduce((s, x) => s + x.estMin, 0));
    assert.equal(today.streak.current, 4);
    assert.equal(today.streak.best, 9);
    assert.ok(today.due.preview.length > 0 && today.due.preview.length <= 4);
    assert.ok(today.nextBatch && today.nextBatch.count > 0, "a next batch is scheduled");
    assert.ok(today.mastery.length > 0);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_days WHERE "userId" = ${m.id} AND plan IS NOT NULL`), 1);

    const stored = await w.db.$queryRaw<{ plan: unknown }[]>(Prisma.sql`SELECT plan FROM training_days WHERE "userId" = ${m.id} AND day = '2026-11-12'`);
    const second = await w.call("today", "GET", "/api/train/today", m, { now: new Date(WORLD_NOW.getTime() + 60_000) });
    assert.equal(second.res.status, 200);
    assert.deepEqual(ok(TrainToday).parse(await second.json()).data.plan.steps, today.plan.steps, "the plan is frozen");
    const stored2 = await w.db.$queryRaw<{ plan: unknown }[]>(Prisma.sql`SELECT plan FROM training_days WHERE "userId" = ${m.id} AND day = '2026-11-12'`);
    assert.deepEqual(stored2, stored);
    assert.equal(second.recorded.logs.some((l) => l.message === "get_wrote"), false);
    assert.ok(writesOf(second.recorded) > 0);
  });

  it("GET purity: the first read of the day runs exactly the registered writes; R4 and R8 run none", async () => {
    const m = await w.member("purity");
    await w.persona(m, "train-plan");
    // Strict mode (NODE_ENV test): an undeclared GET write would throw GetWroteError → 500.
    const first = await w.call("today", "GET", "/api/train/today", m);
    assert.equal(first.res.status, 200, await first.res.clone().text());
    for (const [name, path] of [["themes", "/api/train/themes"], ["badges", "/api/me/badges"]] as const) {
      const r = await w.call(name, "GET", path, m);
      assert.equal(r.res.status, 200, `${name}: ${await r.res.clone().text()}`);
      assert.equal(r.recorded.logs.some((l) => l.message === "get_wrote"), false, name);
    }
    // The writes themselves, counted by the Prisma timing extension: the plan upsert and (no profile yet) the profile.
    const fresh = await w.member("purity2");
    await w.persona(fresh, "home-new");
    const once = await countQueries(() => getTrainToday(w.viewerOf(fresh), WORLD_NOW));
    assert.equal(once.writes, 2, `first read of the day: ${once.writeOps.join(", ")}`);
    const twice = await countQueries(() => getTrainToday(w.viewerOf(fresh), new Date(WORLD_NOW.getTime() + 1000)));
    assert.equal(twice.writes, 0, `second read: ${twice.writeOps.join(", ")}`);
    const themes = ok(ThemesResult).parse(await (await w.call("themes", "GET", "/api/train/themes", m)).json()).data;
    assert.ok(themes.options.length >= 6);
    assert.equal(themes.options.filter((o) => o.recommended).length <= 1, true);
    assert.equal(themes.options.find((o) => o.key === "fork")!.available > 0, true, "the committed manifest has fork puzzles near the rating");
    const badges = ok(Badges).parse(await (await w.call("badges", "GET", "/api/me/badges", m)).json()).data;
    assert.equal(badges.bankDue, 3);
    assert.equal(badges.trainDot, true);
    assert.equal(routeStatements((await w.call("badges", "GET", "/api/me/badges", m)).recorded), 1, "R8 is one statement");
  });

  it("two concurrent first reads produce one plan", async () => {
    const m = await w.member("race");
    await w.persona(m, "train-plan");
    await w.db.$executeRaw(Prisma.sql`DELETE FROM training_days WHERE "userId" = ${m.id}`);
    const [a, b] = await Promise.all([w.call("today", "GET", "/api/train/today", m), w.call("today", "GET", "/api/train/today", m)]);
    const pa = ok(TrainToday).parse(await a.json()).data;
    const pb = ok(TrainToday).parse(await b.json()).data;
    assert.deepEqual(pa.plan, pb.plan);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_days WHERE "userId" = ${m.id}`), 1);
  });

  it("the training day rolls over at 04:00 local: 03:59 is still yesterday, 04:01 builds a new day", async () => {
    const m = await w.member("rollover");
    await w.persona(m, "day-rollover");
    assert.equal(m.timeZone, "America/New_York");
    // 2026-11-13 03:59 in New York (EST, UTC−5) = 08:59Z.
    const before4 = await w.call("today", "GET", "/api/train/today", m, { now: new Date("2026-11-13T08:59:00.000Z") });
    assert.equal(ok(TrainToday).parse(await before4.json()).data.dayKey, "2026-11-12");
    const after4 = await w.call("today", "GET", "/api/train/today", m, { now: new Date("2026-11-13T09:01:00.000Z") });
    const t = ok(TrainToday).parse(await after4.json()).data;
    assert.equal(t.dayKey, "2026-11-13");
    assert.equal(t.weekdayLabel, "Friday");
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_days WHERE "userId" = ${m.id} AND day = '2026-11-13' AND plan IS NOT NULL`), 1);
  });

  it("a new member: an empty bank plans 'Import games' (or the last game's review) and the puzzle step; seeded profile", async () => {
    const m = await w.member("newbie");
    await w.persona(m, "home-new");
    const r = await w.call("today", "GET", "/api/train/today", m);
    assert.equal(r.res.status, 200, await r.res.clone().text());
    const t = ok(TrainToday).parse(await r.json()).data;
    assert.equal(t.plan.basis, "new");
    assert.equal(t.plan.steps[0]!.kind, "import");
    assert.equal(t.plan.steps[1]!.kind, "puzzles");
    assert.equal(t.state, "default");
    assert.equal(t.due.preview.length, 0);
    assert.equal(t.nextBatch, null);
    assert.equal(t.puzzleRating.provisional, true);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_profiles WHERE "userId" = ${m.id} AND "ratingSeeded"`), 1);
  });

  it("caught up: the cap is used, the state is nothingdue with the waiting line, the next batch is labelled", async () => {
    const m = await w.member("caught");
    await w.persona(m, "bank-caughtup");
    const t = ok(TrainToday).parse(await (await w.call("today", "GET", "/api/train/today", m)).json()).data;
    assert.equal(t.state, "nothingdue");
    assert.equal(t.due.shown, 0);
    assert.equal(t.due.preview.length, 0);
    assert.ok(t.nextBatch);
    assert.equal(t.nextBatch!.atLabel, "08:00");
  });
});
