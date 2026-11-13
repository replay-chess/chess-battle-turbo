// lib/realtime/handlers/import.ts: the pure cache updaters for `import:*` and the first-review `analysis:done`, and
// applyImportEvent() on a real QueryClient.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { AccountsData, LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import type { ImportStatusData } from "@repo/contracts/http/import";
import { MeData } from "@repo/contracts/http/me";
import { qk } from "@/lib/api/keys";
import { accountsOnEvent, applyImportEvent, importsOnAnalysisDone, importsOnEvent, meOnEvent, runOnEvent } from "./import";

const NOW = "2026-11-12T10:00:00.000Z";
const REF = "crunaaaaaaaaaaaaaaaaaaaaaa";
const GAME = "cgamebbbbbbbbbbbbbbbbbbbbb";

function run(over: Partial<RunView> = {}): RunView {
  return {
    ref: REF,
    provider: "chesscom",
    trigger: "initial",
    status: "queued",
    phase: null,
    seen: 0,
    total: null,
    imported: 0,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: "2026-11-12T09:00:00.000Z",
    ...over,
  };
}

function account(over: Partial<LinkedAccountView> = {}): LinkedAccountView {
  return {
    provider: "chesscom",
    username: "knightowl_88",
    displayName: null,
    avatarUrl: null,
    title: null,
    ratings: {},
    headline: null,
    totalRatedGames: 480,
    verified: false,
    status: "queued",
    autoImport: true,
    lastSyncAt: null,
    lastSyncOkAt: null,
    nextAllowedSyncAt: null,
    nextAutoSyncAt: null,
    importedCount: 0,
    skippedCount: 0,
    lastError: null,
    run: run(),
    ...over,
  };
}

const progress = { v: 1 as const, runRef: REF, provider: "chesscom" as const, phase: "saving" as const, seen: 300, imported: 212, total: 480, analysed: 3 };
const finished = { v: 1 as const, runRef: REF, provider: "chesscom" as const, imported: 470, skipped: 10, total: 480, newGames: 470, analysisQueued: 20, analysed: 5, firstReviewGameRef: GAME };
const failed = { v: 1 as const, runRef: REF, provider: "chesscom" as const, code: "upstream" as const, retryAt: null, imported: 100, total: 480 };
const paused = { ...failed, code: "rate_limited" as const, retryAt: "2026-11-12T10:01:00.000Z" };

describe("run updaters", () => {
  it("progress → running with the counters; never backwards on imported/analysed", () => {
    const r = runOnEvent(run({ imported: 250 }), "import:progress", progress, NOW);
    assert.deepEqual([r.status, r.phase, r.seen, r.imported, r.total, r.analysed, r.updatedAt], ["running", "saving", 300, 250, 480, 3, NOW]);
  });

  it("finished → done; failed → failed with the error; rate_limited → back to queued (a pause)", () => {
    assert.equal(runOnEvent(run(), "import:finished", finished, NOW).status, "done");
    const f = runOnEvent(run(), "import:failed", failed, NOW);
    assert.deepEqual([f.status, f.error], ["failed", { code: "upstream", at: NOW, retryAt: null }]);
    const p = runOnEvent(run(), "import:failed", paused, NOW);
    assert.deepEqual([p.status, p.error?.code, p.finishedAt], ["queued", "rate_limited", null]);
  });

  it("a terminal run ignores late progress; another run is untouched", () => {
    const done = run({ status: "done" });
    assert.equal(runOnEvent(done, "import:progress", progress, NOW), done);
    const other = run({ ref: "cotherrrrrrrrrrrrrrrrrrrrr" });
    assert.equal(runOnEvent(other, "import:progress", progress, NOW), other);
  });
});

