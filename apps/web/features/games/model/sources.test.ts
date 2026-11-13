// The /games source tabs and import banner (phase-04 plan §4.11): the tab rules, the URL state of `?source=`, the
// page-1 counts and the banner model.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GamesPageMeta } from "@repo/contracts/http/games";
import { GAME_SOURCES_WIRE } from "@repo/contracts/http/review";
import { importStatusDoneFixture, importStatusImportingFixture, runWaitingFixture } from "@repo/contracts/http/fixtures/p04";
import { readPageMeta, sourceCountsOf, totalsOf, type ArchiveData } from "../data/archive";
import {
  SOURCES,
  activeDimensions,
  archiveSearch,
  clearedFilters,
  filterChips,
  isFiltered,
  keyFilter,
  parseArchiveSearch,
  sameFilter,
  withSearch,
  withSource,
  withoutSource,
} from "./filter";
import { importBannerOf, sourceTabs } from "./sources";

describe("?source= in the archive URL", () => {
  it("the zod-free list equals the contract's", () => {
    assert.deepEqual([...SOURCES], [...GAME_SOURCES_WIRE]);
  });

  it("parses a known source, drops an unknown one, and writes it back before sel", () => {
    const st = parseArchiveSearch(new URLSearchParams("result=loss&source=chesscom&sel=cabc"));
    assert.deepEqual(st.filter, { result: ["loss"], source: "chesscom" });
    assert.equal(archiveSearch(st.filter, st.sel), "result=loss&source=chesscom&sel=cabc");
    assert.deepEqual(parseArchiveSearch({ source: "fide" }).filter, {});
    assert.deepEqual(parseArchiveSearch({ source: ["lichess", "replay"] }).filter, { source: "lichess" });
  });

  it("the tab is part of the query key and G1's query, not of the popover's filters", () => {
    const f = { source: "lichess" as const };
    assert.equal(keyFilter(f).source, "lichess");
    assert.notDeepEqual(keyFilter(f), keyFilter({}));
    assert.equal(isFiltered(f), false, "a tab alone is not 'filtered'");
    assert.equal(isFiltered({ ...f, q: "tal" }), true);
    assert.equal(activeDimensions({ ...f, tc: ["blitz"] }), 1);
    assert.deepEqual(filterChips(f), []);
    assert.equal(sameFilter(f, {}), false);
  });

  it("every edit keeps the tab; Clear All keeps search and tab; picking All drops it", () => {
    const f = { source: "chesscom" as const, result: ["win" as const], q: "tal" };
    assert.deepEqual(clearedFilters(f), { q: "tal", source: "chesscom" });
    assert.equal(withSearch(f, "kasp").source, "chesscom");
    assert.deepEqual(withSource(f, "lichess"), { ...f, source: "lichess" });
    assert.deepEqual(withSource(f, null), { result: ["win"], q: "tal" });
    assert.deepEqual(withoutSource(f), { result: ["win"], q: "tal" });
  });
});

describe("page-1 counts", () => {
  const data = (meta: unknown): ArchiveData => ({ pages: [{ rows: [], meta: readPageMeta(meta) }], pageParams: [null] });

  it("keeps the P4 per-source counts when all three are numbers", () => {
    const meta = readPageMeta({ nextCursor: null, filteredTotal: 3, counts: { all: 12, replay: 4, chesscom: 6, lichess: 2 } });
    assert.deepEqual(meta.counts, { all: 12, replay: 4, chesscom: 6, lichess: 2 });
    GamesPageMeta.parse(meta);
    assert.deepEqual(readPageMeta({ counts: { all: 5, replay: 5, chesscom: "x", lichess: 0 } }).counts, { all: 5 });
  });

  it("without per-source counts (a Replay-only archive) every game is Replay Chess", () => {
    assert.deepEqual(sourceCountsOf(data({ counts: { all: 7 } })), { replay: 7, chesscom: 0, lichess: 0 });
    assert.deepEqual(sourceCountsOf(data({ counts: { all: 9, replay: 1, chesscom: 8, lichess: 0 } })), { replay: 1, chesscom: 8, lichess: 0 });
    assert.equal(sourceCountsOf(undefined), null);
    assert.equal(sourceCountsOf(data({ nextCursor: "c2" })), null, "only page 1 carries counts");
    assert.deepEqual(totalsOf(data({ filteredTotal: 4, counts: { all: 9, replay: 1, chesscom: 8, lichess: 0 } })), { all: 9, filtered: 4 });
  });
});

describe("sourceTabs", () => {
  const counts = { replay: 30, chesscom: 0, lichess: 0 };

  it("no tabs while import-v3 is off, before page 1, or for a Replay-only member", () => {
    assert.equal(sourceTabs({ enabled: false, all: 40, counts: { ...counts, chesscom: 10 }, linked: ["chesscom"], current: undefined }), null);
    assert.equal(sourceTabs({ enabled: true, all: null, counts: null, linked: [], current: undefined }), null);
    assert.equal(sourceTabs({ enabled: true, all: 30, counts, linked: [], current: undefined }), null);
  });

  it("a provider tab shows with games or a link (the open tab always stays); All and Replay Chess lead", () => {
    const tabs = sourceTabs({ enabled: true, all: 30, counts, linked: ["chesscom"], current: undefined })!;
    assert.deepEqual(tabs, [
      { id: "all", label: "All", count: 30 },
      { id: "replay", label: "Replay Chess", count: 30 },
      { id: "chesscom", label: "Chess.com", count: 0 },
    ]);
    const both = sourceTabs({ enabled: true, all: 40, counts: { replay: 30, chesscom: 0, lichess: 10 }, linked: ["chesscom"], current: undefined })!;
    assert.deepEqual(both.map((t) => t.id), ["all", "replay", "chesscom", "lichess"]);
    const open = sourceTabs({ enabled: true, all: 30, counts, linked: [], current: "lichess" })!;
    assert.deepEqual(open.map((t) => t.id), ["all", "replay", "lichess"]);
  });
});

describe("importBannerOf", () => {
  it("shows the newest queued or running run as the board's IMPORTING n / N · Provider", () => {
    assert.deepEqual(importBannerOf(importStatusImportingFixture), {
      label: "IMPORTING 212 / 480",
      value: 212,
      max: 480,
      provider: "Chess.com",
    });
  });
  it("nothing for finished, failed or trial-waiting runs", () => {
    assert.equal(importBannerOf(importStatusDoneFixture), null);
    assert.equal(importBannerOf({ runs: [runWaitingFixture], firstReview: null }), null);
    assert.equal(importBannerOf(undefined), null);
  });
});
