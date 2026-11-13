// Unit tests of the Phase 4 persona states and the pure parts of their writers (phase-04 plan 6.7). The database side
// is test/p04-personas.int.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { buildRatings } from "../src/json";
import {
  expectedLinkViewStatus,
  getP04PersonaState,
  isP04PersonaName,
  P04_PERSONA_STATES,
  P04_POOL_PERSONAS,
  P04_SEED_PERSONAS,
} from "./p04-persona-states";
import {
  cursorOf,
  fixtureGames,
  ledgerHandleHashes,
  personaExternalId,
  personaLinkExternalId,
  type LedgerKeys,
} from "./p04-personas";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const requireHere = createRequire(import.meta.url);
const expected = (rel: string) =>
  JSON.parse(readFileSync(requireHere.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8")) as {
    games: { externalId?: string; skip?: string }[];
  };

describe("P4 persona states (plan 6.7)", () => {
  it("has every dev-seed persona and every lease-pool persona of the plan", () => {
    assert.deepEqual(Object.keys(P04_SEED_PERSONAS).sort(), ["member", "new", "onbplan", "onbused", "privategames", "syncfailed", "trial"]);
    assert.deepEqual(Object.keys(P04_POOL_PERSONAS).sort(), [
      "connected-both",
      "connected-none-member",
      "connected-nonmember",
      "connected-privategames",
      "connected-syncfailed",
      "import-trial",
      "onboarding-fresh",
      "onboarding-plan",
      "onboarding-trial-used",
    ]);
    for (const p of Object.values(P04_POOL_PERSONAS)) assert.ok(p.seed in P04_SEED_PERSONAS, `${p.name} → ${p.seed}`);
  });

  it("pool names never clash with the P1/P3 registry names and every name resolves", () => {
    // The persona registry spreads P01, P03 and the P4 pool names; the dev-seed names (`member`, …) stay out of it.
    const taken = ["member", "trial5", "trial_last_day", "payment_banner", "payment_last_day", "payment_expired", "lapsed", "none"];
    for (const name of [...taken, "review-empty", "review-terminal", "review-lapsed"]) {
      assert.equal(name in P04_POOL_PERSONAS, false, name);
    }
    for (const name of Object.keys(P04_PERSONA_STATES)) assert.equal(isP04PersonaName(name), true, name);
    assert.equal(isP04PersonaName("trial5"), false);
    assert.equal(getP04PersonaState("import-trial").seed, "trial");
    assert.throws(() => getP04PersonaState("nobody"), /unknown P4 persona/);
  });

  it("a pool persona is its seed state unless it overrides a part (plan 6.7 'Seed equivalent' column)", () => {
    const same = (a: string) => {
      const p = getP04PersonaState(a);
      const s = getP04PersonaState(p.seed);
      return {
        billing: JSON.stringify(p.billing(NOW)) === JSON.stringify(s.billing(NOW)),
        onboarding: JSON.stringify(p.onboarding) === JSON.stringify(s.onboarding),
        links: JSON.stringify(p.links(NOW)) === JSON.stringify(s.links(NOW)),
      };
    };
    for (const n of ["onboarding-plan", "onboarding-trial-used", "import-trial", "connected-both", "connected-syncfailed", "connected-privategames"]) {
      assert.deepEqual(same(n), { billing: true, onboarding: true, links: true }, n);
    }
    // The plan's deltas: fresh is `new` at WELCOME; none-member is `member` without links; nonmember is onboarded `new`.
    assert.deepEqual(same("onboarding-fresh"), { billing: true, onboarding: false, links: true });
    assert.deepEqual(same("connected-none-member"), { billing: true, onboarding: false, links: false });
    assert.deepEqual(same("connected-nonmember"), { billing: true, onboarding: false, links: true });
    assert.equal(P04_POOL_PERSONAS["connected-nonmember"].onboarding.step, "DONE");
    assert.deepEqual(P04_POOL_PERSONAS["connected-none-member"].links(NOW), []);
  });

  it("onboarding columns are consistent: DONE ⇔ onboardedAgoMin, chosen level ⇔ band source", () => {
    for (const p of Object.values(P04_PERSONA_STATES)) {
      const o = p.onboarding;
      assert.equal(o.step === "DONE", o.onboardedAgoMin !== null, p.name);
      if (o.ratingBand !== null) assert.ok(o.ratingBandSource, p.name);
      if (o.ratingBandSource?.startsWith("chesscom:")) {
        assert.ok(p.links(NOW).some((l) => l.provider === "CHESSCOM"), `${p.name}: chesscom band needs a Chess.com link`);
      }
      assert.ok(o.goals.length <= 5 && new Set(o.goals).size === o.goals.length, p.name);
      if (o.dailyMinutes !== null) assert.ok([5, 10, 20].includes(o.dailyMinutes), p.name);
    }
    assert.equal(P04_POOL_PERSONAS["onboarding-fresh"].onboarding.step, "WELCOME");
    assert.equal(P04_POOL_PERSONAS["onboarding-fresh"].onboarding.timeZone, "UTC");
    assert.equal(P04_SEED_PERSONAS.new.onboarding.step, "LINK");
    assert.equal(P04_SEED_PERSONAS.onbplan.onboarding.step, "PLAN");
  });

  it("billing matches the plan: trial eligible for new/onbplan, used for onbused, entitled for members", () => {
    const eligible = (name: string) => {
      const b = getP04PersonaState(name).billing(NOW);
      return b.trialStartedAt === null && !b.hasSubscription;
    };
    for (const n of ["new", "onbplan", "onboarding-fresh", "onboarding-plan", "connected-nonmember"]) assert.equal(eligible(n), true, n);
    for (const n of ["onbused", "onboarding-trial-used", "trial", "member", "syncfailed", "privategames"]) assert.equal(eligible(n), false, n);

    const used = P04_SEED_PERSONAS.onbused.billing(NOW);
    assert.equal(used.subscriptionStatus, "cancelled");
    assert.equal(NOW.getTime() - used.trialStartedAt!.getTime(), 60 * 86_400_000);
    assert.equal(P04_SEED_PERSONAS.onbused.ledgerRow, true);

    const trial = P04_SEED_PERSONAS.trial.billing(NOW);
    assert.equal(trial.subscriptionStatus, "active");
    assert.equal(trial.trialEndsAt!.getTime() - NOW.getTime(), 5 * 86_400_000);
    assert.equal(NOW.getTime() - trial.trialStartedAt!.getTime(), 2 * 86_400_000);
  });

  it("links carry the design values and valid RatingsV1", () => {
    const trial = P04_SEED_PERSONAS.trial.links(NOW);
    assert.equal(trial.length, 1);
    assert.equal(trial[0]!.username, "KnightOwl_88");
    assert.deepEqual(
      { rapid: trial[0]!.ratings.rapid?.rating, blitz: trial[0]!.ratings.blitz?.rating, bullet: trial[0]!.ratings.bullet?.rating },
      { rapid: 1184, blitz: 1032, bullet: 871 },
    );
    assert.equal(trial[0]!.totalRatedGames, 480);
    assert.deepEqual({ status: trial[0]!.run?.status, phase: trial[0]!.run?.phase, imported: trial[0]!.run?.imported, total: trial[0]!.run?.total }, {
      status: "RUNNING",
      phase: "saving",
      imported: 212,
      total: 480,
    });

    const member = P04_SEED_PERSONAS.member.links(NOW);
    assert.deepEqual(member.map((l) => [l.provider, l.username, l.verified, l.importedCount]), [
      ["CHESSCOM", "KnightOwl_88", false, 480],
      ["LICHESS", "knightowl88", true, 96],
    ]);
    assert.equal(member[1]!.ratings.blitz?.rating, 1402);

    const pg = P04_SEED_PERSONAS.privategames.links(NOW)[0]!;
    assert.deepEqual([pg.run?.seen, pg.run?.imported, pg.run?.skipped, pg.skippedCount], [480, 312, 168, 168]);

    for (const p of Object.values(P04_PERSONA_STATES)) {
      for (const l of p.links(NOW)) {
        assert.doesNotThrow(() => buildRatings({ v: 1, ...l.ratings }), `${p.name} ${l.provider}`);
        assert.ok(l.username.length <= 40 && (l.displayName ?? "").length <= 80 && (l.title ?? "").length <= 4);
        if (l.countryCode !== null) assert.match(l.countryCode, /^[A-Z]{2}$/);
        if (l.run?.status === "WAITING_FOR_MEMBERSHIP") {
          // Linked before the trial: never synced, nothing imported, no games, no daily sync yet.
          assert.deepEqual([l.lastSyncOkAgoMin, l.importedCount, l.games, l.nextAutoSyncInMin], [null, 0, null, null], p.name);
        }
        if (l.run?.status === "DONE") assert.equal(l.run.imported + l.run.skipped, l.run.seen, `${p.name}: seen = imported + skipped`);
      }
    }
  });

  it("each persona's links reach the Connected board states it names (plan 8.11 view status)", () => {
    const view = (name: string) =>
      getP04PersonaState(name)
        .links(NOW)
        .map((l) =>
          expectedLinkViewStatus(l, l.nextAllowedSyncInSec === null ? null : new Date(NOW.getTime() + l.nextAllowedSyncInSec * 1000), NOW),
        );
    assert.deepEqual(view("trial"), ["syncing"]);
    assert.deepEqual(view("member"), ["linked", "linked"]);
    assert.deepEqual(view("syncfailed"), ["error", "rate_limited"]);
    assert.deepEqual(view("privategames"), ["linked"]);
    assert.deepEqual(view("onbplan"), ["waiting_for_membership"]);
    assert.deepEqual(view("new"), []);
    assert.deepEqual(view("connected-none-member"), []);
  });

  it("the view-status rule follows the plan 8.11 table over the full product", () => {
    const later = new Date(NOW.getTime() + 30_000);
    const earlier = new Date(NOW.getTime() - 30_000);
    const states = ["IDLE", "WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING", "RATE_LIMITED", "FAILED"] as const;
    const table: Record<(typeof states)[number], [string, string]> = {
      IDLE: ["rate_limited", "linked"],
      WAITING_FOR_MEMBERSHIP: ["waiting_for_membership", "waiting_for_membership"],
      QUEUED: ["queued", "queued"],
      RUNNING: ["syncing", "syncing"],
      RATE_LIMITED: ["rate_limited", "queued"],
      FAILED: ["error", "error"],
    };
    for (const s of states) {
      assert.equal(expectedLinkViewStatus({ status: "ACTIVE", importState: s }, later, NOW), table[s][0], `${s} back-off`);
      assert.equal(expectedLinkViewStatus({ status: "ACTIVE", importState: s }, earlier, NOW), table[s][1], `${s} past`);
      assert.equal(expectedLinkViewStatus({ status: "ACTIVE", importState: s }, null, NOW), table[s][1], `${s} none`);
      assert.equal(expectedLinkViewStatus({ status: "ERROR", importState: s }, later, NOW), "error", `${s} ERROR`);
    }
  });
});

describe("P4 persona fixture games (through @repo/chess-import's mappers)", () => {
  it("are exactly the fixture accounts' importable games, newest first", () => {
    const cc = fixtureGames("chesscom-knightowl_88");
    const ccExpected = ["2026-08", "2026-09", "2026-10"].flatMap((m) => expected(`chesscom/knightowl_88/${m}.expected.json`).games);
    assert.deepEqual(
      cc.map((g) => g.externalId).sort(),
      ccExpected.filter((g) => !g.skip).map((g) => g.externalId!).sort(),
    );
    const li = fixtureGames("lichess-knightowl88");
    const liExpected = expected("lichess/knightowl88/games.expected.json").games;
    assert.deepEqual(
      li.map((g) => g.externalId).sort(),
      liExpected.filter((g) => !g.skip).map((g) => g.externalId!).sort(),
    );
    for (const list of [cc, li]) {
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1]!.endedAt >= list[i]!.endedAt);
      assert.ok(list.every((g) => g.source === (list === cc ? "CHESSCOM" : "LICHESS")));
    }
    assert.equal(fixtureGames("chesscom-knightowl_88"), cc, "mapped once, then cached");
  });

  it("persona external ids are per user, deterministic and fit the columns", () => {
    const a = "cm3p4aaaaaaaaaaaaaaaaaaaa";
    const b = "cm3p4bbbbbbbbbbbbbbbbbbbb";
    for (const g of [...fixtureGames("chesscom-knightowl_88"), ...fixtureGames("lichess-knightowl88")]) {
      const ia = personaExternalId(g.externalId, a);
      assert.ok(ia.length <= 40 && ia.startsWith(`${g.externalId}.p4`));
      assert.equal(ia, personaExternalId(g.externalId, a));
      assert.notEqual(ia, personaExternalId(g.externalId, b));
    }
    assert.throws(() => personaExternalId("x".repeat(30), a), /longer than 40/);
    const link = personaLinkExternalId("LICHESS", a);
    assert.ok(link.length <= 64);
    assert.notEqual(link, "knightowl88");
    assert.notEqual(link, personaLinkExternalId("LICHESS", b));
    assert.notEqual(link, personaLinkExternalId("CHESSCOM", a));
  });

  it("cursors: Chess.com archive months (done unless current) and Lichess since = newest createdAt", () => {
    const cc = cursorOf("CHESSCOM", fixtureGames("chesscom-knightowl_88"), NOW);
    assert.deepEqual(Object.keys(cc.archives!.months).sort(), ["2026/08", "2026/09", "2026/10"]);
    assert.ok(Object.values(cc.archives!.months).every((m) => m.done));
    assert.equal(Object.values(cc.archives!.months).reduce((s, m) => s + m.games, 0), cc.seen);
    const inOctober = cursorOf("CHESSCOM", fixtureGames("chesscom-knightowl_88"), new Date("2026-10-20T00:00:00Z"));
    assert.equal(inOctober.archives!.months["2026/10"]!.done, false);

    const li = fixtureGames("lichess-knightowl88");
    const lc = cursorOf("LICHESS", li, NOW);
    assert.equal(lc.archives, null);
    assert.equal(lc.lichessSinceMs, BigInt(Math.max(...li.map((g) => g.createdAtMs ?? g.endedAt.getTime()))));
    assert.deepEqual(cursorOf("LICHESS", [], NOW), { archives: null, archivesEtag: null, lichessSinceMs: null, oldestImportedAt: null, seen: 0 });
  });

  it("ledger handle hashes cover the verified and the unverified form of every handle", () => {
    const calls: string[] = [];
    const ledger: LedgerKeys = {
      emailHash: (e) => `e:${e}`,
      handleHash: (p, u, v) => {
        calls.push(`${p}:${u}:${v}`);
        return `${v ? "v" : "u"}:${p}:${u}`;
      },
    };
    const hashes = ledgerHandleHashes(ledger, [
      { provider: "CHESSCOM", usernameLower: "knightowl_88" },
      { provider: "LICHESS", usernameLower: "knightowl88" },
      { provider: "LICHESS", usernameLower: "knightowl88" },
    ]);
    assert.deepEqual(hashes, ["u:chesscom:knightowl_88", "u:lichess:knightowl88", "v:chesscom:knightowl_88", "v:lichess:knightowl88"]);
    assert.ok(calls.every((c) => !c.includes("KnightOwl")));
  });
});