describe("cache updaters", () => {
  it("imports: patches the run; a finished run sets firstReview; an unknown run is `missing`", () => {
    const d: ImportStatusData = { runs: [run()], firstReview: null };
    const out = importsOnEvent(d, "import:finished", finished, NOW);
    assert.equal(out.missing, false);
    assert.deepEqual(out.next.firstReview, { gameRef: GAME, analysisStatus: "queued", momentsCount: null });
    assert.equal(importsOnEvent({ runs: [], firstReview: null }, "import:progress", progress, NOW).missing, true);
    const ready = importsOnAnalysisDone(out.next, { gameRef: GAME, momentsCount: 4 });
    assert.deepEqual(ready.firstReview, { gameRef: GAME, analysisStatus: "done", momentsCount: 4 });
    assert.equal(importsOnAnalysisDone(ready, { gameRef: "cxxxxxxxxxxxxxxxxxxxxxxxxx", momentsCount: 1 }), ready);
  });

  it("accounts: syncing on progress, linked + counters on finish, rate_limited with the countdown on a pause", () => {
    const d: AccountsData = { items: [account()] };
    assert.equal(accountsOnEvent(d, "import:progress", progress, NOW).next.items[0]!.status, "syncing");
    const done = accountsOnEvent(d, "import:finished", finished, NOW).next.items[0]!;
    assert.deepEqual([done.status, done.importedCount, done.lastSyncOkAt], ["linked", 470, NOW]);
    const p = accountsOnEvent(d, "import:failed", paused, NOW).next.items[0]!;
    assert.deepEqual([p.status, p.nextAllowedSyncAt], ["rate_limited", paused.retryAt]);
    assert.equal(accountsOnEvent(d, "import:failed", failed, NOW).next.items[0]!.status, "error");
    assert.equal(accountsOnEvent({ items: [account({ run: null })] }, "import:progress", progress, NOW).missing, true);
  });

  it("me: the import summary and the account status", () => {
    const me = MeData.parse({
      user: { ref: "cmeeeeeeeeeeeeeeeeeeeeeeee", code: "ABC123", name: "M", email: "m@example.test", avatarUrl: null, role: "user", onboarded: true, ratingLabel: null },
      entitlement: {
        state: "member", member: true, entitled: true, paywall: true, planKey: "monthly", interval: "month", priceCents: 499, status: "active",
        currentPeriodEnd: null, cancelAtPeriodEnd: false, trial: { active: false, used: false, endsAt: null, daysLeft: null, eligible: false },
        paymentIssue: null, hasBillingPortal: true,
      },
      flags: {},
      buildId: "b",
      accounts: [{ provider: "chesscom", username: "knightowl_88", status: "queued", lastSyncAt: null }],
      import: null,
    });
    const next = MeData.parse(meOnEvent(me, "import:progress", progress));
    assert.deepEqual(next.import, { ref: REF, provider: "chesscom", status: "running", phase: "saving", imported: 212, total: 480 });
    assert.equal(next.accounts![0]!.status, "syncing");
    assert.equal(MeData.parse(meOnEvent(me, "import:finished", finished)).import?.status, "done");
  });
});

describe("applyImportEvent", () => {
  it("writes every cache that holds the run; a terminal event refetches imports/accounts and stales the archive", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.imports(), { runs: [run()], firstReview: null });
    qc.setQueryData(qk.accounts(), { items: [account()] });
    qc.setQueryData(qk.games.all(), { x: 1 });
    assert.equal(applyImportEvent(qc, "import:progress", progress, new Date(NOW)), false);
    assert.equal(qc.getQueryData<ImportStatusData>(qk.imports())!.runs[0]!.imported, 212);
    assert.equal(qc.getQueryData<AccountsData>(qk.accounts())!.items[0]!.status, "syncing");
    assert.equal(applyImportEvent(qc, "import:finished", finished, new Date(NOW)), true);
    assert.equal(qc.getQueryState(qk.games.all())?.isInvalidated, true);
    assert.equal(qc.getQueryState(qk.imports())?.isInvalidated, true);
  });

  it("an unknown run marks the imports stale instead of inventing one", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.imports(), { runs: [], firstReview: null });
    assert.equal(applyImportEvent(qc, "import:progress", progress), true);
    assert.equal(qc.getQueryState(qk.imports())?.isInvalidated, true);
  });
});
