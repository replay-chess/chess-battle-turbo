// Phase-03 plan §7.1, §7.2 (D1): the legend, share, practice and archive contracts, and the widened bot `complete`
// response. Every fixture parses; the rules the routes rely on (share code alphabet, one practice source, csv
// filters, the G1 limit, the keyset meta) hold.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  COMPLETE_RESPONSE_LEGEND_FIXTURE,
  gamesPageMetaFixture,
  gameRowFixtures,
  LEGEND_SUMMARY_VARIANTS,
  legendCompareFixture,
  legendSummaryFixture,
  practiceContextFixture,
  shareFixture,
} from "./fixtures/review";
import {
  CompleteResponse,
  GameRowDTO,
  GAMES_PAGE_LIMIT,
  gamesFilterOf,
  gamesFilterToSearch,
  GamesListResponse,
  GamesPageMeta,
  GamesQuery,
} from "./games";
import { LEGEND_COMPUTE_MAX_ATTEMPTS, LegendCompareDTO, LegendCompareQuery, legendComparePath, StaticExplanation } from "./legend";
import { PracticeContextDTO, PracticeQuery, practiceTargetOf, practiceFromGamePath, practiceFromFenPath } from "./practice";
import { LegendSummaryDTO } from "./review";
import {
  encodeShareCode,
  SHARE_CODE_ALPHABET,
  shareCacheTag,
  ShareCode,
  ShareCreateBody,
  ShareDTO,
  shareImageFilename,
  shareImagePath,
  sharePagePath,
  ShareUpdateBody,
} from "./share";

const ok = (schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } }, value: unknown, label = "") => {
  const r = schema.safeParse(value);
  assert.equal(r.success, true, `${label} ${r.success ? "" : r.error?.message}`);
};

describe("legend contracts (A2 summary, A9, A9b)", () => {
  for (const variant of LEGEND_SUMMARY_VARIANTS) {
    it(`the ${variant} summary parses`, () => ok(LegendSummaryDTO, legendSummaryFixture(variant), variant));
  }

  it("a followed summary has no divergence and no replay link; a diverged one replays from the split", () => {
    const followed = legendSummaryFixture("followed");
    assert.equal(followed.divergence, null);
    assert.equal(followed.replayHref, null);
    const diverged = legendSummaryFixture("diverged");
    assert.equal(diverged.replayHref, practiceFromGamePath("cm3kb2v4d000bslzp6q1m8r3t", diverged.divergence!.ply));
    assert.equal(LegendSummaryDTO.safeParse({ ...diverged, rows: Array(7).fill(diverged.rows[0]) }).success, false, "≤ 6 rows");
  });

  it("A9 parses with and without the explanation, and pending evals", () => {
    ok(LegendCompareDTO, legendCompareFixture(), "default");
    ok(LegendCompareDTO, legendCompareFixture({ withExplanation: true }), "include=explanation");
    ok(LegendCompareDTO, legendCompareFixture({ hasExplanation: false }), "no_explanation");
    const pending = legendCompareFixture({ status: "facts_ready" });
    ok(LegendCompareDTO, pending, "facts_ready");
    assert.equal(pending.evalAtDivergence, null);
    assert.equal(LegendCompareDTO.safeParse({ ...pending, attempts: LEGEND_COMPUTE_MAX_ATTEMPTS + 1 }).success, false);
    assert.equal(LegendCompareDTO.safeParse({ ...pending, status: "FACTS_READY" }).success, false, "lowercase wire status");
  });

  it("the default A9 payload stays small; the explanation is opt-in", () => {
    const base = Buffer.byteLength(JSON.stringify(legendCompareFixture()), "utf8");
    assert.ok(base <= 4_096, `A9 is ${base} B (≤ 4 KB, §9.6)`);
    assert.equal(legendCompareFixture().explanation, null);
    assert.deepEqual(LegendCompareQuery.parse({ include: "explanation" }), { include: "explanation" });
    assert.equal(LegendCompareQuery.safeParse({ include: "everything" }).success, false);
  });

  it("the static explanation accepts authored visuals and keeps unknown presentation keys", () => {
    const parsed = StaticExplanation.parse({
      fen: "8/8/8/8/8/8/8/8 w - - 0 1",
      segments: [{ visuals: [{ type: "annotateSquare", square: "e4", symbol: "!!", icon: "brilliant_128x.png", pulse: true }], narration: "x", startTime: 0, endTime: 2 }],
    });
    assert.equal((parsed.segments[0]!.visuals[0] as Record<string, unknown>).pulse, true);
    assert.equal(StaticExplanation.safeParse({ fen: "x", segments: [{ visuals: [{ type: "confetti" }], narration: "", startTime: 0, endTime: 1 }] }).success, false);
  });

  it("legendComparePath", () => {
    assert.equal(legendComparePath("cm3kb2v4d000bslzp6q1m8r3t"), "/review/cm3kb2v4d000bslzp6q1m8r3t/legend");
    assert.equal(legendComparePath("cm3kb2v4d000bslzp6q1m8r3t", { tab: "practice", ply: 4 }), "/review/cm3kb2v4d000bslzp6q1m8r3t/legend?tab=practice&ply=4");
  });
});

