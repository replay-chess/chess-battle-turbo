// Weakness Profile components (phase-06 plan §12.1 "WEB/components/train/weakness/*.test.tsx"; component tests are
// `*.test.ts` rendering with react-dom/server, interface check §0.1): the P8 lesson slots render only with a lesson
// (row link, drill-config row, week-plan row), RateBar's scale and names, and the copy of every sub-state of §4.4–§4.8,
// rendered from WP1's payload fixtures (built by the real buildPayload). Every state is also reached from rows in
// Postgres by the e2e personas (WP8); these tests pin the rendering of each payload shape.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { before, describe, it } from "node:test";
import type { WeaknessPayload, WeaknessRow } from "@repo/contracts/http/weakness";
import { weaknessPayloadFixture } from "./__fixtures__/payloads";
import { rateScaleMax } from "./model";

nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier.endsWith(".css") ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
});
(globalThis as unknown as { React: typeof React }).React = React;

type Mods = {
  view: typeof import("./WeaknessView");
  drill: typeof import("./DrillConfig");
  rate: typeof import("./RateBar");
  lesson: typeof import("./LessonLink");
  plan: typeof import("./WeekPlanCard");
  vs: typeof import("@/features/train/weakness/view-state");
};
let m: Mods;
before(async () => {
  m = {
    view: await import("./WeaknessView"),
    drill: await import("./DrillConfig"),
    rate: await import("./RateBar"),
    lesson: await import("./LessonLink"),
    plan: await import("./WeekPlanCard"),
    vs: await import("@/features/train/weakness/view-state"),
  };
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const noop = () => {};
const DRILL = { size: 10 as const, mix: true, onSize: noop, onMix: noop, onStart: noop, starting: false, emptyFromServer: false };
const HANDLERS = {
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
};

function renderView(p: WeaknessPayload, o: { selectedSlug?: string | null; flash?: boolean; showAll?: boolean; recompute?: Partial<import("./WeaknessView").RecomputeUi>; linked?: boolean } = {}): string {
  const view = { ...m.vs.initialViewState("phase", p.status), flash: o.flash ?? false, showAll: o.showAll ?? false };
  return renderToStaticMarkup(
    React.createElement(m.view.WeaknessView, {
      payload: p,
      view,
      selectedSlug: o.selectedSlug ?? null,
      sheetMode: false,
      linked: o.linked ?? false,
      drill: DRILL,
      recompute: { pending: false, failedAgain: false, eventId: null, ...o.recompute },
      handlers: HANDLERS,
    }),
  );
}

function renderDrill(row: WeaknessRow, o: { size?: 10 | 20; mix?: boolean; rating?: number | null; emptyFromServer?: boolean; starting?: boolean } = {}): string {
  return renderToStaticMarkup(
    React.createElement(m.drill.DrillConfig, {
      row,
      rating: o.rating === undefined ? 1512 : o.rating,
      controls: { ...DRILL, size: o.size ?? 10, mix: o.mix ?? true, emptyFromServer: o.emptyFromServer ?? false, starting: o.starting ?? false },
      layout: "inline",
    }),
  );
}

const ready = () => weaknessPayloadFixture("ready");
const row = (pattern: string, p = ready()) => [...p.top, ...p.more].find((r) => r.pattern === pattern)!;

describe("lesson slots (P8 hand-off, plan §7.6)", () => {
  it("LessonLink renders nothing without a lesson and the link with one", () => {
    assert.equal(renderToStaticMarkup(React.createElement(m.lesson.LessonLink, { lesson: null })), "");
    const html = renderToStaticMarkup(React.createElement(m.lesson.LessonLink, { lesson: { slug: "tal-vs-smyslov-1959", title: "Tal vs Smyslov, 1959", sub: "x" } }));
    assert.match(html, /href="\/learn\/lessons\/tal-vs-smyslov-1959\?from=weakness"/);
    assert.equal(text(html).trim(), "Legend lesson: Tal vs Smyslov, 1959");
  });

  it("the open row, the drill config and the week plan show the lesson only when the payload carries one", () => {
    const plain = renderView(ready());
    assert.doesNotMatch(plain, /Legend lesson/);
    const withLesson = weaknessPayloadFixture("ready", { lesson: true });
    const html = renderView(withLesson);
    assert.match(text(html), /Legend lesson: Tal vs Smyslov, 1959/, "row 1's lesson link");
    assert.match(html, /data-testid="weakness-plan-lesson"/, "the week plan's third row");
    assert.equal((html.match(/data-testid="weakness-plan-[a-z]+"/g) ?? []).length, 3);
    assert.doesNotMatch(renderDrill(row("fork")), /weakness-drill-lesson/);
    const cfg = renderDrill(row("fork", withLesson));
    assert.match(cfg, /data-testid="weakness-drill-lesson"/);
    assert.match(text(cfg), /Legend lesson: Tal vs Smyslov, 1959 A world champion’s forks, then play it out/);
  });
});

describe("RateBar (plan §4.6)", () => {
  it("scales every row on max(you, band) × 1.15 (min 1.0) and names both rates", () => {
    const p = ready();
    const scale = rateScaleMax([...p.top, ...p.more]);
    assert.equal(scale, 4.0 * 1.15);
    const html = renderToStaticMarkup(React.createElement(m.rate.RateBar, { row: p.top[0]!, scaleMax: scale, withBand: true }));
    assert.match(html, /role="img" aria-label="You 3\.1 per 100 moves, rating band 1\.6"/);
    assert.match(html, /width:67%/, "3.1 / 4.6");
    assert.match(html, /width:35%/, "1.6 / 4.6");
  });

  it("the time-pressure row says under 1 minute; without a band there is one bar", () => {
    const p = ready();
    const tp = renderToStaticMarkup(React.createElement(m.rate.RateBar, { row: p.top[2]!, scaleMax: 4.6, withBand: true }));
    assert.match(tp, /aria-label="You 4\.0 per 100 moves under 1 minute, rating band 2\.2"/);
    // regression: tp-unit-hidden (FIX-1): the unit is on screen too, not only in the accessible name.
    assert.match(tp, /data-testid="weakness-rate-unit"[^>]*>under 1 min</);
    const nb = renderToStaticMarkup(React.createElement(m.rate.RateBar, { row: p.top[0]!, scaleMax: 4.6, withBand: false }));
    assert.match(nb, /aria-label="You 3\.1 per 100 moves"/);
    assert.equal((nb.match(/h-\[5px\]/g) ?? []).length, 1);
    assert.doesNotMatch(nb, /weakness-rate-unit/);
  });
});

describe("S3 ready (plan §4.6)", () => {
  it("default: headline + VERIFIED, row 1 open with its where line and drill link, 3 rows, See all, 3 desktop tabs + Strengths", () => {
    const html = renderView(ready());
    const t = text(html);
    assert.match(t, /You lose most points to missed forks in the middlegame, especially with under a minute on your clock\./);
    assert.match(t, /VERIFIED/);
    assert.match(t, /Top 3 · per 100 moves, you vs players rated 1100–1300/);
    assert.equal((html.match(/data-testid="weakness-row"/g) ?? []).length, 3);
    assert.equal((html.match(/data-testid="weakness-row-body"/g) ?? []).length, 1);
    assert.match(t, /Middlegame · 7 of the last 20 games/);
    assert.match(html, /href="\/train\/weakness\/fork"[^>]*>Drill · 12 in bank/);
    assert.match(t, /2 more patterns found\. All 5 have drills\. See all/);
    assert.match(html, /aria-expanded="true"/);
    for (const tab of ["By phase", "Clock", "Openings", "Strengths"]) assert.match(t, new RegExp(tab));
    assert.match(t, /What you already do well/);
    assert.match(t, /Updated after every analysed game\. Patterns under 20 games are marked Preliminary\./);
    assert.match(t, /This week’s plan from your profile Drill missed forks 10 positions · 6 from your games \+ 4 matched puzzles/);
  });

  it("See all shows rows 4–5 and the link reads Show fewer", () => {
    const html = renderView(ready(), { showAll: true });
    assert.equal((html.match(/data-testid="weakness-row"/g) ?? []).length, 5);
    assert.match(text(html), /Show fewer/);
  });

  it("few patterns, none eligible, no band, no clock, updating", () => {
    const few = text(renderView(weaknessPayloadFixture("few_patterns")));
    assert.match(few, /Top 2 · per 100 moves, you vs players rated 1100–1300/);
    assert.doesNotMatch(few, /more patterns found/);
    const none = text(renderView(weaknessPayloadFixture("none_eligible")));
    assert.match(none, /Nothing stands out against players at your level\. Your mistakes are spread across many patterns\./);
    assert.match(none, /Most frequent in your games · per 100 moves/);
    const noBand = renderView(weaknessPayloadFixture("no_band"));
    assert.match(text(noBand), /Top 3 · per 100 moves /);
    assert.doesNotMatch(noBand, /rating band/);
    const noClock = renderView(weaknessPayloadFixture("no_clock"));
    assert.doesNotMatch(noClock, /data-testid="weakness-tab-clock"/);
    assert.match(text(noClock), /These games have no clock data, so there is no Clock tab\./);
    assert.match(text(renderView(weaknessPayloadFixture("ready_updating"))), /Updating with 4 new games…/);
  });

  it("drill mode: the selected row says Selected and holds the config, the others offer Drill", () => {
    const html = renderView(ready(), { selectedSlug: "fork" });
    assert.match(html, /data-mode="drill"/);
    assert.match(text(html), /Selected/);
    assert.match(html, /data-testid="weakness-drill-config"/);
    assert.equal((html.match(/data-testid="weakness-drill-other"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /data-wk-head/, "no accordion while configuring");
  });
});

describe("S4 drill config copy (plan §4.7)", () => {
  it("default, size 20, mix off", () => {
    const t = text(renderDrill(row("fork")));
    assert.match(t, /Drill missed forks/);
    assert.match(t, /6 from your games \+ 4 matched Lichess puzzles near 1512/);
    assert.match(t, /Start drill · 10 positions · ~5 min/);
    assert.match(text(renderDrill(row("fork"), { size: 20 })), /12 from your games \+ 8 matched Lichess puzzles near 1512.*Start drill · 20 positions · ~10 min/);
    assert.match(text(renderDrill(row("fork"), { mix: false })), /10 from your games only \(12 in your bank\)/);
    assert.match(text(renderDrill(row("hangingPiece"), { mix: false })), /7 from your games only \(7 in your bank\).*Start drill · 7 positions · ~4 min/);
  });

  it("time pressure and unmatched patterns disable the mix with their reason; zero own forces puzzles; nothing → empty", () => {
    const tp = renderDrill(row("rc:timePressure"));
    assert.match(text(tp), /Matched puzzles have no clock, so this drill uses your own positions only/);
    assert.match(tp, /data-mix="off"/);
    assert.match(tp, /disabled=""/);
    const un = renderDrill({ ...row("pin"), matchable: false, pattern: "rc:development" });
    assert.match(text(un), /No matching puzzles for this pattern/);
    const zero = renderDrill({ ...row("fork"), inBank: 0 });
    // regression: zero-own-copy-unnamed (plan §4.7): the sentence names the pattern.
    assert.match(text(zero), /All your fork positions are mastered; this drill uses matched puzzles/);
    // regression: zero-own-noun (FIX-2): the weakness's own noun, never P5's puzzle label ("loose piece").
    assert.match(text(renderDrill({ ...row("hangingPiece"), inBank: 0 })), /All your free-piece positions are mastered/);
    assert.doesNotMatch(text(renderDrill({ ...row("hangingPiece"), inBank: 0 })), /loose/i);
    assert.match(text(zero), /10 matched Lichess puzzles near 1512/);
    const empty = renderDrill({ ...row("rc:development"), inBank: 0 });
    assert.match(text(empty), /No positions to drill yet\. They’re added as your games are reviewed\./);
    assert.match(empty, /data-empty=""/);
    assert.match(text(renderDrill(row("fork"), { emptyFromServer: true })), /No positions to drill yet/);
    assert.match(text(renderDrill(row("fork"), { rating: null })), /matched Lichess puzzles at your level/);
  });

  it("starting: the CTA is busy and the controls are disabled", () => {
    const html = renderDrill(row("fork"), { starting: true });
    assert.match(html, /aria-busy="true"/);
  });
});

describe("S1 insufficient (plan §4.4)", () => {
  it("preliminary: tag, h2, meter, CTAs, two preliminary rows", () => {
    const html = renderView(weaknessPayloadFixture("insufficient"));
    const t = text(html);
    assert.match(html, /data-sub="preliminary"/);
    assert.match(t, /6 more games and we can tell you what keeps costing you points/);
    assert.match(html, /role="img" aria-label="14 of 20 games analysed"/);
    assert.match(t, /14 \/ 20 games analysed/);
    assert.match(html, /href="\/settings\/connected"[^>]*>Import games from Chess\.com or Lichess/);
    assert.match(t, /Or play 6 more games here/);
    assert.match(t, /Missed forks Seen in 5 of 14 games Preliminary/);
    assert.match(t, /Missed free pieces Seen in 3 of 14 games Preliminary/);
    assert.match(t, /Under 20 games a pattern can be chance\. How this is calculated/);
    assert.match(text(renderView(weaknessPayloadFixture("insufficient"), { linked: true })), /Check for new games/);
  });

  it("zero and few: their h2 and the empty state", () => {
    const zero = text(renderView(weaknessPayloadFixture("insufficient_zero")));
    assert.match(zero, /Play or import 20 games and we can tell you what keeps costing you points/);
    assert.match(zero, /Nothing Yet Patterns show after 5 analysed games\./);
    assert.match(zero, /Or play 20 more games here/);
    const few = text(renderView(weaknessPayloadFixture("insufficient_few")));
    assert.match(few, /17 more games and we can tell you/);
    assert.match(few, /Nothing Yet/);
  });

  it("bullet offer: the info banner and its button", () => {
    const html = renderView(weaknessPayloadFixture("bullet_offer"));
    assert.match(html, /role="status"[^>]*data-tone="info"|data-tone="info"[^>]*role="status"|role="status" data-tone="info"/);
    assert.match(text(html), /You have 64 bullet games from the last 6 months\. Include them\? Include bullet games/);
  });
});

describe("S2 computing (plan §4.5)", () => {
  it("progress: label, h2 with the first-20 line, the real ETA, the leave note, 4 steps", () => {
    const html = renderView(weaknessPayloadFixture("computing"));
    const t = text(html);
    assert.match(t, /Building your profile Analysing 60 games Your profile appears after the first 20; the rest keep improving it\./);
    assert.match(t, /38% · about 10 minutes left/);
    assert.doesNotMatch(t, /about a minute left/);
    assert.match(t, /You can leave this page\. We’ll show a dot on Train when it’s ready\./);
    assert.equal((html.match(/data-step="/g) ?? []).length, 4);
    assert.match(t, /Import 480 games , in progress/);
    assert.match(html, /role="status" aria-live="polite" class="sr-only"[^>]*>Profile 25% built</);
  });

  it("stalled and the capped target", () => {
    assert.match(text(renderView(weaknessPayloadFixture("computing_stalled"))), /Taking longer than usual\. We’ll keep going in the background\./);
    assert.match(text(renderView(weaknessPayloadFixture("computing_almost"))), /Analysing your 100 newest games/);
  });

  it("the ready flash", () => {
    const t = text(renderView(ready(), { flash: true }));
    assert.match(t, /Ready Your profile is ready You lose most points to missed forks.* See your weakness profile/);
  });
});

describe("S5 failed (plan §4.8)", () => {
  it("default, failed again with the Event ID", () => {
    const t = text(renderView(weaknessPayloadFixture("failed")));
    assert.match(t, /We couldn’t build your profile Something went wrong while comparing your games\. Your games and Mistake Bank are fine\. Retry How this is calculated/);
    const again = text(renderView(weaknessPayloadFixture("failed"), { recompute: { failedAgain: true, eventId: "7f3a9c21" } }));
    assert.match(again, /If this keeps happening, contact hello@playchess\.tech Event ID 7f3a9c21/);
  });
});

describe("WeekPlanCard", () => {
  it("renders nothing without rows", () => {
    assert.equal(renderToStaticMarkup(React.createElement(m.plan.WeekPlanCard, { rows: [], onFollow: noop })), "");
  });
});
