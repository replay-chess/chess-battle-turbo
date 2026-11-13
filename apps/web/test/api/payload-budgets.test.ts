// Phase-04 plan §9.6 payload budgets, asserted on the real DTO builders with worst-case (or, for /api/me, the
// typical-member) values. regression: p04-payload-budgets-untested (FIX-2, review round 2): only LookupData was
// asserted (accounts.contract.int.test.ts), and ImportStatusData reached ~2.2 KB with five failed runs.
//
//   AccountsData (2 accounts)  ≤ 2.5 KB      ImportStatusData (5 runs)  ≤ 2 KB
//   ActivationData             ≤ 1 KB        /api/me growth             ≤ +350 B (plan §7.2: "grows by ≈ 320 B")
// Sizes are the serialised `data` (the envelope adds the same few bytes to every route), as the LookupData check.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountsData, LinkedAccountView } from "@repo/contracts/http/accounts";
import { ImportStatusData } from "@repo/contracts/http/import";
import { ActivationData } from "@repo/contracts/http/billing";
import { MeData } from "@repo/contracts/http/me";
import { toAccountView, type AccountRow, type RunRow } from "@/lib/data/import-rows";
import { toImportStatus } from "@/lib/data/imports";
import { activationData } from "@/lib/data/billing";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { viewerFixture } from "@/test/helpers/route-harness";

const KB = 1024;
const NOW = new Date("2026-11-13T10:15:00.000Z");
const T = new Date("2026-11-13T10:14:59.999Z");
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const REF = "c".padEnd(25, "x");

const failedError = { v: 1, code: "rate_limited", message: "429 from the provider", at: T.toISOString(), retryAt: T.toISOString(), httpStatus: 429 };

/** A run at its widest: the longest status and trigger, four- and five-digit counts, every timestamp, an error. */
function run(i: number, provider: "CHESSCOM" | "LICHESS", over: Partial<RunRow> = {}): RunRow {
  return {
    referenceId: `${REF.slice(0, 24)}${i}`,
    provider,
    trigger: "INITIAL",
    status: "FAILED",
    phase: "reading",
    seen: 2000,
    total: 2000,
    imported: 1999,
    skipped: 2000,
    analysisQueued: 32767,
    analysed: 32767,
    error: failedError,
    startedAt: T,
    finishedAt: T,
    updatedAt: T,
    ...over,
  };
}

