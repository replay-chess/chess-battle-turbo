/**
 * FIX-4 (Phase 6 staging browser pass) on a real Postgres, through the product's pipelines (weakness-world.ts: real CC0
 * Lichess games graded and written as the worker writes them, B-W1's inputs, the A6 bank, the snapshot from the real
 * computeWeakness()) and the real route handlers:
 *   - regression: weakness-wording-own-only (item 1, D-P6-FIX4-1) — a member with no rating band gets a READY
 *     `own_only` profile; Home and the hub's plan step name its top row as the member's most common mistake, never
 *     "top weakness" (staging: "Time-pressure blunders is your top weakness" beside "Nothing stands out");
 *   - regression: phase-no-band-reason (item 13) — that profile's By-phase sentence gives the true reason (no band), not
 *     "Not enough moves in each phase";
 *   - regression: weakness-pending-zero (item 10) — a member with no game in scope has nothing pending (it read 1).
 * Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { TrainToday } from "@repo/contracts/http/train";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { bankLine } from "@/components/home/copy";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request } from "../helpers/route-harness";
import { weaknessWorld, WEAKNESS_ENV, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

describe("P6 FIX-4 weakness wording, phase sentence, pending (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let O: Member, Z: Member;

  async function payloadOf(m: Member, now = WORLD_NOW) {
    const r = await w.call("weakness", "GET", "/api/train/weakness", m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(WeaknessPayload).parse(await r.json()).data;
  }
  /** A route through the real handler (route(), the DAL, FLAGS_OVERRIDE through the real flag evaluation). */
  async function get<T>(file: "home" | "today", m: Member, schema: { parse: (x: unknown) => { data: T } }, now = WORLD_NOW): Promise<T> {
    const route = (await import(file === "home" ? "@/app/api/home/route" : "@/app/api/train/today/route")) as { GET: RouteHandler };
    const t = installTestDeps({ userId: `user_${m.ref}`, viewer: w.viewerOf(m), env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV }, clock: now.getTime() });
    try {
      const res = await route.GET(request(file === "home" ? "/api/home" : "/api/train/today"), noParams({}));
      const raw = await res.text();
      assert.equal(res.status, 200, raw);
      return schema.parse(JSON.parse(raw)).data;
    } finally {
      t.restore();
    }
  }

  before(async () => {
    await w.setup();
    // O: no rated games and no onboarding band, so no rating band: the engine ranks the member's own losses.
    O = await w.member("ownonly", { timeZone: "Asia/Kolkata", rating: null, ratingBand: null });
    const oOpp = await w.member("ownonly-opp");
    await w.playCc0(O, oOpp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(O, oOpp, { count: 30, spacingDays: 2 });
    // Z: a member with no game at all.
    Z = await w.member("zero", { timeZone: "Europe/Berlin" });
    const inputs = await w.computeInputs([O]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    assert.ok((await w.bank(O)) >= 10, "O's moments banked");
    const built = await w.recompute(O);
    assert.equal(built.draft.status, "READY");
    assert.equal(built.draft.metrics.listMode, "own_only", "no band: an own-only list");
  });

  after(async () => {
    w.flags(true);
    await w.teardown();
  });

  it("regression: weakness-wording-own-only — Home and the hub name the own-only profile's top row as the most common mistake", async () => {
    const p = await payloadOf(O);
    assert.equal(p.status, "ready");
    assert.equal(p.listMode, "own_only");
    assert.equal(p.band, null);
    const top = p.top[0]!;
    assert.ok(top.inBank > 0, `the top row has cards in the bank: ${top.label} ${top.inBank}`);

    const home = await get("home", O, ok(HomeData));
    assert.deepEqual(home.bank.topTheme, { label: top.label, n: top.inBank, source: "profile" });
    if (home.bank.due > 0) assert.equal(bankLine(home.bank, false), `${top.label} is your most common mistake (${top.inBank} in bank).`);
    assert.doesNotMatch(bankLine(home.bank, false), /weakness/);

    const today = await get("today", O, ok(TrainToday));
    assert.equal(today.plan.basis, "games20", "the plan is built from the profile");
    const step = today.plan.steps.find((s) => s.kind === "puzzles")!;
    assert.match(step.subtitle, /^(Your most common mistake|Common in your games) · rating \d+ · ~\d+ min$/, step.subtitle);
    assert.doesNotMatch(step.subtitle, /weakness/i, "an own-only profile is never called a weakness, nor 'From your Weakness Profile'");
    assert.equal(today.allTraining.weakness?.label, top.label, "the hub row names the same pattern (no ranking words)");
  });

  it("regression: phase-no-band-reason — with no band the By-phase sentence says so, not 'Not enough moves'", async () => {
    const p = await payloadOf(O);
    const rows = p.breakdown!.phase.rows;
    assert.ok(rows.some((r) => r.you !== null), "the member has phase accuracies");
    assert.ok(rows.every((r) => r.band === null), "and no band values");
    assert.equal(p.breakdown!.phase.sentence, "Accuracy by phase. There is no rating band to compare you with yet.");
  });

  it("regression: weakness-pending-zero — no game in scope: nothing pending", async () => {
    const p = await payloadOf(Z);
    assert.equal(p.status, "insufficient");
    assert.deepEqual([p.games.inScope, p.games.analysed, p.games.pending], [0, 0, 0]);
  });
});
