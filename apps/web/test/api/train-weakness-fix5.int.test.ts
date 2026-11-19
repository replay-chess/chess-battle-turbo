/**
 * FIX-5 (Phase 6 staging re-check) on a real Postgres, through the product's pipelines (weakness-world.ts: real CC0
 * Lichess games graded and written as the worker writes them, the A6 bank, the snapshot from the real computeWeakness())
 * and the real route handlers:
 *   - regression: bank-button-backlog (item A case 3) — a member far over the daily cap whose oldest due cards are NEW
 *     ones (banked moments) beyond newPerDay, with reviews due after them: the bank's button number, its head and the
 *     session the click opens are one number (the due read let 50 NEW cards hide the reviews: "Review 7 Due" opened 5);
 *   - regression: home-hub-one-pick (item D) — with no READY profile, Home's line and the hub's "Most common in your
 *     bank" step name the same mistake pattern, and Home never calls a game phase a mistake (staging P22 "Middlegame is
 *     your most common mistake" beside "3 loose piece puzzles · Most common in your bank");
 *   - regression: weakness-row-order (item E) — the list says what its rows are ordered by: an own-only list ranks by
 *     points lost (the stored scores), which the shown rate per 100 moves need not follow (staging A: 3.1 above 3.2).
 * Skipped unless TEST_DATABASE_URL is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { AttemptsResult, BankPage, SessionPayload, TrainToday, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { themeInfo, themePluralLabel } from "@repo/chess-training/themes";
import { EMPTY_FILTER, bankSessionBody, ctaOf, poolOf, visibleRowsOf } from "@/components/train/bank/model";
import { listLabel } from "@/components/train/weakness/model";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request } from "../helpers/route-harness";
import { weaknessWorld, WEAKNESS_ENV, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const MIN = 60_000;
const DAY = 86_400_000;

describe("P6 FIX-5 bank backlog, one 'most common' pick, row order (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let K: Member, P: Member, O: Member;

  /** A GET route through the real handler (route(), the DAL, the flags). */
  async function get<T>(file: string, path: string, m: Member, schema: { parse: (x: unknown) => { data: T } }, now = WORLD_NOW): Promise<T> {
    const route = (await import(file)) as { GET: RouteHandler };
    const t = installTestDeps({ userId: `user_${m.ref}`, viewer: w.viewerOf(m), env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV }, clock: now.getTime() });
    try {
      const res = await route.GET(request(path), noParams({}));
      const raw = await res.text();
      assert.equal(res.status, 200, raw);
      return schema.parse(JSON.parse(raw)).data;
    } finally {
      t.restore();
    }
  }
  const bankPage = (m: Member, now: Date) => get("@/app/api/train/bank/route", "/api/train/bank?view=all", m, ok(BankPage), now);
  async function create(m: Member, body: unknown, now: Date) {
    const r = await w.call("sessions", "POST", "/api/train/sessions", m, { body, headers: { "Idempotency-Key": w.uuid() }, now });
    assert.ok(r.res.status === 201 || r.res.status === 200, await r.res.clone().text());
    return ok(SessionPayload).parse(await r.json()).data;
  }
  function good(s: SessionPayload, item: TrainItem, at: Date): AttemptIn {
    return {
      clientAttemptId: w.uuid(), sessionRef: s.ref, itemId: item.itemId, cardRef: item.cardRef, puzzleId: item.puzzleId, kind: item.kind,
      solved: true, firstTry: true, hintsUsed: 0, wrongMovesUci: [], solutionShown: false, timeMs: 9_000,
      grade: "good", suggestedGrade: "good", cardReps: item.cardReps, reviewedAt: at.toISOString(),
    };
  }

  before(async () => {
    await w.setup();
    K = await w.member("backlog", { timeZone: "UTC" });
    P = await w.member("onepick", { timeZone: "UTC" });
    O = await w.member("roworder", { timeZone: "Asia/Kolkata", rating: null, ratingBand: null });
    const opp = await w.member("fix5-opp");
    await w.playCc0(K, opp, { count: 60, from: 0, spacingDays: 0.5 });
    await w.playOracles(K, opp, { count: 30, spacingDays: 1 });
    await w.playCc0(P, opp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(P, opp, { count: 30, spacingDays: 2 });
    await w.playCc0(O, opp, { count: 40, timeClasses: ["BLITZ"], from: 10, spacingDays: 1.5 });
    await w.playOracles(O, opp, { count: 30, spacingDays: 2 });
    const inputs = await w.computeInputs([K, P, O]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    for (const m of [K, P, O]) {
      const n = await w.bank(m);
      assert.ok(n >= 10, `${m.name}'s moments banked: ${n}`);
    }
    assert.equal((await w.recompute(O)).draft.metrics.listMode, "own_only");
  });

  after(async () => {
    w.flags(true);
    await w.teardown();
  });

  it("regression: bank-button-backlog — NEW cards beyond newPerDay due before the reviews: button = head = session", async (t) => {
    // 12 banked cards solved through explicit picks (no cap): they become reviews due a few days later, behind the
    // older NEW backlog.
    const keys = (await w.db.$queryRaw<{ k: string }[]>(Prisma.sql`SELECT "itemKey" AS k FROM training_cards WHERE "userId" = ${K.id} AND deck = 'BANK' ORDER BY id LIMIT 12`)).map((r) => r.k);
    const t0 = new Date(WORLD_NOW.getTime() + DAY);
    const picks = await create(K, { kind: "bank", source: "solve_one", cardRefs: keys }, t0);
    const r = await w.call("attempts", "POST", "/api/train/attempts", K, { body: { attempts: picks.items.map((it, i) => good(picks, it, new Date(t0.getTime() + (i + 1) * MIN))) }, now: new Date(t0.getTime() + 20 * MIN) });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.ok(ok(AttemptsResult).parse(await r.json()).data.results.every((x) => x.status === "ok"));
    const later = new Date(WORLD_NOW.getTime() + 12 * DAY);
    const [mix] = await w.db.$queryRaw<{ fresh: number; reviews: number }[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE state = 'NEW')::int AS fresh, count(*) FILTER (WHERE state <> 'NEW')::int AS reviews
        FROM training_cards WHERE "userId" = ${K.id} AND deck = 'BANK' AND due <= ${later.toISOString().replace("Z", "")}::timestamp`);
    t.diagnostic(`due at +12 d: ${JSON.stringify(mix)}`);
    assert.ok(mix!.fresh > 50, `more than 50 NEW cards due: ${mix!.fresh}`);
    assert.ok(mix!.reviews >= 5, `reviews due behind them: ${mix!.reviews}`);
    const page = await bankPage(K, later);
    const cta = ctaOf(poolOf(page.rows, EMPTY_FILTER), visibleRowsOf(page.rows, EMPTY_FILTER), page.counts.due, page.start ?? null);
    assert.equal(cta.kind, "review");
    if (cta.kind !== "review") return;
    // The click first: the session the due queue really composes (the staging defect: fewer than the head said).
    const s = await create(K, bankSessionBody(EMPTY_FILTER, cta), later);
    assert.equal(s.items.length, page.counts.due, `the session the click opened holds ${s.items.length}, the head says ${page.counts.due}`);
    assert.deepEqual(page.start, { kind: "new", n: page.counts.due }, "the button's session is the head's count");
    assert.equal(cta.label, `Review ${s.items.length} Due · ~${Math.max(1, Math.round(0.75 * s.items.length))} min`);
  });

  it("regression: home-hub-one-pick — Home and the hub name one mistake pattern, never a phase", async () => {
    w.flags(false);
    try {
      const home = await get("@/app/api/home/route", "/api/home", P, ok(HomeData));
      const top = home.bank.topTheme;
      assert.ok(top, "the bank has cards");
      assert.notEqual(top.source, "phase", "a mistake pattern has cards");
      const [phaseCount] = await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT max("bankCount")::int AS n FROM theme_mastery WHERE "userId" = ${P.id} AND theme IN ('opening', 'middlegame', 'endgame')`);
      assert.ok((phaseCount?.n ?? 0) >= top.n, `a phase tag counts at least as many cards (${phaseCount?.n}) as the pattern (${top.n}): the staging case`);
      const isPattern = ["opening", "middlegame", "endgame"].every((p) => themePluralLabel(p) !== top.label);
      assert.ok(isPattern, `Home names a pattern: ${top.label}`);
      const today = await get("@/app/api/train/today/route", "/api/train/today", P, ok(TrainToday));
      const step = today.plan.steps.find((s) => s.kind === "puzzles")!;
      if (step.subtitle.startsWith("Most common in your bank")) {
        const theme = new URLSearchParams(step.href.split("?")[1]).get("theme")!;
        assert.equal(themePluralLabel(theme), top.label, `the hub's "most common" (${theme}) is Home's (${top.label})`);
        assert.notEqual(themeInfo(theme).kind, "phase");
      }
    } finally {
      w.flags(true);
    }
  });

  it("regression: weakness-row-order — the label names the order the rows follow (points lost), not the rate shown", async () => {
    const r = await w.call("weakness", "GET", "/api/train/weakness", O);
    assert.equal(r.res.status, 200, await r.res.clone().text());
    const p = ok(WeaknessPayload).parse(await r.json()).data;
    assert.equal(p.listMode, "own_only");
    const [snap] = await w.db.$queryRaw<{ metrics: { rows: { pattern: string; score: number; lossYou100: number }[] } }[]>(Prisma.sql`
      SELECT metrics FROM weakness_snapshots WHERE "userId" = ${O.id} ORDER BY "weekStart" DESC LIMIT 1`);
    const stored = snap!.metrics.rows;
    assert.deepEqual([...p.top, ...p.more].map((x) => x.pattern), stored.map((x) => x.pattern), "the page shows the stored order");
    for (let i = 1; i < stored.length; i++) assert.ok(stored[i - 1]!.score >= stored[i]!.score, "ranked by points lost (score = lossYou100)");
    assert.equal(listLabel(p, false), `Top ${p.top.length} by points lost · per 100 moves`);
  });
});
