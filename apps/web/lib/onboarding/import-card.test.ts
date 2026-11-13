// Import progress card state mapping (phase-04 plan §4.7, §4.8; D4-07).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunView } from "@repo/contracts/http/accounts";
import { etaLabel, firstReviewHint, formatCount, importCardView, type ImportCardInput } from "./import-card";

const T = "2026-11-12T10:00:00.000Z";

function run(over: Partial<RunView> = {}): RunView {
  return {
    ref: "run_1",
    provider: "chesscom",
    trigger: "initial",
    status: "running",
    phase: "saving",
    seen: 480,
    total: 480,
    imported: 212,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    error: null,
    startedAt: T,
    finishedAt: null,
    updatedAt: T,
    ...over,
  };
}

const input = (over: Partial<ImportCardInput> = {}): ImportCardInput => ({
  context: "done",
  run: run(),
  firstReview: null,
  linked: ["chesscom"],
  entitled: true,
  trial: true,
  etaSec: null,
  ...over,
});

describe("saving (board: importing)", () => {
  it("counts and a determinate bar; ETA on Done", () => {
    const v = importCardView(input({ etaSec: 130 }));
    assert.equal(v.state, "saving");
    assert.equal(v.boardState, "importing");
    assert.equal(v.label, "Importing games");
    assert.equal(v.count, "212 / 480");
    assert.deepEqual(v.bar, { kind: "determinate", value: 212, max: 480 });
    assert.equal(v.hint, "About 2 minutes left. We'll show your first review on Home.");
  });

  it("no ETA yet: the plain hint", () => {
    assert.equal(importCardView(input()).hint, "We'll show your first review on Home.");
  });

  it("activating says it runs in the background (V3OnbActivating)", () => {
    const v = importCardView(input({ context: "activating", etaSec: 130 }));
    assert.equal(v.hint, "Runs in the background either way.");
  });

  it("never shows more imported than the total", () => {
    const v = importCardView(input({ run: run({ imported: 500 }) }));
    assert.equal(v.count, "480 / 480");
  });

  it("five-digit counts are grouped", () => {
    assert.equal(importCardView(input({ run: run({ imported: 12480, total: 20000 }) })).count, "12,480 / 20,000");
  });
});

describe("reading (board: importing)", () => {
  it("'{seen} found' and an indeterminate bar", () => {
    const v = importCardView(input({ run: run({ phase: "reading", total: null, imported: 0, seen: 1234 }) }));
    assert.equal(v.state, "reading");
    assert.equal(v.label, "Importing games · 1,234 found");
    assert.deepEqual(v.bar, { kind: "indeterminate", text: "1,234 games found" });
    assert.equal(v.hint, "We'll show your first review on Home.");
  });
});

describe("waiting for the trial (D4-07)", () => {
  it("a run waiting for membership", () => {
    const v = importCardView(input({ context: "activating", run: run({ status: "waiting_for_membership", phase: null, imported: 0, total: null }) }));
    assert.equal(v.state, "waiting");
    assert.equal(v.bar, null);
    assert.equal(v.hint, "Waiting for your trial to start. Runs in the background either way.");
  });

  it("a linked account and no run before entitlement", () => {
    const v = importCardView(input({ run: null, entitled: false, trial: false }));
    assert.equal(v.state, "waiting");
    assert.equal(v.hint, "Starts as soon as your membership is confirmed.");
  });
});

describe("queued", () => {
  it("entitled with a link but no run yet", () => {
    const v = importCardView(input({ run: null }));
    assert.equal(v.state, "queued");
    assert.equal(v.hint, "Starting the import. We'll show your first review on Home.");
  });

  it("a rate-limit pause says so", () => {
    const v = importCardView(input({ run: run({ status: "queued", error: { code: "rate_limited", at: T, retryAt: T } }) }));
    assert.equal(v.state, "queued");
    assert.match(v.hint, /^Chess\.com asked us to slow down/);
  });
});