describe("share contracts (A10, A11, /r)", () => {
  it("codes are 8 lowercase Crockford base32 chars from 5 bytes", () => {
    assert.equal(SHARE_CODE_ALPHABET.length, 32);
    for (const banned of "ilou") assert.equal(SHARE_CODE_ALPHABET.includes(banned), false, banned);
    for (let i = 0; i < 2_000; i++) ok(ShareCode, encodeShareCode(randomBytes(5)));
    assert.equal(encodeShareCode(new Uint8Array([0, 0, 0, 0, 0])), "00000000");
    assert.equal(encodeShareCode(new Uint8Array([255, 255, 255, 255, 255])), "zzzzzzzz");
    assert.equal(encodeShareCode(new Uint8Array([0, 0, 0, 0, 33])), "00000011");
    assert.throws(() => encodeShareCode(new Uint8Array(4)), /5 bytes/);
    for (const bad of ["K7M2X9QA", "k7m2x9q", "k7m2x9qau", "k7m2x9ql", "../../x"]) assert.equal(ShareCode.safeParse(bad).success, false, bad);
  });

  it("A10 defaults showUsername on; A11 takes only the toggle", () => {
    assert.deepEqual(ShareCreateBody.parse({}), { showUsername: true, from: "review_menu" });
    assert.deepEqual(ShareCreateBody.parse({ showUsername: false, momentPly: 36 }), { showUsername: false, momentPly: 36, from: "review_menu" });
    assert.equal(ShareUpdateBody.safeParse({ showUsername: false, expiresAt: "2030-01-01T00:00:00.000Z" }).success, false);
    ok(ShareDTO, shareFixture());
    ok(ShareDTO, shareFixture({ showUsername: false, imageVersion: 4 }));
  });

  it("one spelling of the page, image, tag and file name", () => {
    assert.equal(sharePagePath("k7m2x9qa"), "/r/k7m2x9qa");
    assert.equal(shareImagePath("k7m2x9qa", 3), "/r/k7m2x9qa/og?v=3");
    assert.equal(shareImagePath("k7m2x9qa", 3, { download: true }), "/r/k7m2x9qa/og?v=3&download=1");
    assert.equal(shareCacheTag("k7m2x9qa"), "share:k7m2x9qa");
    assert.equal(shareImageFilename("k7m2x9qa"), "replaychess-review-k7m2x9qa.png");
    assert.ok(shareFixture({ imageVersion: 3 }).imageUrl.endsWith(shareImagePath("k7m2x9qa", 3)));
  });
});

describe("practice contracts (PR1)", () => {
  it("takes exactly one source; ply only with a game", () => {
    assert.deepEqual(practiceTargetOf(PracticeQuery.parse({ game: "cm3kb2v4d000bslzp6q1m8r3t", ply: "4" })), {
      source: "game",
      game: "cm3kb2v4d000bslzp6q1m8r3t",
      ply: 4,
    });
    assert.equal(practiceTargetOf(PracticeQuery.parse({ position: "cm1z0p8k40001ls8dq7n2v5wa" })).source, "position");
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    assert.equal(practiceTargetOf(PracticeQuery.parse({ fen })).source, "fen");
    assert.equal(PracticeQuery.safeParse({}).success, false);
    assert.equal(PracticeQuery.safeParse({ game: "cm3kb2v4d000bslzp6q1m8r3t", fen }).success, false);
    assert.equal(PracticeQuery.safeParse({ position: "cm1z0p8k40001ls8dq7n2v5wa", ply: "3" }).success, false);
    assert.equal(PracticeQuery.safeParse({ fen: "not a fen" }).success, false);
    assert.equal(practiceFromFenPath(fen), `/practice?fen=${encodeURIComponent(fen)}`);
  });

  it("the context parses for each source", () => {
    for (const source of ["game", "position", "fen"] as const) ok(PracticeContextDTO, practiceContextFixture(source), source);
  });
});

