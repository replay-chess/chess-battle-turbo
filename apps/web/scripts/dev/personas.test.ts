import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEntitled } from "../../lib/billing/entitlement-rules";
import { isInTrial, trialDaysLeft } from "../../lib/billing/trial-rules";
import { P01_PERSONAS } from "../../e2e/personas/p01";
import { isP03Persona } from "../../e2e/personas/p03";
import { PERSONAS, assertPersonaTarget, getPersona, personaRow, resetPersona, resolvePersonaTarget } from "./personas";

const NOW = new Date("2026-11-05T12:00:00Z");
const HOUR = 3_600_000;
const env = { E2E_USER_S_EMAIL: "e2e-personas+clerk_test@chessbattle.dev" };

function row(name: string) {
  return personaRow("e2e-pool01+clerk_test@chessbattle.dev", getPersona(name), NOW);
}

describe("persona targets", () => {
  it("accepts pool users and S", () => {
    assert.equal(resolvePersonaTarget("E2E_POOL_03", env), "e2e-pool03+clerk_test@chessbattle.dev");
    assert.equal(resolvePersonaTarget("7", env), "e2e-pool07+clerk_test@chessbattle.dev");
    assert.equal(resolvePersonaTarget("S", env), env.E2E_USER_S_EMAIL);
    assert.equal(resolvePersonaTarget("e2e-pool12+clerk_test@chessbattle.dev", env), "e2e-pool12+clerk_test@chessbattle.dev");
  });

  it("refuses shared users A–R, out-of-range pool numbers and other emails", () => {
    for (const bad of ["A", "p", "Q", "R", "25", "0", "someone@example.com", "e2e-playera+clerk_test@chessbattle.dev"]) {
      assert.throws(() => resolvePersonaTarget(bad, env), Error, bad);
    }
  });

  it("writes only to the dev endpoint or a local Docker database", () => {
    assert.equal(assertPersonaTarget("postgresql://u:p@localhost:5433/db"), "localhost");
    assert.equal(
      assertPersonaTarget("postgresql://u:p@ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech/db"),
      "ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech",
    );
    assert.throws(() => assertPersonaTarget("postgresql://u:p@ep-shiny-shape-b8lvr0f5.us-east-1.aws.neon.tech/db"));
  });
});

describe("P01 personas reach the states the viewer derives (plan §8.2)", () => {
  it("member: entitled, not in trial", () => {
    const r = row("member");
    assert.equal(isEntitled({ ...r, subscriptionUpdatedAt: r.subscriptionUpdatedAt }, NOW), true);
    assert.equal(isInTrial(r, NOW), false);
  });

  it("trial5 shows 5 days left; trial_last_day shows 1", () => {
    assert.equal(trialDaysLeft(row("trial5").trialEndsAt, NOW), 5);
    assert.equal(isInTrial(row("trial5"), NOW), true);
    assert.equal(trialDaysLeft(row("trial_last_day").trialEndsAt, NOW), 1);
  });

  it("payment personas sit on the banner / last_day / expired thresholds (36 h)", () => {
    const left = (name: string) => (row(name).currentPeriodEnd!.getTime() - NOW.getTime()) / HOUR;
    const banner = row("payment_banner");
    assert.equal(banner.subscriptionStatus, "past_due");
    assert.ok(isEntitled(banner, NOW) && left("payment_banner") > 36);
    const lastDay = row("payment_last_day");
    assert.ok(isEntitled(lastDay, NOW) && left("payment_last_day") <= 36 && left("payment_last_day") > 0);
    const expired = row("payment_expired");
    assert.ok(!isEntitled(expired, NOW) && left("payment_expired") < 0 && left("payment_expired") > -30 * 24);
  });

  it("lapsed and none are not entitled; none can still start a trial", () => {
    assert.equal(isEntitled(row("lapsed"), NOW), false);
    assert.ok(row("lapsed").subscriptionId);
    const none = row("none");
    assert.equal(isEntitled(none, NOW), false);
    assert.equal(none.subscriptionId, null);
    assert.equal(none.trialStartedAt, null);
  });

  it("every persona sets a unique subscription id per user and the fixture product only", () => {
    for (const p of Object.values(PERSONAS)) {
      const r = personaRow("x@chessbattle.dev", p, NOW);
      if (r.subscriptionId) assert.equal(r.subscriptionId, "e2e_persona_x@chessbattle.dev");
      assert.ok(r.subscriptionProductId === null || r.subscriptionProductId === "e2e-fixture", p.name);
    }
  });
});

describe("P03 personas (phase-03 plan §12.3): billing and the games they own", () => {
  it("review-empty and review-terminal are members; review-lapsed is the P1 lapsed state (402 expired)", () => {
    assert.equal(isEntitled(row("review-empty"), NOW), true);
    assert.equal(isEntitled(row("review-terminal"), NOW), true);
    const lapsed = row("review-lapsed");
    assert.equal(isEntitled(lapsed, NOW), false);
    assert.equal(lapsed.subscriptionStatus, "expired");
    assert.deepEqual(lapsed, row("lapsed"));
  });

  it("each P3 persona clears the user's games, then writes only its own fixtures", () => {
    const games = (name: string) => {
      const p = getPersona(name);
      assert.ok(isP03Persona(p), name);
      return p.games;
    };
    assert.deepEqual(games("review-empty"), { clear: true, fixtures: [] });
    assert.deepEqual(games("review-terminal"), { clear: true, fixtures: ["TERMINAL"] });
    assert.deepEqual(games("review-lapsed"), { clear: true, fixtures: ["GAME"] });
    for (const name of Object.keys(P01_PERSONAS)) assert.equal(isP03Persona(getPersona(name)), false, name);
  });

  it("a dry run of a P3 persona writes nothing and names its games", async () => {
    const lines: string[] = [];
    const r = await resetPersona("E2E_POOL_03", "review-terminal", {
      dryRun: true,
      now: NOW,
      databaseUrl: "postgresql://u:p@localhost:5433/db",
      log: (l) => lines.push(l),
    });
    assert.equal(r.applied, false);
    assert.deepEqual(r.refs, {});
    assert.ok(lines.some((l) => l.includes('"fixtures":["TERMINAL"]')), lines.join("\n"));
  });
});