describe("done (board: imported)", () => {
  it("imported games and the first review's moments", () => {
    const v = importCardView(
      input({ run: run({ status: "done", phase: null, imported: 480 }), firstReview: { gameRef: "g1", analysisStatus: "done", momentsCount: 3 } }),
    );
    assert.equal(v.state, "imported");
    assert.equal(v.boardState, "imported");
    assert.equal(v.label, "Imported");
    assert.equal(v.count, "480 games");
    assert.equal(v.hint, "The coach found 3 moments in your last game. They're first on Home.");
    assert.equal(v.bar, null);
  });

  it("zero games", () => {
    const v = importCardView(input({ run: run({ status: "done", phase: null, imported: 0, total: 0 }) }));
    assert.equal(v.state, "empty");
    assert.equal(v.count, "0 games");
    assert.equal(v.hint, "Nothing to import yet. Your first game here starts your Mistake Bank.");
  });

  it("one game is singular", () => {
    assert.equal(importCardView(input({ run: run({ status: "done", phase: null, imported: 1, total: 1 }) })).count, "1 game");
  });
});

describe("failed (board: import_failed)", () => {
  it("stopped at N of M, provider named, Retry Import", () => {
    const v = importCardView(input({ run: run({ status: "failed", phase: "saving", error: { code: "upstream", at: T, retryAt: null } }) }));
    assert.equal(v.state, "failed");
    assert.equal(v.boardState, "import_failed");
    assert.equal(v.tone, "bad");
    assert.equal(v.label, "Import stopped at 212 of 480");
    assert.equal(v.hint, "Chess.com stopped answering. We'll retry in the background, or you can now.");
    assert.equal(v.retry, true);
  });

  it("without a total", () => {
    const v = importCardView(input({ run: run({ status: "failed", total: null, imported: 0, provider: "lichess", error: { code: "timeout", at: T, retryAt: null } }) }));
    assert.equal(v.label, "Import stopped at 0 games");
    assert.match(v.hint, /^Lichess stopped answering/);
  });

  it("a closed or missing account points at Settings instead of Retry", () => {
    for (const code of ["closed", "not_found"] as const) {
      const v = importCardView(input({ run: run({ status: "failed", error: { code, at: T, retryAt: null } }) }));
      assert.equal(v.retry, false);
      assert.equal(v.settingsLink, true);
    }
  });
});

describe("nothing linked", () => {
  it("points at Settings · Connected accounts", () => {
    const v = importCardView(input({ run: null, linked: [] }));
    assert.equal(v.state, "none");
    assert.equal(v.boardState, null);
    assert.equal(v.settingsLink, true);
    assert.equal(v.hint, "Link Chess.com or Lichess any time in");
  });

  it("a cancelled run reads as no run", () => {
    assert.equal(importCardView(input({ run: run({ status: "cancelled" }), linked: [] })).state, "none");
  });
});

describe("etaLabel", () => {
  it("buckets", () => {
    assert.equal(etaLabel(null), null);
    assert.equal(etaLabel(-1), null);
    assert.equal(etaLabel(Number.NaN), null);
    assert.equal(etaLabel(0), "Less than a minute");
    assert.equal(etaLabel(59), "Less than a minute");
    assert.equal(etaLabel(60), "About a minute");
    assert.equal(etaLabel(89), "About a minute");
    assert.equal(etaLabel(90), "About 2 minutes");
    assert.equal(etaLabel(600), "About 10 minutes");
  });
});

describe("firstReviewHint", () => {
  it("each analysis outcome", () => {
    assert.equal(firstReviewHint(null), "Your first review is being prepared.");
    assert.equal(firstReviewHint({ gameRef: "g", analysisStatus: "running", momentsCount: null }), "Your first review is being prepared.");
    assert.equal(firstReviewHint({ gameRef: "g", analysisStatus: "done", momentsCount: 0 }), "Your last game was clean. Nice.");
    assert.equal(firstReviewHint({ gameRef: "g", analysisStatus: "done", momentsCount: 1 }), "The coach found 1 moment in your last game. They're first on Home.");
    assert.equal(firstReviewHint({ gameRef: "g", analysisStatus: "done", momentsCount: null }), "Your first review is ready. It's first on Home.");
  });
  it("formatCount", () => {
    assert.equal(formatCount(12480), "12,480");
    assert.equal(formatCount(-3), "0");
  });
});
