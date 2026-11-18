/**
 * P6 lights up on a real Postgres (phase-06 plan §7.1.5, §1.2 T10/T12, §12.6; WP7): the Train hub's "Weakness drills"
 * row, the plan's focus and "Built from your last 20 games." footnote, the Home bank card's top-weakness line, the
 * badges' `weaknessReady` (R8 and the one-statement /api/me), and P5's bodies with the flag off or without a READY
 * profile. The real route handlers (route(), the DAL, FLAGS_OVERRIDE through the real flag evaluation) read rows that
 * went through the product's pipelines (test/api/weakness-world.ts): real CC0 Lichess games and the oracle games,
 * graded and written as the worker writes them, B-W1's per-game inputs, the Mistake Bank through A6 and B-W2's
 * time-pressure tag, and snapshots computed by the real `computeWeakness()` over the rows read back from Postgres.
 * The hub and Home components are rendered from those payloads.
 *   A  (Asia/Kolkata, R1200_1600)  92 games vs B, banked, READY snapshot (version 1, unseen)
 *   B  (America/New_York)          the other side of those games: no snapshot, no bank
 *   I  (UTC)                       8 analysed blitz games, an INSUFFICIENT snapshot
 * Skipped unless TEST_DATABASE_URL (local) is set; throwaway databases only.
 */
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { MeData } from "@repo/contracts/http/me";
import { Badges, TrainToday } from "@repo/contracts/http/train";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { weaknessMatchTheme } from "@repo/chess-training/weakness/drill";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request } from "../helpers/route-harness";
import { count, weaknessWorld, WEAKNESS_ENV, WORLD_NOW, type Member } from "./weakness-world";

nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier.endsWith(".css") ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
});
(globalThis as unknown as { React: typeof React }).React = React;

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const DAY = 86_400_000;
const later = (ms: number) => new Date(WORLD_NOW.getTime() + ms);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const ROUTES = {
  today: "app/api/train/today/route",
  home: "app/api/home/route",
  badges: "app/api/me/badges/route",
  me: "app/api/me/route",
} as const;
type Name = keyof typeof ROUTES;

