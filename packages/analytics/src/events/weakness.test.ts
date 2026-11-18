// Weakness Profile events (phase-06 plan §10.1): every §10.1 event registered once (client and worker), closed
// property sets with the four context properties on every client event, pattern keys never labels or FENs, the
// enums they repeat equal to the wire contracts (drift guard; the package has no runtime dependency on contracts),
// and P5's train_session_* reused with kind "weakness" instead of being re-declared.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEAKNESS_TRIGGERS } from "../../../contracts/src/internal/jobs";
import { LIST_MODES, WEAKNESS_STATUSES } from "../../../contracts/src/http/weakness";
import { EVENTS, parseEvent } from "../index";
import { findPii } from "../pii";
import { trainClientEvents } from "./train";
import {
  WEAKNESS_EVENT_STATUSES,
  WEAKNESS_EVENT_TRIGGERS,
  WEAKNESS_LIST_MODES,
  weaknessClientEvents,
  weaknessEvents,
  weaknessServerEvents,
} from "./weakness";

const ctx = { device: "desktop", viewport_w: 1440, zoom_bucket: "100", is_trial: false } as const;

const CLIENT_SAMPLES: Record<keyof typeof weaknessClientEvents, Record<string, unknown>> = {
  weakness_viewed: {
    ...ctx,
    status: "ready",
    patterns: 3,
    games_analysed: 100,
    games_in_scope: 212,
    list_mode: "vs_band",
    top_pattern: "fork",
    band_min: 1100,
    has_clock: true,
    updating: false,
    entry: "dot",
  },
  weakness_computing_viewed: { ...ctx, pct: 47, eta_sec: 495, stalled: false, target: 100, orphaned: false },
  weakness_ready_seen: { ...ctx, version: 3, latency_s: 120 },
  weakness_row_expanded: { ...ctx, pattern: "hangingPiece", rank: 2 },
  weakness_tab_changed: { ...ctx, tab: "clock" },
  weakness_see_all_clicked: { ...ctx, more_count: 2 },
  weakness_import_cta_clicked: { ...ctx, analysed: 14 },
  weakness_play_cta_clicked: { ...ctx, analysed: 14 },
  weakness_include_bullet_clicked: { ...ctx, bullet_games: 64 },
  weakness_recompute_clicked: { ...ctx, from: "failed", result: "rate_limited" },
  weakness_week_plan_clicked: { ...ctx, kind: "puzzles", pattern: "fork" },
  weakness_drill_opened: { ...ctx, device: "phone", pattern: "rc:timePressure", rank: 3, surface: "sheet", entry: "row" },
  weakness_drill_configured: { ...ctx, pattern: "fork", size: 20, mix: false },
  weakness_drill_started: { ...ctx, pattern: "fork", size: 10, mix: true, own: 6, puzzles: 4, result: "ok" },
};

const SERVER_SAMPLES: Record<keyof typeof weaknessServerEvents, Record<string, unknown>> = {
  weakness_snapshot_computed: {
    status: "ready",
    algo_version: 1,
    trigger: "analysis",
    games_in_scope: 212,
    games_analysed: 100,
    list_mode: "vs_band",
    top_patterns: ["fork", "hangingPiece", "rc:timePressure"],
    band_center: 1200,
    band_source: "lichess",
    duration_ms: 1_480,
    healed_rows: 0,
    bumped: true,
  },
  weakness_first_ready: { minutes_since_first_analysis: 14, games_analysed: 20, source_mix: { lichess: 0.7, chesscom: 0.3, replay: 0 } },
  weakness_recompute_failed: { code: "compute_error", attempts: 3, trigger: "user" },
};

