import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateFixtureHealth, formatHealthFailure, type FixtureRow } from "./health";
import { SHARED_MEMBER_LETTERS, letterEmail } from "./users";

const NOW = new Date("2026-11-05T12:00:00Z");
const DAY = 86_400_000;
const env = {};

function healthyRows(): FixtureRow[] {
  const members = SHARED_MEMBER_LETTERS.map((l) => ({
    email: letterEmail(l, env),
    subscriptionId: `e2e_${l}`,
    subscriptionStatus: "active",
    currentPeriodEnd: new Date(NOW.getTime() + 365 * DAY),
    trialStartedAt: null,
  }));
  return [
    ...members,
    { email: letterEmail("Q", env), subscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, trialStartedAt: new Date(NOW.getTime() - 60 * DAY) },
    { email: letterEmail("R", env), subscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, trialStartedAt: null },
  ];
}

describe("fixture health", () => {
  it("passes healthy fixtures", () => {
    assert.deepEqual(evaluateFixtureHealth(healthyRows(), NOW, env), { problems: [], warnings: [] });
  });

  it("fails when a shared member's period ends within 30 days", () => {
    const rows = healthyRows();
    rows[3]!.currentPeriodEnd = new Date(NOW.getTime() + 29 * DAY);
    const { problems } = evaluateFixtureHealth(rows, NOW, env);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /^D: currentPeriodEnd .* less than 30 days/);
    assert.match(formatHealthFailure(problems), /E2E fixture health failed \(1 problem/);
  });

  it("fails when a shared member is missing or not active", () => {
    const rows = healthyRows().filter((r) => r.email !== letterEmail("A", env));
    rows[0]!.subscriptionStatus = "past_due";
    const { problems } = evaluateFixtureHealth(rows, NOW, env);
    assert.ok(problems.some((p) => p.startsWith("A (")));
    assert.ok(problems.some((p) => p.startsWith("B: subscriptionStatus is past_due")));
  });

  it("fails when Q lost its trial or R gained a subscription", () => {
    const rows = healthyRows();
    rows.find((r) => r.email === letterEmail("Q", env))!.trialStartedAt = null;
    rows.find((r) => r.email === letterEmail("R", env))!.subscriptionStatus = "active";
    const { problems } = evaluateFixtureHealth(rows, NOW, env);
    assert.equal(problems.length, 2);
  });

  it("only warns when Q has no row yet", () => {
    const rows = healthyRows().filter((r) => r.email !== letterEmail("Q", env));
    const report = evaluateFixtureHealth(rows, NOW, env);
    assert.deepEqual(report.problems, []);
    assert.equal(report.warnings.length, 1);
  });
});
