// Phase-03 plan §10.1 (TST X6): every P3 event is registered with a closed property set, accepts its documented
// shape, refuses extra keys and PII-shaped values, and the enums it repeats stay equal to the wire contracts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Drift guard only: the analytics package has no runtime dependency on the contracts package.
import { ANALYSIS_FAILURE_CODES as CT_FAILURE_CODES, ANALYSIS_STATUSES as CT_STATUSES, COMPARISON_STATUSES as CT_COMPARISON, JUDGEMENT_KEYS, PLAN_KEYS } from "../../../contracts/src/http/review";
import { ANALYZE_REASONS as CT_ANALYZE_REASONS, PRIORITY_BANDS as CT_BANDS } from "../../../contracts/src/internal/jobs";
import { EVENTS, findPii, parseEvent } from "../index";
import { gameEvents } from "./game";
import {
  ANALYSIS_FAILURE_CODES,
  ANALYSIS_STATUSES,
  ANALYZE_REASONS,
  bucket10,
  COMPARISON_STATUSES,
  countBucketOf,
  JUDGEMENTS,
  PLAN_CHIPS,
  PRIORITY_BANDS,
  reviewClientEvents,
  reviewEvents,
  reviewServerEvents,
} from "./review";
import { shellEvents } from "./shell";
import { systemEvents } from "./system";

const shareProps = { from: "complete", show_username: true };

const client: { [K in keyof typeof reviewClientEvents]: Record<string, unknown> } = {
  review_opened: { source: "game_over", status: "running", device: "phone" },
  review_summary_viewed: { accuracy_bucket: 80, moments: 3, is_clean: false },
  review_tab_switched: { tab: "moves" },
  eval_graph_jump: { ply_bucket: 30 },
  narration_played: { context: "summary", speed: 1 },
  narration_completed: { context: "moment", speed: 1.5 },
  review_started: { moments: 3 },
  moment_viewed: { idx: 1, judgement: "miss" },
  moment_attempt: { idx: 0, correct: true, attempt_no: 2, accepted_as: "alt" },
  moment_plan_picked: { idx: 2, chip: "defend", matched_intent: false },
  moment_revealed: { idx: 2, attempts: 3 },
  moment_show_line: { idx: 1 },
  review_completed: { moments: 3, found: 1, found_retry: 1, revealed: 1, duration_ms: 182_000 },
  drill_from_review_clicked: { mistakes: 3 },
  game_over_review_clicked: { status_at_click: "done", has_coach_line: true, legend: false },
  game_over_replay_clicked: { divergence_ply_bucket: 20 },
  analysis_retry_clicked: { code: "engine_failed", attempt: 2 },
  pgn_downloaded: { annotated: true },
  how_we_grade_viewed: { tab: "acc", from: "review" },
  share_opened: { from: "review_menu" },
  share_link_copied: shareProps,
  share_image_downloaded: shareProps,
  share_posted_x: shareProps,
  share_pgn_copied: shareProps,
  share_username_toggled: { from: "review_menu", show_username: false },
  share_revoked: shareProps,
  share_signup_clicked: {},
  games_archive_viewed: { count_bucket: "10-29", filters_active: 2 },
  games_archive_filtered: { result: ["win", "draw"], tc: ["blitz"], moments: true, q_len: 5, results_bucket: "2-9" },
  games_archive_game_opened: { analysed: true, target: "compare" },
  legend_compare_opened: { from: "game_over", status: "facts_ready" },
  compare_tab_viewed: { tab: "legend_moves", comparison_status: "ready" },
  compare_narration_played: { pct_listened: 40, speed: 0.75, audio_failed: false },
  practice_started: { from: "compare", ply_bucket: 20 },
  practice_action: { action: "hint2" },
};

const server: { [K in keyof typeof reviewServerEvents]: Record<string, unknown> } = {
  analysis_queued: { game_mode: "legend_bot", source: "replay", reason: "bot_end", priority: 80, queue_position: 0 },
  analysis_started: { wait_ms: 412, attempt: 1, resumed_from_ply: 0, priority: 80, band: "80+" },
  analysis_ready: {
    ms_from_game_end: 21_400,
    plies: 54,
    nodes_total: 7_210_000,
    cache_hit_ratio: 0.31,
    duration_ms: 19_800,
    pass2_positions: 6,
    moments_w: 3,
    moments_b: 1,
    clean_w: false,
    clean_b: false,
    regrade: false,
  },
  analysis_failed: { code: "worker_stalled", attempt: 2, failed_at_ply: 23, retryable: true },
  analysis_retry_succeeded: { code: "engine_failed", attempt: 3 },
  share_link_created: shareProps,
  share_page_viewed: { referrer_domain: "t.co", signed_in: false },
};

