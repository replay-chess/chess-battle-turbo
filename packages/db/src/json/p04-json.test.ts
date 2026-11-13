// The P4 JSON column shapes (phase-04 plan 6.4): RatingsV1, ImportErrorV1 and ArchivesV1 validate on write, read
// leniently, fold Lichess pools, sanitise messages and merge archive months the way the batch statement's `||` does.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ArchivesV1,
  archiveMonthKey,
  buildArchivesPatch,
  buildRatings,
  foldRatingEntries,
  importError,
  importErrorView,
  ImportErrorV1,
  ImportSyncPayloadV1,
  mergeArchives,
  parseArchives,
  parseImportError,
  parseRatings,
  ratingsView,
  sanitiseImportMessage,
} from "./index";

describe("RatingsV1", () => {
  it("accepts the design's knightowl_88 ratings and rejects a bad pool or a fractional rating", () => {
    const r = buildRatings({ v: 1, rapid: { rating: 1184, best: 1243, games: 312 }, blitz: { rating: 1032, best: null, games: 141 } });
    assert.equal(r.rapid?.rating, 1184);
    assert.throws(() => buildRatings({ v: 1, rapid: { rating: 1184.5, best: null, games: 1 } }));
    assert.throws(() => buildRatings({ v: 1, rapid: { rating: 1184, best: null, games: -1 } }));
    assert.throws(() => buildRatings({ v: 2 }));
  });

  it("reads a missing or newer value as no ratings; the view drops v", () => {
    assert.deepEqual(parseRatings(null), { v: 1 });
    assert.deepEqual(parseRatings({ v: 2, rapid: {} }), { v: 1 });
    assert.deepEqual(ratingsView({ v: 1, bullet: { rating: 900, best: null, games: 3 } }), { bullet: { rating: 900, best: null, games: 3 } });
  });

  it("folds ultraBullet into bullet: more games keeps its rating, games add up, the higher peak wins", () => {
    assert.deepEqual(
      foldRatingEntries({ rating: 1500, best: 1600, games: 40 }, { rating: 1300, best: null, games: 10 }),
      { rating: 1500, best: 1600, games: 50 },
    );
    assert.deepEqual(foldRatingEntries(undefined, { rating: 1300, best: 1350, games: 10 }), { rating: 1300, best: 1350, games: 10 });
    assert.equal(foldRatingEntries(undefined, undefined), undefined);
  });
});

describe("ImportErrorV1", () => {
  const at = new Date("2026-11-10T09:30:00Z");
  it("builds a sanitised value and its wire view", () => {
    const e = importError("upstream", "GET https://api.chess.com/pub/player/x?token=abc failed for a@b.co\n503", at, {
      retryAt: new Date("2026-11-10T09:31:00Z"),
      httpStatus: 503,
    });
    assert.equal(e.message.includes("https://"), false);
    assert.equal(e.message.includes("a@b.co"), false);
    assert.equal(e.message.includes("\n"), false);
    assert.deepEqual(importErrorView(e), { code: "upstream", at: "2026-11-10T09:30:00.000Z", retryAt: "2026-11-10T09:31:00.000Z" });
    assert.equal(ImportErrorV1.safeParse(e).success, true);
  });

  it("caps the message at 200 chars and rejects token_revoked (D4-21)", () => {
    assert.equal(sanitiseImportMessage("x".repeat(500)).length, 200);
    assert.equal(ImportErrorV1.safeParse({ v: 1, code: "token_revoked", message: "", at: at.toISOString() }).success, false);
    assert.equal(parseImportError({ v: 1, code: "token_revoked", message: "", at: at.toISOString() }), null);
    assert.equal(importErrorView(importError("not_found", "404", at)).retryAt, null);
  });
});

describe("ArchivesV1", () => {
  it("keys months as YYYY/MM and merges month by month", () => {
    assert.equal(archiveMonthKey(2026, 9), "2026/09");
    assert.throws(() => archiveMonthKey(2026, 13));
    const stored = parseArchives({ v: 1, months: { "2026/08": { done: true, games: 16, skipped: 1, etag: "a" } } });
    const merged = mergeArchives(stored, { months: { "2026/09": { done: false, games: 3, skipped: 0 } } });
    assert.deepEqual(Object.keys(merged.months).sort(), ["2026/08", "2026/09"]);
    assert.equal(buildArchivesPatch(merged).months["2026/08"]?.etag, "a");
    assert.deepEqual(parseArchives("garbage"), { v: 1, months: {} });
    assert.equal(ArchivesV1.safeParse({ v: 1, months: { "2026-09": { done: true, games: 1, skipped: 0 } } }).success, false);
  });
});

describe("P4 job payloads in the registry", () => {
  it("re-exports the contract's IMPORT_SYNC payload", () => {
    assert.equal(ImportSyncPayloadV1.safeParse({ v: 1, linkedAccountId: "1", runId: null, trigger: "DAILY" }).success, true);
  });
});