describe("weakness events", () => {
  it("registers every §10.1 event exactly once and spreads them into EVENTS", () => {
    assert.deepEqual(Object.keys(weaknessClientEvents).sort(), [
      "weakness_computing_viewed", "weakness_drill_configured", "weakness_drill_opened", "weakness_drill_started",
      "weakness_import_cta_clicked", "weakness_include_bullet_clicked", "weakness_play_cta_clicked",
      "weakness_ready_seen", "weakness_recompute_clicked", "weakness_row_expanded", "weakness_see_all_clicked",
      "weakness_tab_changed", "weakness_viewed", "weakness_week_plan_clicked",
    ]);
    assert.deepEqual(Object.keys(weaknessServerEvents).sort(), ["weakness_first_ready", "weakness_recompute_failed", "weakness_snapshot_computed"]);
    for (const name of Object.keys(weaknessEvents)) assert.ok(name in EVENTS, name);
    assert.equal("train_session_started" in weaknessEvents, false, "P5's runner events are reused, not re-declared");
  });

  it("accepts every documented sample (through parseEvent, with PostHog's own properties)", () => {
    for (const [name, props] of Object.entries({ ...CLIENT_SAMPLES, ...SERVER_SAMPLES })) {
      assert.deepEqual(parseEvent(name, { ...props, $lib: "web", app_env: "test" }), { ok: true }, name);
    }
  });

  it("every client event carries device, viewport_w, zoom_bucket and is_trial (required)", () => {
    for (const [name, props] of Object.entries(CLIENT_SAMPLES)) {
      const schema = weaknessClientEvents[name as keyof typeof weaknessClientEvents];
      for (const key of ["device", "viewport_w", "zoom_bucket", "is_trial"]) {
        const { [key]: _drop, ...rest } = props;
        assert.equal(schema.safeParse(rest).success, false, `${name} without ${key}`);
      }
      assert.equal(schema.safeParse({ ...props, zoom_bucket: "175" }).success, false, `${name} zoom bucket`);
    }
  });

  it("refuses extra keys, labels instead of keys, and FEN-like values", () => {
    assert.equal(weaknessClientEvents.weakness_row_expanded.safeParse({ ...CLIENT_SAMPLES.weakness_row_expanded, label: "Missed forks" }).success, false);
    assert.equal(weaknessClientEvents.weakness_row_expanded.safeParse({ ...CLIENT_SAMPLES.weakness_row_expanded, pattern: "Missed forks" }).success, false);
    assert.equal(
      weaknessClientEvents.weakness_drill_started.safeParse({ ...CLIENT_SAMPLES.weakness_drill_started, size: 15 }).success,
      false,
    );
    assert.equal(
      weaknessServerEvents.weakness_recompute_failed.safeParse({ code: "Error: boom at user@example.com", attempts: 3, trigger: "user" }).success,
      false,
      "an error code, never a message",
    );
    assert.equal(weaknessServerEvents.weakness_snapshot_computed.safeParse({ ...SERVER_SAMPLES.weakness_snapshot_computed, status: "computing" }).success, false);
  });

  it("no sample carries PII", () => {
    for (const [name, props] of Object.entries({ ...CLIENT_SAMPLES, ...SERVER_SAMPLES })) {
      assert.deepEqual(findPii(props), [], name);
    }
  });

  it("the enums it repeats equal the wire contracts (no drift)", () => {
    assert.deepEqual([...WEAKNESS_EVENT_STATUSES], [...WEAKNESS_STATUSES]);
    assert.deepEqual([...WEAKNESS_LIST_MODES], [...LIST_MODES]);
    assert.deepEqual([...WEAKNESS_EVENT_TRIGGERS], [...WEAKNESS_TRIGGERS]);
  });

  it("P5's train_session_started takes a weakness drill (kind weakness, theme = pattern, source weakness)", () => {
    const started = { kind: "weakness", source: "weakness", theme: "rc:timePressure", size: 10, items: 7, counts_toward_cap: false, resumed: false, widened: false };
    assert.ok(trainClientEvents.train_session_started.safeParse(started).success);
    assert.ok(trainClientEvents.train_session_completed.safeParse({ kind: "weakness", solved: 9, total: 10, perfect: false, duration_s: 300 }).success);
  });
});
