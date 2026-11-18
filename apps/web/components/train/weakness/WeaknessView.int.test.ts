// The Weakness Profile page rendered from REAL rows (phase-06 plan §4, §12.2; the owner's "real data, not mocks" rule):
// members whose games, analyses, per-game inputs, Mistake Bank and snapshots were written by the product's own code
// (WP5's route world, test/api/weakness-world.ts: real CC0 Lichess games and oracle games graded by the worker's
// grader and written by the P3 seed writer, B-W1's inputs, the A6 bank path, the real computeWeakness() upsert) on a
// throwaway Postgres. Each member's payload comes from the real TR-5 route handler (route(), the DAL, the ETag), and
// the page's view renders it: ready, the drill config of its top row, orphaned computing, computing with analyses in
// flight, failed and insufficient (zero, few, preliminary). Skipped unless TEST_DATABASE_URL names a local database.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { analyzeDedupeKey, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueJobSql } from "@repo/db/jobs";
import { ok } from "@repo/contracts/http/envelope";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { weaknessWorld, WORLD_NOW, type Member } from "../../../test/api/weakness-world";

nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier.endsWith(".css") ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
});
(globalThis as unknown as { React: typeof React }).React = React;

const url = process.env.TEST_DATABASE_URL;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const DAY = 86_400_000;
const MIN = 60_000;
const later = (ms: number) => new Date(WORLD_NOW.getTime() + ms);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const noop = () => {};

