// Row → wire mappers of the accounts / import DAL (lib/data/import-rows.ts, lib/data/imports.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import { ImportStatusData } from "@repo/contracts/http/import";
import { runOfPrefixed, toAccountView, toRunView, type AccountRow, type RunRow } from "./import-rows";
import { toImportStatus } from "./imports";

const NOW = new Date("2026-11-12T10:00:00.000Z");

const runRow = (over: Partial<RunRow> = {}): RunRow => ({
  referenceId: "crunaaaaaaaaaaaaaaaaaaaaaa",
  provider: "LICHESS",
  trigger: "INITIAL",
  status: "WAITING_FOR_MEMBERSHIP",
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
  updatedAt: NOW,
  ...over,
});

describe("toRunView", () => {
  it("lower-case wire enums, ISO times, the public part of the error", () => {
    const v = RunView.parse(
      toRunView(runRow({ status: "FAILED", trigger: "RETRY", phase: "saving", error: { v: 1, code: "timeout", message: "x", at: NOW.toISOString(), retryAt: NOW.toISOString() } })),
    );
    assert.deepEqual([v.provider, v.status, v.trigger, v.phase], ["lichess", "failed", "retry", "saving"]);
    assert.deepEqual(v.error, { code: "timeout", at: NOW.toISOString(), retryAt: NOW.toISOString() });
    assert.equal(toRunView(runRow({ phase: "bogus", error: { bad: true } })).phase, null);
    assert.equal(toRunView(runRow({ error: { bad: true } })).error, null);
  });
});

describe("toAccountView", () => {
  const row = (over: Partial<AccountRow> = {}): AccountRow =>
    ({
      id: 5n,
      provider: "CHESSCOM",
      username: "KnightOwl_88",
      displayName: "Knight Owl",
      avatarUrl: null,
      title: null,
      ratings: { v: 1, rapid: { rating: 1184, best: 1250, games: 120 }, blitz: { rating: 1032, best: null, games: 40 } },
      totalRatedGames: 160,
      verified: false,
      status: "ACTIVE",
      importState: "IDLE",
      autoImport: true,
      lastSyncAt: NOW,
      lastSyncOkAt: NOW,
      nextAllowedSyncAt: null,
      nextAutoSyncAt: null,
      importedCount: 150,
      skippedCount: 10,
      lastError: null,
      ...over,
    }) as AccountRow;

  it("the §8.11 view status, ratings without v, the headline, and the prefixed run", () => {
    const v = LinkedAccountView.parse(toAccountView(row({ run_referenceId: null }), NOW));
    assert.equal(v.status, "linked");
    assert.deepEqual(v.ratings, { rapid: { rating: 1184, best: 1250, games: 120 }, blitz: { rating: 1032, best: null, games: 40 } });
    assert.deepEqual(v.headline, { timeClass: "rapid", rating: 1184 });
    assert.equal(v.run, null);
    const limited = toAccountView(row({ nextAllowedSyncAt: new Date(NOW.getTime() + 60_000) }), NOW);
    assert.equal(limited.status, "rate_limited");
    const withRun = row({
      run_referenceId: "crunaaaaaaaaaaaaaaaaaaaaaa",
      run_provider: "CHESSCOM",
      run_trigger: "MANUAL",
      run_status: "RUNNING",
      run_phase: "reading",
      run_seen: 10,
      run_total: null,
      run_imported: 0,
      run_skipped: 0,
      run_analysisQueued: 0,
      run_analysed: 0,
      run_error: null,
      run_startedAt: NOW,
      run_finishedAt: null,
      run_updatedAt: NOW,
    });
    assert.equal(runOfPrefixed(withRun)?.status, "RUNNING");
    assert.equal(LinkedAccountView.parse(toAccountView(withRun, NOW)).run?.status, "running");
  });
});

describe("toImportStatus", () => {
  it("firstReview from the newest run with a first game; stale QUEUED runs (> 30 s) are heal candidates, once per account", () => {
    const rows = [
      { ...runRow({ status: "QUEUED", updatedAt: new Date(NOW.getTime() - 31_000) }), linkedAccountId: 7n, firstGameRef: null, firstAnalysis: null, momentsCount: null },
      { ...runRow({ referenceId: "crunbbbbbbbbbbbbbbbbbbbbbb", status: "DONE" }), linkedAccountId: 7n, firstGameRef: "cgameccccccccccccccccccccc", firstAnalysis: "DONE", momentsCount: 3 },
      { ...runRow({ referenceId: "cruncccccccccccccccccccccc", status: "QUEUED", updatedAt: new Date(NOW.getTime() - 5_000) }), linkedAccountId: 8n, firstGameRef: null, firstAnalysis: null, momentsCount: null },
    ];
    const out = toImportStatus(rows, NOW);
    ImportStatusData.parse(out.data);
    assert.deepEqual(out.data.firstReview, { gameRef: "cgameccccccccccccccccccccc", analysisStatus: "done", momentsCount: 3 });
    assert.deepEqual(out.staleQueued, [7n]);
    assert.deepEqual(toImportStatus([], NOW), { data: { runs: [], firstReview: null }, staleQueued: [], waiting: false });
    assert.equal(out.waiting, false);
    const parked = toImportStatus([{ ...rows[0]!, status: "WAITING_FOR_MEMBERSHIP" }], NOW);
    assert.equal(parked.waiting, true, "a parked run is the status read's release candidate (FIX-1)");
    assert.deepEqual(parked.staleQueued, []);
  });
});