describe("plan §9.6 payload budgets", () => {
  it("ImportStatusData ≤ 2 KB with five failed runs, each carrying an error in the database", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({
      ...run(i, i % 2 ? "LICHESS" : "CHESSCOM"),
      linkedAccountId: BigInt(10 + (i % 2)),
      firstGameRef: i === 0 ? REF : null,
      firstAnalysis: i === 0 ? "RUNNING" : null,
      momentsCount: i === 0 ? 12 : null,
    }));
    const data = toImportStatus(rows as never, NOW).data;
    ImportStatusData.parse(data);
    assert.equal(data.runs.length, 5);
    assert.deepEqual(
      data.runs.map((r) => r.error !== null),
      [true, true, false, false, false],
      "only each provider's newest run carries its error (the one the client shows)",
    );
    const size = bytes(data);
    assert.ok(size <= 2 * KB, `ImportStatusData is ${size} B > 2 KB`);
  });

  it("AccountsData ≤ 2.5 KB with both providers linked, every rating pool, a run and an error each", () => {
    // Every pool each provider reports: Chess.com bullet/blitz/rapid/daily with peaks; Lichess bullet (+ultraBullet),
    // blitz, rapid, daily (correspondence) and classical, no peaks (D4-08). Five-digit game counts.
    const e = (best: number | null) => ({ rating: 2999, best, games: 99999 });
    const ratingsOf = (provider: "CHESSCOM" | "LICHESS") =>
      provider === "CHESSCOM"
        ? { v: 1, bullet: e(3000), blitz: e(3000), rapid: e(3000), daily: e(3000) }
        : { v: 1, bullet: e(null), blitz: e(null), rapid: e(null), daily: e(null), classical: e(null) };
    const account = (provider: "CHESSCOM" | "LICHESS", i: number): AccountRow => ({
      id: BigInt(i),
      provider,
      // Chess.com usernames are 3–25 characters, Lichess 2–20; only Chess.com has an avatar URL.
      username: provider === "CHESSCOM" ? "u".repeat(25) : "l".repeat(20),
      displayName: "Display Name Of Thirty Chars X",
      avatarUrl: provider === "CHESSCOM" ? "https://images.chesscomfiles.com/uploads/v1/user/123456789.abcdef01.200x200o.0123456789ab.png" : null,
      title: "GM",
      ratings: ratingsOf(provider),
      totalRatedGames: 99999,
      verified: provider === "LICHESS",
      status: "ACTIVE",
      importState: "FAILED",
      autoImport: true,
      lastSyncAt: T,
      lastSyncOkAt: T,
      nextAllowedSyncAt: T,
      nextAutoSyncAt: T,
      importedCount: 2000,
      skippedCount: 2000,
      lastError: failedError,
    });
    const data = { items: [toAccountView(account("CHESSCOM", 1), NOW, run(1, "CHESSCOM")), toAccountView(account("LICHESS", 2), NOW, run(2, "LICHESS"))] };
    AccountsData.parse(data);
    assert.ok(data.items.every((a) => a.lastError !== null && a.run !== null && a.run.error === null), "each error once, on the account");
    // A run whose error differs from the account's (a newer failure on the run) keeps it.
    const newer = toAccountView(account("CHESSCOM", 3), NOW, run(3, "CHESSCOM", { error: { v: 1, code: "upstream", message: "503", at: NOW.toISOString() } }));
    assert.equal(newer.run?.error?.code, "upstream");
    for (const item of data.items) LinkedAccountView.parse(item);
    const size = bytes(data);
    assert.ok(size <= 2.5 * KB, `AccountsData is ${size} B > 2.5 KB`);
  });

  it("ActivationData ≤ 1 KB (an active trial with its entitlement, plan, masked email and reference)", () => {
    const viewer = viewerFixture({
      entitlement: {
        member: true,
        entitled: true,
        state: "trial",
        status: "active",
        planKey: "monthly",
        interval: "month",
        priceCents: 500,
        currentPeriodEnd: T.toISOString(),
        trial: { active: true, used: true, eligible: false, endsAt: T.toISOString(), daysLeft: 7 },
      },
      billing: { email: "a.very.long.email.address.for.testing@example-domain.test", subscriptionId: "sub_0123456789abcdefghijk" },
    });
    const data = activationData(
      "active",
      null,
      viewer.entitlement,
      viewer,
      {
        email: "a.very.long.email.address.for.testing@example-domain.test",
        dodoCustomerId: "cus_0123456789abcdefghijk",
        subscriptionProductId: "pdt_0123456789abcdefghijk",
        pendingCheckoutSessionId: "cks_0123456789abcdefghijk",
        pendingCheckoutPlan: "monthly",
        pendingCheckoutAt: T,
        trialOfferedAt: T,
        lastPaymentFailedAt: null,
      },
      { subscription_id: "sub_0123456789abcdefghijk" },
      NOW,
    );
    ActivationData.parse(data);
    const size = bytes(data);
    assert.ok(size <= KB, `ActivationData is ${size} B > 1 KB`);
  });

  // The plan's growth is the P4 select (§7.2: onboarding, accounts, import, timeZone; "grows by ≈ 320 B") on the /api/me
  // a member's every page loads (docs/decisions.md FX-18); the flag registry (P1's record of every flag) is reported
  // apart: two P4 keys. A user in the middle of onboarding (a ~10-minute stretch whose pages are seeded by the server
  // and never poll /api/me) carries the steps' view too: held to its own ceiling so it cannot creep.
  it("/api/me grows by ≤ 350 B for a member (onboarding done, one linked account); mid-onboarding stays ≤ 512 B", () => {
    const base = viewerFixture({});
    const flagsBefore = { "review-v3": true };
    const flagsAfter = { ...flagsBefore, "onboarding-v3": true, "import-v3": true };
    const p3 = meDataOf(base, flagsBefore, "build-1");
    const p4Viewer = {
      ...base,
      user: { ...base.user, timeZone: "Asia/Kolkata" },
      onboarding: {
        step: "DONE" as const,
        onboarded: true,
        onboardedAt: T,
        ratingBand: "R1200_1600" as const,
        ratingBandSource: "chesscom",
        initialRating: 1384,
        goals: ["STOP_BLUNDERING", "LEARN_OPENINGS"] as const,
        dailyMinutes: 10,
      },
      accounts: [{ provider: "chesscom" as const, username: "knightowl_88", status: "linked" as const, lastSyncAt: T.toISOString() }],
      importRun: null,
    };
    const p4 = meDataOf(p4Viewer as never, flagsBefore, "build-1");
    MeData.parse(p4);
    assert.equal("onboarding" in p4, false, "a finished onboarding is not resent on every /api/me");
    const growth = bytes(p4) - bytes(p3);
    assert.ok(growth <= 350, `/api/me grew by ${growth} B > 350 B (member)`);
    const flagsGrowth = bytes(meDataOf(p4Viewer as never, flagsAfter, "build-1")) - bytes(p4);
    assert.ok(flagsGrowth <= 50, `the two P4 flags add ${flagsGrowth} B`);

    const midFlow = {
      ...p4Viewer,
      user: { ...p4Viewer.user, onboarded: false },
      onboarding: { ...p4Viewer.onboarding, step: "GOALS" as const, onboarded: false, onboardedAt: null, goals: [] as const, dailyMinutes: null },
      importRun: { ref: REF, provider: "chesscom" as const, status: "running" as const, phase: "saving" as const, imported: 1999, total: 2000 },
    };
    const mid = meDataOf(midFlow as never, flagsBefore, "build-1");
    MeData.parse(mid);
    assert.ok(mid.onboarding, "the steps read it while onboarding runs");
    const midGrowth = bytes(mid) - bytes(meDataOf({ ...base, user: { ...base.user, onboarded: false } }, flagsBefore, "build-1"));
    assert.ok(midGrowth <= 512, `/api/me grew by ${midGrowth} B > 512 B (mid-onboarding, an import running)`);
  });
});