describe("the weakness page on real rows (Postgres)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let view: typeof import("./WeaknessView");
  let vs: typeof import("@/features/train/weakness/view-state");
  let A: Member, O: Member, F: Member, C: Member, Z: Member, Y: Member, P: Member;
  let restoreFlag: (() => void) | null = null;

  async function payloadOf(m: Member): Promise<WeaknessPayload> {
    const r = await w.call("weakness", "GET", "/api/train/weakness", m, { now: WORLD_NOW });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    const body = await r.json();
    return ok(WeaknessPayload).parse(body).data;
  }

  function render(p: WeaknessPayload, selectedSlug: string | null = null): string {
    return renderToStaticMarkup(
      React.createElement(view.WeaknessView, {
        payload: p,
        view: vs.initialViewState("phase", p.status),
        selectedSlug,
        sheetMode: false,
        linked: false,
        drill: { size: 10, mix: true, onSize: noop, onMix: noop, onStart: noop, starting: false, emptyFromServer: false },
        recompute: { pending: false, failedAgain: false, eventId: null },
        handlers: {
          onToggleRow: noop,
          onToggleShowAll: noop,
          onTab: noop,
          onDrill: noop,
          onCloseDrill: noop,
          onPlanFollow: noop,
          onSeeProfile: noop,
          onRetry: noop,
          onIncludeBullet: noop,
          onImport: noop,
          onPlay: noop,
        },
      }),
    );
  }

  before(async () => {
    view = await import("./WeaknessView");
    vs = await import("@/features/train/weakness/view-state");
    await w.setup();
    // The `weakness` flag through WP5's test seam (FLAGS_OVERRIDE ignores a key the registry does not list yet: the
    // p06 registry file lands with WP7). Flags never gate the data: every read below is the real route on real rows.
    const { setWeaknessFlag } = await import("@/lib/train/weakness.server");
    restoreFlag = setWeaknessFlag(async () => true);
    // A: 62 real CC0 games + 30 oracle games, banked, a READY snapshot.
    A = await w.member("wv-a", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
    const aOpp = await w.member("wv-a-opp", { timeZone: "America/New_York", rating: 1410 });
    await w.playCc0(A, aOpp, { count: 62 });
    await w.playOracles(A, aOpp, { count: 30 });
    // O: 22 analysed blitz games, no snapshot, no job → orphaned (the page's auto-build).
    O = await w.member("wv-o");
    await w.playCc0(O, await w.member("wv-o-opp"), { count: 22, timeClasses: ["BLITZ"], spacingDays: 3 });
    // F: a failed build with no READY row.
    F = await w.member("wv-f", { timeZone: "Europe/London" });
    await w.playCc0(F, await w.member("wv-f-opp"), { count: 22, timeClasses: ["BLITZ"], from: 5, spacingDays: 2 });
    // C: 12 analysed + 13 imported games still queued for analysis → computing.
    C = await w.member("wv-c");
    const cOpp = await w.member("wv-c-opp");
    await w.playCc0(C, cOpp, { count: 12, timeClasses: ["BLITZ"], from: 20, spacingDays: 1.5, newestDaysAgo: 30 });
    const pending = await w.playCc0(C, cOpp, { count: 13, timeClasses: ["BLITZ"], from: 32, spacingDays: 0.5, newestDaysAgo: 1, analysed: false });
    for (const ref of pending) {
      const [g] = await w.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM games WHERE "referenceId" = ${ref}`);
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
    // Y: 3 analysed games (few); P: 14 analysed games with an INSUFFICIENT snapshot (preliminary); Z: no games.
    Y = await w.member("wv-y");
    await w.playCc0(Y, await w.member("wv-y-opp"), { count: 3, timeClasses: ["BLITZ"], from: 2, spacingDays: 4 });
    P = await w.member("wv-p");
    await w.playCc0(P, await w.member("wv-p-opp"), { count: 14, timeClasses: ["BLITZ"], from: 8, spacingDays: 4 });
    Z = await w.member("wv-z");

    const inputs = await w.computeInputs([A, O, F, C, Y, P]);
    assert.equal(inputs.failed, 0, inputs.failures.join("; "));
    await w.bank(A);
    const built = await w.recompute(A);
    assert.equal(built.draft.status, "READY");
    const pre = await w.recompute(P);
    assert.equal(pre.draft.status, "INSUFFICIENT");
    await w.failRecompute(F, later(-2 * DAY));
  });

  after(async () => {
    restoreFlag?.();
    await w.teardown();
  });

  it("ready: the headline, VERIFIED, rows with their real rates, the breakdown and the week plan", async () => {
    const p = await payloadOf(A);
    assert.equal(p.status, "ready");
    const html = render(p);
    const t = text(html);
    assert.match(html, /data-status="ready"/);
    assert.ok(p.headline && t.includes(p.headline.text), "the headline from the snapshot");
    assert.match(t, /VERIFIED/);
    assert.equal((html.match(/data-testid="weakness-row"/g) ?? []).length, p.top.length);
    for (const r of p.top) {
      assert.ok(t.includes(r.label), r.label);
      assert.match(html, new RegExp(`aria-label="You ${r.you.toFixed(1)} per 100 moves`));
    }
    const first = p.top[0]!;
    assert.ok(t.includes(first.where), "row 1 is open with its where line");
    assert.match(html, new RegExp(`href="/train/weakness/${first.slug}"[^>]*>Drill · ${first.inBank} in bank`));
    if (first.example) assert.match(html, /data-testid="weakness-example"/);
    assert.ok(p.breakdown && t.includes(p.breakdown.phase.sentence));
    for (const row of p.weekPlan) assert.ok(t.includes(row.label), row.label);
    if (p.more.length > 0) assert.match(t, new RegExp(`${p.more.length} more patterns? found\\. All ${p.top.length + p.more.length} have drills\\.`));
  });

  it("ready, drill config of the top row: the mix line agrees with the row's bank count and puzzle rating", async () => {
    const p = await payloadOf(A);
    const first = p.top[0]!;
    const t = text(render(p, first.slug));
    assert.match(t, /Selected/);
    const own = first.matchable ? Math.min(6, first.inBank) : Math.min(first.inBank, 10);
    if (first.matchable) assert.ok(t.includes(`${own} from your games + ${10 - own} matched Lichess puzzles`), t);
    else assert.ok(t.includes(`${own} from your games only (${first.inBank} in your bank)`), t);
  });

  it("orphaned: computing with the auto-build flag; computing: the real progress and ETA", async () => {
    const o = await payloadOf(O);
    assert.equal(o.status, "computing");
    assert.equal(o.progress?.orphaned, true);
    assert.match(render(o), /data-orphaned=""/);
    const c = await payloadOf(C);
    assert.equal(c.status, "computing");
    const t = text(render(c));
    assert.match(t, /Building your profile Analysing \d+ games/);
    assert.match(t, new RegExp(`${c.progress!.pct}% · (about \\d+ minutes left|about a minute left|about \\d+ hours left|Working…)`));
    assert.doesNotMatch(t, /Your profile is ready/);
  });

  it("failed: the failed panel with Retry", async () => {
    const f = await payloadOf(F);
    assert.equal(f.status, "failed");
    assert.match(text(render(f)), /We couldn’t build your profile .* Retry/);
  });

  it("insufficient: zero, few and preliminary from real counts", async () => {
    const z = await payloadOf(Z);
    assert.equal(z.status, "insufficient");
    assert.match(render(z), /data-sub="zero"/);
    const y = await payloadOf(Y);
    assert.equal(y.status, "insufficient");
    const yt = text(render(y));
    assert.match(yt, new RegExp(`${20 - y.games.analysed} more games and we can tell you`));
    assert.match(yt, /Nothing Yet/);
    const pre = await payloadOf(P);
    assert.equal(pre.status, "insufficient");
    const ph = render(pre);
    assert.match(ph, new RegExp(`aria-label="${Math.min(20, pre.games.analysed)} of 20 games analysed"`));
    if (pre.preliminary.length > 0) {
      assert.match(ph, /data-sub="preliminary"/);
      for (const r of pre.preliminary) assert.ok(text(ph).includes(`${r.label} Seen in ${r.seenIn} of ${r.of} games Preliminary`), r.label);
    }
  });
});