describe("review events", () => {
  for (const [name, sample] of Object.entries({ ...client, ...server })) {
    it(`${name} accepts its documented shape through the registry (with app_env)`, () => {
      assert.deepEqual(parseEvent(name, { ...sample, app_env: "dev", $lib: "web" }), { ok: true });
    });
    it(`${name} refuses extra keys`, () => {
      assert.equal(parseEvent(name, { ...sample, game_ref: "cm3k9x2p10007slzpqa8hd4fe" }).ok, false);
      assert.equal(parseEvent(name, { ...sample, fen: "8/8/8/8/8/8/8/8 w - - 0 1" }).ok, false);
    });
    it(`${name}'s documented sample carries no PII shapes`, () => {
      assert.deepEqual(findPii(sample), []);
    });
  }

  it("registers every P3 event of §10.1, and nothing collides with the P1/P2 registry", () => {
    const expected = [
      "analysis_queued", "analysis_started", "analysis_ready", "analysis_failed",
      "review_opened", "review_summary_viewed", "review_tab_switched", "eval_graph_jump",
      "narration_played", "narration_completed", "review_started", "moment_viewed", "moment_attempt",
      "moment_plan_picked", "moment_revealed", "moment_show_line", "review_completed", "drill_from_review_clicked",
      "game_over_review_clicked", "game_over_replay_clicked", "analysis_retry_clicked", "analysis_retry_succeeded",
      "pgn_downloaded", "how_we_grade_viewed",
      "share_opened", "share_link_created", "share_link_copied", "share_image_downloaded", "share_posted_x",
      "share_pgn_copied", "share_username_toggled", "share_revoked", "share_page_viewed", "share_signup_clicked",
      "games_archive_viewed", "games_archive_filtered", "games_archive_game_opened",
      "legend_compare_opened", "compare_tab_viewed", "compare_narration_played", "practice_started", "practice_action",
    ];
    assert.deepEqual(Object.keys(reviewEvents).sort(), [...expected].sort());
    const earlier = new Set([...Object.keys(shellEvents), ...Object.keys(systemEvents), ...Object.keys(gameEvents)]);
    for (const name of Object.keys(reviewEvents)) {
      assert.equal(earlier.has(name), false, `${name} collides with an earlier event`);
      assert.equal(EVENTS[name as keyof typeof EVENTS], reviewEvents[name as keyof typeof reviewEvents], name);
    }
  });

  it("buckets: plies and percentages are multiples of 10, counts are coarse", () => {
    assert.equal(parseEvent("eval_graph_jump", { ply_bucket: 37 }).ok, false);
    assert.equal(parseEvent("compare_narration_played", { pct_listened: 45, speed: 1, audio_failed: false }).ok, false);
    assert.equal(parseEvent("review_summary_viewed", { accuracy_bucket: 85, moments: 1, is_clean: false }).ok, false);
    assert.equal(parseEvent("review_summary_viewed", { accuracy_bucket: null, moments: 0, is_clean: true }).ok, true);
    assert.equal(bucket10(37), 30);
    assert.equal(bucket10(100), 100);
    assert.equal(bucket10(-4), 0);
    assert.deepEqual([0, 1, 2, 9, 10, 29, 30, 99, 100, 5_000].map(countBucketOf), [
      "0", "1", "2-9", "2-9", "10-29", "10-29", "30-99", "30-99", "100+", "100+",
    ]);
  });

  it("review narration speeds are the Web Speech rates 1 / 1.25 / 1.5 (plan §8.10); Compare's player keeps 0.75", () => {
    for (const speed of [1, 1.25, 1.5]) {
      assert.equal(parseEvent("narration_played", { context: "summary", speed }).ok, true, String(speed));
      assert.equal(parseEvent("narration_completed", { context: "moment", speed }).ok, true, String(speed));
    }
    assert.equal(parseEvent("narration_played", { context: "summary", speed: 0.75 }).ok, false);
    assert.equal(parseEvent("compare_narration_played", { pct_listened: 40, speed: 0.75, audio_failed: false }).ok, true);
    assert.equal(parseEvent("compare_narration_played", { pct_listened: 40, speed: 1.25, audio_failed: false }).ok, false);
  });

  it("share_page_viewed takes a bare host (or none), never a URL with a path", () => {
    for (const ok of ["none", "t.co", "news.ycombinator.com", "www.reddit.com"]) {
      assert.equal(parseEvent("share_page_viewed", { referrer_domain: ok, signed_in: true }).ok, true, ok);
    }
    for (const bad of ["https://t.co/abc", "t.co/abc", "localhost", "", "user@mail.com"]) {
      assert.equal(parseEvent("share_page_viewed", { referrer_domain: bad, signed_in: true }).ok, false, bad);
    }
  });

  it("games_archive_filtered records the search length, never the search text", () => {
    assert.equal(parseEvent("games_archive_filtered", { ...client.games_archive_filtered, q: "pawnstorm" }).ok, false);
    assert.equal(parseEvent("games_archive_filtered", { ...client.games_archive_filtered, result: ["won"] }).ok, false);
  });

  it("the enums it repeats equal the wire contracts (no drift)", () => {
    assert.deepEqual([...ANALYSIS_STATUSES], [...CT_STATUSES]);
    assert.deepEqual([...ANALYSIS_FAILURE_CODES], [...CT_FAILURE_CODES]);
    assert.deepEqual([...JUDGEMENTS], [...JUDGEMENT_KEYS]);
    assert.deepEqual([...PLAN_CHIPS], [...PLAN_KEYS]);
    assert.deepEqual([...COMPARISON_STATUSES], [...CT_COMPARISON]);
    assert.deepEqual([...PRIORITY_BANDS], [...CT_BANDS]);
    assert.deepEqual([...ANALYZE_REASONS], [...CT_ANALYZE_REASONS]);
  });
});
