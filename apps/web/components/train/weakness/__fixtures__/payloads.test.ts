// The weakness payload fixtures (phase-06 plan §4, §7.6, §9.3): every state parses with the TR-5 contract (plain,
// with lessons, stressed), stays under the 8 KB budget, reaches the status its name says, carries lessons only with
// `lesson`, and the ready fixture shows the board's numbers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessPayload } from "@repo/contracts/http/weakness";
import { WEAKNESS_FIXTURE_STATES, weaknessPayloadFixture, weaknessPayloadFixtures } from "./payloads";

describe("weakness payload fixtures", () => {
  it("every state parses (plain, lesson, stress, both) and stays under 8 KB", () => {
    for (const state of WEAKNESS_FIXTURE_STATES) {
      for (const opts of [{}, { lesson: true }, { stress: true }, { lesson: true, stress: true }]) {
        const p = weaknessPayloadFixture(state, opts);
        const r = WeaknessPayload.safeParse(p);
        assert.equal(r.success, true, `${state} ${JSON.stringify(opts)}: ${JSON.stringify(r.error?.issues)}`);
        assert.ok(JSON.stringify(p).length < WEAKNESS_PAYLOAD_MAX_BYTES, `${state} ${JSON.stringify(opts)} ${JSON.stringify(p).length} B`);
      }
    }
  });

  it("each state reaches its status", () => {
    const all = weaknessPayloadFixtures();
    const status = Object.fromEntries(Object.entries(all).map(([k, p]) => [k, p.status]));
    assert.deepEqual(status, {
      ready: "ready",
      ready_updating: "ready",
      few_patterns: "ready",
      none_eligible: "ready",
      no_band: "ready",
      no_clock: "ready",
      insufficient_zero: "insufficient",
      insufficient_few: "insufficient",
      insufficient: "insufficient",
      bullet_offer: "insufficient",
      computing: "computing",
      computing_stalled: "computing",
      computing_orphaned: "computing",
      computing_almost: "computing",
      failed: "failed",
      paused: "failed",
    });
    assert.deepEqual(all.ready_updating.updating, { newGames: 4 });
    assert.equal(all.few_patterns.top.length, 2);
    assert.equal(all.none_eligible.listMode, "most_frequent");
    assert.equal(all.no_band.band, null);
    assert.equal(all.no_clock.breakdown!.clock, null);
    assert.deepEqual(all.insufficient.preliminary.map((x) => `${x.label} · Seen in ${x.seenIn} of ${x.of} games`), ["Missed forks · Seen in 5 of 14 games", "Missed free pieces · Seen in 3 of 14 games"]);
    assert.deepEqual(all.bullet_offer.offers.includeBullet, { bulletGames: 64 });
    assert.equal(all.computing_stalled.progress!.stalled, true);
    assert.equal(all.computing_orphaned.progress!.orphaned, true);
    assert.equal(all.computing.progress!.target, 60);
    assert.deepEqual(all.failed.failure, { code: "compute_error", retryable: true });
  });

  it("the ready fixture shows the board's rows; lessons appear only with `lesson`", () => {
    const p = weaknessPayloadFixture("ready");
    assert.deepEqual(p.top.map((r) => [r.label, r.you, r.band, r.trendLabel, r.inBank]), [
      ["Missed forks", 3.1, 1.6, "Getting worse this month", 12],
      ["Missed free pieces", 2.4, 1.9, "About the same", 7],
      ["Time-pressure blunders", 4, 2.2, "Improving", 4],
    ]);
    assert.ok([...p.top, ...p.more].every((r) => r.lesson === null));
    assert.equal(p.weekPlan.length, 2);
    const withLesson = weaknessPayloadFixture("ready", { lesson: true });
    assert.equal(withLesson.top[0]!.lesson!.title, "Tal vs Smyslov, 1959");
    assert.equal(withLesson.weekPlan[2]!.label, "Legend lesson: Tal vs Smyslov, 1959");
  });

  it("stress stretches labels to the contract's limits", () => {
    const p = weaknessPayloadFixture("ready", { stress: true });
    assert.equal(p.breakdown!.openings[0]!.family.length, 60);
    assert.equal(p.scopeLabel.length, 80);
    assert.ok(p.top.every((r) => r.events >= 100));
  });
});
