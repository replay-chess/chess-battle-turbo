// trackTrain (phase-05 plan §10.1): typed against the registry, pushes to the e2e sink, skips PostHog on /dev demos,
// never throws.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseEvent } from "@repo/analytics";
import { intervalDays, isOverridden, trackTrain } from "./train-events";

type SinkWindow = { location: { pathname: string }; __rcTelemetry?: Array<{ name: string; props: Record<string, unknown> }> };
const g = globalThis as unknown as { window?: SinkWindow };

afterEach(() => {
  delete g.window;
});

describe("trackTrain", () => {
  it("never throws, on the server or in a browser without PostHog", () => {
    assert.doesNotThrow(() => trackTrain("train_hint_used", { step: 1 }));
    g.window = { location: { pathname: "/train/bank/session" } };
    assert.doesNotThrow(() => trackTrain("bank_card_removed", { undo: false }));
  });

  it("the registry accepts what the helpers build", () => {
    const props = { grade: "good", suggested: "hard", overridden: isOverridden("good", "hard"), first_try: false, hints: 1, wrongs: 0, time_ms: 1_000, interval_days: intervalDays(4), kind: "mistake", pass: 1, offline: false } as const;
    assert.deepEqual(parseEvent("train_item_graded", props), { ok: true });
    assert.deepEqual(parseEvent("home_viewed", { state: "populated", due: 4, has_continue: true }), { ok: true });
  });

  it("helpers", () => {
    assert.equal(isOverridden("good", "good"), false);
    assert.equal(intervalDays(0.00694), 0.01);
    assert.equal(intervalDays(-1), 0);
  });
});
