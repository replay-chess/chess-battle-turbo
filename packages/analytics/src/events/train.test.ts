// Train, bank, puzzle and Home events (phase-05 plan §10.1): closed property sets, no FEN/SAN/names/refs, every §10.1
// event registered once, and the enums they repeat stay equal to the wire contracts (drift guard only: the analytics
// package has no runtime dependency on the contracts package).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRADES, ITEM_KINDS, SESSION_KINDS, SESSION_SOURCES } from "../../../contracts/src/http/train";
import { REPORT_REASONS } from "../../../contracts/src/http/reports";
import { findPii } from "../pii";
import { homeClientEvents, homeEvents } from "./home";
import {
  TRAIN_GRADES,
  TRAIN_ITEM_KINDS,
  TRAIN_REPORT_REASONS,
  TRAIN_SESSION_KINDS,
  TRAIN_SESSION_SOURCES,
  trainClientEvents,
  trainEvents,
  trainServerEvents,
} from "./train";

describe("train events", () => {
  it("the enums it repeats equal the wire contracts (no drift)", () => {
    assert.deepEqual([...TRAIN_ITEM_KINDS], [...ITEM_KINDS]);
    assert.deepEqual([...TRAIN_SESSION_KINDS], [...SESSION_KINDS]);
    assert.deepEqual([...TRAIN_SESSION_SOURCES], [...SESSION_SOURCES]);
    assert.deepEqual([...TRAIN_GRADES], [...GRADES]);
    assert.deepEqual([...TRAIN_REPORT_REASONS], [...REPORT_REASONS]);
  });

  it("registers every §10.1 event exactly once (client, web server, worker)", () => {
    const expected = [
      "train_hub_viewed", "train_hub_link_clicked", "train_plan_started", "train_plan_step_completed", "train_session_started",
      "train_item_shown", "train_hint_used", "train_wrong_move", "train_solution_shown", "train_item_graded", "train_item_skipped",
      "train_item_reported", "train_attempt_conflict", "train_session_completed", "train_session_abandoned",
      "train_summary_next_clicked", "bank_viewed", "bank_filter_applied", "bank_solve_one_clicked", "bank_see_in_game_clicked",
      "bank_card_removed", "puzzle_theme_changed", "puzzle_rating_changed", "theme_milestone_reached", "streak_extended",
      "streak_reset", "train_offline_flush", "game_over_bank_line_shown",
    ];
    assert.deepEqual(Object.keys(trainClientEvents).sort(), expected.sort());
    assert.deepEqual(Object.keys(trainServerEvents).sort(), ["mistakes_extracted", "train_attempts_applied"]);
    assert.deepEqual(Object.keys(trainEvents).sort(), [...expected, "mistakes_extracted", "train_attempts_applied"].sort());
    assert.deepEqual(Object.keys(homeEvents).sort(), ["home_bank_cta_clicked", "home_continue_clicked", "home_import_clicked", "home_viewed"]);
  });

  it("accepts the documented shapes and refuses extra keys", () => {
    const graded = {
      grade: "good", suggested: "hard", overridden: true, first_try: false, hints: 1, wrongs: 0, time_ms: 24_000,
      interval_days: 4, kind: "mistake", pass: 1, offline: false,
    };
    assert.ok(trainClientEvents.train_item_graded.safeParse(graded).success);
    assert.equal(trainClientEvents.train_item_graded.safeParse({ ...graded, san: "Rxf5" }).success, false);
    assert.equal(trainClientEvents.train_item_graded.safeParse({ ...graded, grade: "perfect" }).success, false);
    const started = { kind: "puzzles", source: "picker", theme: "fork", size: 10, items: 10, counts_toward_cap: false, resumed: false, widened: true };
    assert.ok(trainClientEvents.train_session_started.safeParse(started).success);
    assert.ok(trainClientEvents.train_session_started.safeParse({ ...started, kind: "weakness", theme: null }).success, "P6 reuses it");
    assert.equal(trainClientEvents.train_session_started.safeParse({ ...started, theme: "Forks!" }).success, false, "keys, not labels");
    assert.ok(trainClientEvents.bank_filter_applied.safeParse({ theme: "rc:recapture", phase: null, source: "own", results: 4 }).success);
    assert.ok(trainClientEvents.theme_milestone_reached.safeParse({ theme: "fork", pct: 70 }).success);
    assert.equal(trainClientEvents.theme_milestone_reached.safeParse({ theme: "fork", pct: 60 }).success, false);
    assert.ok(trainClientEvents.game_over_bank_line_shown.safeParse({ count: 2, mode: "bot" }).success);
    assert.ok(trainClientEvents.bank_see_in_game_clicked.safeParse({}).success);
    assert.equal(trainClientEvents.bank_see_in_game_clicked.safeParse({ gameRef: "cabc" }).success, false);
    assert.ok(trainServerEvents.train_attempts_applied.safeParse({ n: 3, ok: 2, duplicates: 1, conflicts: 0, rejected: 0, batch_ms: 41 }).success);
    assert.ok(
      trainServerEvents.mistakes_extracted.safeParse({ candidates: 4, puzzles: 1, review_positions: 3, cards_added: 3, recurrences: 0, extract_ms: 1_800, source: "live" }).success,
    );
    assert.equal(trainServerEvents.mistakes_extracted.safeParse({ candidates: 5, puzzles: 1, review_positions: 3, cards_added: 3, recurrences: 0, extract_ms: 1, source: "live" }).success, false, "≤ 4 per game side");
  });

  it("home events", () => {
    assert.ok(homeClientEvents.home_viewed.safeParse({ state: "import_running", due: 4, has_continue: true }).success);
    assert.equal(homeClientEvents.home_viewed.safeParse({ state: "loading", due: 4, has_continue: true }).success, false);
    assert.ok(homeClientEvents.home_continue_clicked.safeParse({ kind: "first_legend" }).success);
    assert.ok(homeClientEvents.home_import_clicked.safeParse({ surface: "start_here" }).success);
  });

  it("valid property values carry no PII", () => {
    assert.deepEqual(findPii({ theme: "fork", source: "plan", kind: "mistake", grade: "good" }), []);
  });
});