describe("archive contracts (G1)", () => {
  it("every row fixture parses; a page holds at most 30 rows", () => {
    const rows = gameRowFixtures();
    for (const row of rows) ok(GameRowDTO, row, row.ref);
    ok(GamesListResponse, rows);
    assert.equal(GamesListResponse.safeParse(Array(GAMES_PAGE_LIMIT + 1).fill(rows[0])).success, false);
    const statuses = new Set(rows.map((r) => r.analysisStatus));
    for (const s of ["none", "queued", "running", "done", "failed", "skipped"]) assert.ok(statuses.has(s as never), s);
  });

  it("meta: counts on page 1, only the cursor later", () => {
    ok(GamesPageMeta, gamesPageMetaFixture("first"));
    ok(GamesPageMeta, gamesPageMetaFixture("later"));
    ok(GamesPageMeta, gamesPageMetaFixture("last"));
    assert.equal(gamesPageMetaFixture("later").filteredTotal, undefined);
  });

  it("the query: limit 0…30 default 30, moments as a string boolean, search ≤ 40", () => {
    assert.equal(GamesQuery.parse({}).limit, 30);
    assert.equal(GamesQuery.parse({ limit: "0" }).limit, 0);
    assert.equal(GamesQuery.safeParse({ limit: "31" }).success, false);
    assert.equal(GamesQuery.parse({ moments: "1" }).moments, true);
    assert.equal(GamesQuery.parse({ moments: "0" }).moments, false, "never Boolean('0')");
    assert.equal(GamesQuery.safeParse({ q: "x".repeat(41) }).success, false);
    assert.equal(GamesQuery.safeParse({ cursor: "not a cursor!" }).success, false);
  });

  it("the filter: csv parsed in canonical order, unknown values dropped, short searches ignored", () => {
    assert.deepEqual(gamesFilterOf({ result: "draw,win,won,WIN", tc: "rapid,blitz,untimed", moments: true, q: " pawnstorm " }), {
      q: "pawnstorm",
      result: ["win", "draw"],
      tc: ["blitz", "rapid"],
      moments: true,
    });
    assert.deepEqual(gamesFilterOf({ result: "nope", tc: "", q: "a", moments: false }), {});
    assert.equal(gamesFilterToSearch(gamesFilterOf({ result: "draw,win", tc: "blitz", moments: true, q: "tal" })), "q=tal&result=win%2Cdraw&tc=blitz&moments=1");
    assert.deepEqual(gamesFilterOf(Object.fromEntries(new URLSearchParams("q=tal&result=win%2Cdraw&tc=blitz"))), { q: "tal", result: ["win", "draw"], tc: ["blitz"] });
  });
});

describe("the bot complete response (P3 widening, §5.8)", () => {
  it("always carries etaSec and comparison (pre-P3 replays answer `none`), and takes the P3 seed and legend block", () => {
    ok(CompleteResponse, { status: "ABORTED", outcome: "NONE", method: "aborted", analysis: { status: "none", etaSec: null }, comparison: null }, "pre-P3 replay");
    // Every server path sends both fields since E1, so the client never has to guess a missing block.
    assert.equal(CompleteResponse.safeParse({ status: "ABORTED", outcome: "NONE", method: "aborted", analysis: { status: "none" }, comparison: null }).success, false);
    assert.equal(CompleteResponse.safeParse({ status: "ABORTED", outcome: "NONE", method: "aborted", analysis: { status: "none", etaSec: null } }).success, false);
    ok(CompleteResponse, COMPLETE_RESPONSE_LEGEND_FIXTURE, "legend");
    ok(CompleteResponse, { status: "COMPLETED", outcome: "WHITE", method: "checkmate", analysis: { status: "skipped", etaSec: null }, comparison: null }, "short game");
    assert.equal(CompleteResponse.safeParse({ ...COMPLETE_RESPONSE_LEGEND_FIXTURE, analysis: { status: "QUEUED", etaSec: 3 } }).success, false);
    assert.equal(CompleteResponse.safeParse({ ...COMPLETE_RESPONSE_LEGEND_FIXTURE, analysis: { status: "queued", etaSec: -1 } }).success, false);
  });
});