describe("P6 lights up (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  const H = {} as Record<Name, { GET: RouteHandler }>;
  let A: Member, B: Member, I: Member;
  let readyTop: WeaknessPayload["top"][number];
  let readyRows: WeaknessPayload["top"];
  let listMode: WeaknessPayload["listMode"];

  /** A GET through the real route handler (route(), auth seam, request clock); returns the raw 200 body. */
  async function call(name: Name, path: string, m: Member, o: { now?: Date; viewer?: Viewer } = {}): Promise<{ raw: string }> {
    const t = installTestDeps({
      userId: `user_${m.ref}`,
      viewer: o.viewer ?? w.viewerOf(m),
      env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV },
      clock: (o.now ?? WORLD_NOW).getTime(),
    });
    try {
      const res = await H[name].GET(request(path), noParams({}));
      const raw = await res.text();
      assert.equal(res.status, 200, `${path}: ${raw}`);
      return { raw };
    } finally {
      t.restore();
    }
  }
  const today = async (m: Member, now: Date) => {
    const r = await call("today", "/api/train/today", m, { now });
    return { data: ok(TrainToday).parse(JSON.parse(r.raw)).data, raw: r.raw };
  };
  const home = async (m: Member, now: Date) => {
    const r = await call("home", "/api/home", m, { now });
    return { data: ok(HomeData).parse(JSON.parse(r.raw)).data, raw: r.raw };
  };
  const badges = async (m: Member, now = WORLD_NOW) => {
    const r = await call("badges", "/api/me/badges", m, { now });
    return { data: ok(Badges).parse(JSON.parse(r.raw)).data, raw: r.raw };
  };
  /** The live BANK cards of `m` whose mistake carries `pattern` (Q-W2 re-counted). */
  const inBank = (m: Member, pattern: string) =>
    count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards c JOIN mistakes mi ON mi.id = c."mistakeId"
      WHERE c."userId" = ${m.id} AND c.deck = 'BANK' AND mi."hiddenAt" IS NULL AND ${pattern} = ANY(mi.themes)`);

  before(async () => {
    await w.setup();
    for (const [name, file] of Object.entries(ROUTES)) H[name as Name] = (await import(`@/${file}`)) as { GET: RouteHandler };

    A = await w.member("lit-a", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    B = await w.member("lit-b", { timeZone: "America/New_York", rating: 1410 });
    await w.playCc0(A, B, { count: 62 });
    await w.playOracles(A, B, { count: 30 });
    I = await w.member("lit-i");
    const iOpp = await w.member("lit-i-opp");
    await w.playCc0(I, iOpp, { count: 8, timeClasses: ["BLITZ"], from: 40, spacingDays: 3 });

    const inputs = await w.computeInputs([A, B, I]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    const banked = await w.bank(A);
    assert.ok(banked >= 40, `${banked} of A's moments banked`);
    const built = await w.recompute(A);
    assert.equal(built.draft.status, "READY", "A's real games make a READY profile");
    assert.equal(built.version, 1);
    const insufficient = await w.recompute(I);
    assert.equal(insufficient.draft.status, "INSUFFICIENT", "8 analysed games are not enough");

    // TR-5's own rows for A (the profile page's payload): the lit slots must say the same.
    const r = await w.call("weakness", "GET", "/api/train/weakness", A, { now: WORLD_NOW });
    assert.equal(r.res.status, 200);
    const p = ok(WeaknessPayload).parse(await r.json()).data;
    assert.equal(p.status, "ready");
    readyRows = [...p.top, ...p.more];
    listMode = p.listMode;
    readyTop = p.top[0]!;
  });

  after(async () => {
    await w.teardown();
  });

  // ── Flag off: P5, byte for byte ───────────────────────────────────────────────────────────────────────────────
  describe("flag off", () => {
    before(() => w.flags(false));

    it("the hub (R1): no weakness row, no games20 basis, P5's footnote, even with a READY profile", async () => {
      const { data, raw } = await today(A, WORLD_NOW);
      assert.equal("weakness" in data.allTraining, false);
      assert.doesNotMatch(raw, /weakness|games20|last 20 games/i);
      assert.notEqual(data.plan.basis, "games20");
      assert.match(data.plan.footnote, /^Built from (your Mistake Bank|your games and puzzles)\. Daily cap: \d+ reviews?\.$/);
      assert.ok(!data.plan.steps.some((s) => /weakest theme/.test(s.subtitle)));
    });

    it("Home (HOME-1): the P5 bank line (no `source`)", async () => {
      const { data, raw } = await home(A, WORLD_NOW);
      assert.ok(data.bank.topTheme, "A has bank cards");
      assert.equal("source" in data.bank.topTheme!, false);
      assert.doesNotMatch(raw, /weakness/i);
      const { bankLine } = await import("@/components/home/copy");
      assert.doesNotMatch(bankLine(data.bank, false), /top weakness/);
    });

    it("badges (R8) and /api/me: P5's shape, no weaknessReady, the dot is the bank's", async () => {
      const { data } = await badges(A);
      assert.deepEqual(Object.keys(data).sort(), ["bankDue", "trainDot"]);
      assert.equal(data.trainDot, data.bankDue > 0);
      const me = await meOf(A);
      assert.deepEqual(Object.keys(me.badges ?? {}).sort(), ["bankDue", "trainDot"]);
    });
  });

  // ── Flag on ───────────────────────────────────────────────────────────────────────────────────────────────────
  describe("flag on", () => {
    before(() => w.flags(true));
    // A new local training day for A (WORLD_NOW is 00:30 in Kolkata, still the 17th's training day until 04:00), so
    // today's plan is built with the profile in place.
    const DAY2 = later(DAY);

    it("the hub: 'Weakness drills · {label} · {n} in your bank' linking the top drill; games20 and the weakness focus", async (t) => {
      const { data } = await today(A, DAY2);
      t.diagnostic(`rows: ${readyRows.map((r) => `${r.pattern} ${r.you}/${r.band} inBank ${r.inBank} match ${weaknessMatchTheme(r.pattern)}`).join("; ")}`);
      t.diagnostic(`hub: ${JSON.stringify(data.allTraining.weakness)} · ${data.plan.footnote} · ${data.plan.steps.map((s) => `${s.title} (${s.subtitle})`).join(" | ")}`);
      const n = await inBank(A, readyTop.pattern);
      assert.deepEqual(data.allTraining.weakness, {
        label: readyTop.label,
        inBank: n,
        href: `/train/weakness/${readyTop.slug}?from=hub`,
      });
      assert.equal(readyTop.inBank, n, "the profile page and the hub agree");
      assert.equal(data.plan.basis, "games20");
      assert.match(data.plan.footnote, /^Built from your last 20 games\. Daily cap: \d+ reviews?\.$/);
      // Step 2 (puzzles) focuses the first matchable row's Lichess theme (rct-b §3.5 rule 1).
      const focus = readyRows.map((r) => weaknessMatchTheme(r.pattern)).find((t): t is string => t !== null);
      const puzzles = data.plan.steps.find((s) => s.kind === "puzzles");
      assert.ok(puzzles, JSON.stringify(data.plan.steps));
      if (focus) {
        // regression: hub-two-weakest (FIX-2, D-P6-FIX2-10): "Your top weakness" only for the top row's own match in a
        // band comparison; a lower row's theme (or a most-frequent or own-only list, FIX-3 review item 7) reads "From your
        // Weakness Profile".
        const topIsFocus = readyRows[0] && weaknessMatchTheme(readyRows[0].pattern) === focus && listMode === "vs_band";
        assert.match(puzzles.subtitle, topIsFocus ? /^Your top weakness · / : /^From your Weakness Profile · /);
        assert.match(puzzles.href, new RegExp(`[?&]theme=${encodeURIComponent(focus)}(&|$)`));
      }
      // The plan is frozen for the day: a second read is the same plan, and writes nothing new.
      const again = await today(A, new Date(DAY2.getTime() + 60_000));
      assert.deepEqual(again.data.plan.steps.map((s) => s.href), data.plan.steps.map((s) => s.href));
      const rows = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_days WHERE "userId" = ${A.id} AND plan->>'basis' = 'games20'`);
      assert.equal(rows, 1);
    });

    it("the hub renders the row (and the mastery link when the screen passes it) from that payload", async () => {
      const { data } = await today(A, DAY2);
      const parts = await import("@/components/train/hub/parts");
      const list = renderToStaticMarkup(React.createElement(parts.AllTrainingList, { today: data }));
      assert.match(text(list), new RegExp(`Weakness drills ${escapeRe(readyTop.label)} · ${readyTop.inBank} in your bank`));
      assert.ok(list.includes(`href="/train/weakness/${readyTop.slug}?from=hub"`), list);
      const mastery = [{ key: "fork", label: "Forks", pct: 40 }];
      const withLink = renderToStaticMarkup(React.createElement(parts.ThemeMasteryBars, { mastery, weaknessHref: "/train/weakness?from=hub" }));
      assert.match(text(withLink), /Theme mastery Weakness profile/);
      const without = renderToStaticMarkup(React.createElement(parts.ThemeMasteryBars, { mastery }));
      assert.doesNotMatch(without, /Weakness/);
    });

    it("Home: '{label} is your top weakness ({n} in bank).' from the READY profile, rendered in the bank card", async (t) => {
      const { data } = await home(A, DAY2);
      t.diagnostic(`home: due ${data.bank.due}/${data.bank.total} · ${JSON.stringify(data.bank.topTheme)}`);
      assert.deepEqual(data.bank.topTheme, { label: readyTop.label, n: await inBank(A, readyTop.pattern), source: "weakness" });
      const { bankLine } = await import("@/components/home/copy");
      const line = bankLine(data.bank, false);
      if (data.bank.due > 0) assert.equal(line, `${readyTop.label} is your top weakness (${readyTop.inBank} in bank).`);
      const { BankCard } = await import("@/components/home/HomeView");
      const html = renderToStaticMarkup(React.createElement(BankCard, { bank: data.bank, isNew: false, track: {} }));
      assert.ok(text(html).includes(line), text(html));
    });

    it("badges: weaknessReady while version 1 > seen 0, and trainDot; /api/me says the same from its ONE statement", async (t) => {
      const { data } = await badges(A);
      t.diagnostic(`badges: ${JSON.stringify(data)}`);
      assert.equal(data.weaknessReady, true);
      assert.equal(data.trainDot, true);
      const me = await meOf(A);
      // The viewer statement counts due cards at the database's own clock, so /api/me is compared with R8 at the wall
      // clock (at WORLD_NOW the two differed once A's cards fell due in real time: regression lights-up-badges-clock).
      assert.deepEqual(me.badges, (await badges(A, new Date())).data);
      // B: no profile → not ready; the dot is the bank's alone.
      const b = (await badges(B)).data;
      assert.deepEqual(b, { bankDue: b.bankDue, trainDot: b.bankDue > 0, weaknessReady: false });
    });

    it("TR-13 (the profile was seen) clears weaknessReady; the dot falls back to the bank's due count", async () => {
      const seen = await w.call("seen", "POST", "/api/train/weakness/seen", A, { body: { version: 1 }, now: later(5_000) });
      assert.equal(seen.res.status, 204, await seen.res.clone().text());
      const { data } = await badges(A, later(10_000));
      assert.equal(data.weaknessReady, false);
      assert.equal(data.trainDot, data.bankDue > 0);
      assert.equal((await meOf(A)).badges?.weaknessReady, false);
    });

    it("no READY profile (none, or INSUFFICIENT): the hub and Home are P5's bytes; the flag adds nothing", async () => {
      for (const m of [B, I]) {
        w.flags(false);
        const offToday = await today(m, WORLD_NOW);
        const offHome = await home(m, WORLD_NOW);
        w.flags(true);
        const onToday = await today(m, WORLD_NOW);
        const onHome = await home(m, WORLD_NOW);
        assert.equal(onToday.raw, offToday.raw, `${m.name}: R1`);
        assert.equal(onHome.raw, offHome.raw, `${m.name}: HOME-1`);
        assert.equal("weakness" in onToday.data.allTraining, false);
      }
    });
  });

  /** /api/me for `m` with the viewer read by the real viewer statement (badge facts included), counting statements. */
  async function meOf(m: Member): Promise<MeData> {
    const { readViewerRecordById, toViewer } = await import("@/lib/auth/viewer");
    let statements = 0;
    const db = {
      $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => {
        statements++;
        return w.db.$queryRawUnsafe<T>(sql, ...values);
      },
    };
    const record = await readViewerRecordById(db, m.id);
    assert.ok(record);
    assert.equal(statements, 1, "the viewer (with the badge facts) is ONE statement");
    // The catalog only names plan keys (billing is not what this checks); the badges come from the record.
    const real = toViewer(record, { now: WORLD_NOW, paywallEnabled: false, catalog: { monthly: "pdt_m", yearly: "pdt_y", legacy: [] } });
    // The route's auth seam carries this viewer (the member fixture's entitlement, the real badges).
    const viewer: Viewer = { ...w.viewerOf(m), badges: real.badges };
    const r = await call("me", "/api/me", m, { viewer });
    return ok(MeData).parse(JSON.parse(r.raw)).data;
  }
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
