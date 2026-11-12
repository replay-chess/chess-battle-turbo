import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GAME_RESULT_FILTERS,
  GAME_TC_FILTERS,
  GAMES_PAGE_LIMIT,
  GAMES_SEARCH_MAX,
  GAMES_SEARCH_MIN,
  GamesQuery,
  gamesFilterOf,
  gamesFilterToSearch,
} from "@repo/contracts/http/games";
import { qk } from "@/lib/api/keys";
import {
  PAGE_LIMIT,
  RESULT_FILTERS,
  SEARCH_MAX,
  SEARCH_MIN,
  TC_FILTERS,
  activeDimensions,
  activeFilterCount,
  archiveSearch,
  clearedFilters,
  filterChips,
  filterOf,
  g1Search,
  isFiltered,
  keyFilter,
  parseArchiveSearch,
  resultSegmentOf,
  sameFilter,
  withMoments,
  withResultSegment,
  withSearch,
  withTc,
} from "./filter";

const RAW_CASES: { q?: string; result?: string; tc?: string; moments?: string }[] = [
  {},
  { q: "tal" },
  { q: " t " },
  { q: "x" },
  { q: "  pawnstorm22  " },
  { q: "a".repeat(40) },
  { result: "win" },
  { result: "draw,win" },
  { result: "win,draw" },
  { result: "WIN, Loss ,bogus" },
  { result: "bogus" },
  { result: "" },
  { tc: "rapid,blitz" },
  { tc: "classical,bullet,blitz,rapid" },
  { tc: "untimed" },
  { moments: "1" },
  { moments: "true" },
  { moments: "TRUE" },
  { moments: "yes" },
  { moments: "on" },
  { moments: "0" },
  { moments: "false" },
  { moments: "off" },
  { moments: "no" },
  { q: "tal", result: "loss", tc: "rapid", moments: "1" },
];

describe("archive filter: parity with the contract", () => {
  it("uses the contract's values and limits", () => {
    assert.deepEqual([...RESULT_FILTERS], [...GAME_RESULT_FILTERS]);
    assert.deepEqual([...TC_FILTERS], [...GAME_TC_FILTERS]);
    assert.equal(SEARCH_MIN, GAMES_SEARCH_MIN);
    assert.equal(SEARCH_MAX, GAMES_SEARCH_MAX);
    assert.equal(PAGE_LIMIT, GAMES_PAGE_LIMIT);
  });

  it("parses every raw query exactly as GamesQuery + gamesFilterOf (the server's G1 and RSC path)", () => {
    for (const raw of RAW_CASES) {
      const wire = GamesQuery.parse(raw);
      assert.deepEqual(filterOf(raw), gamesFilterOf(wire), JSON.stringify(raw));
    }
  });

  it("writes the same query string as gamesFilterToSearch", () => {
    for (const raw of RAW_CASES) {
      const f = filterOf(raw);
      assert.equal(archiveSearch(f), gamesFilterToSearch(f), JSON.stringify(raw));
    }
  });

  it("G1's query string parses back through GamesQuery with the cursor and limit", () => {
    const f = filterOf({ q: "tal", result: "loss,win", tc: "rapid", moments: "1" });
    const qs = new URLSearchParams(g1Search(f, "WzEsIjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsIjQyIl0", 0));
    const parsed = GamesQuery.parse(Object.fromEntries(qs));
    assert.equal(parsed.limit, 0);
    assert.equal(parsed.cursor, "WzEsIjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsIjQyIl0");
    assert.deepEqual(gamesFilterOf(parsed), f);
    assert.equal(new URLSearchParams(g1Search({}, null)).get("limit"), "30");
    assert.equal(new URLSearchParams(g1Search({}, null)).has("cursor"), false);
  });
});

describe("archive URL state", () => {
  it("round-trips filter and selection", () => {
    const f = filterOf({ q: "tal", result: "loss", tc: "blitz,rapid", moments: "1" });
    const s = archiveSearch(f, "cm3kc1a2b000cslzp0k3d7f9h");
    assert.equal(s, "q=tal&result=loss&tc=blitz%2Crapid&moments=1&sel=cm3kc1a2b000cslzp0k3d7f9h");
    const back = parseArchiveSearch(new URLSearchParams(s));
    assert.deepEqual(back.filter, f);
    assert.equal(back.sel, "cm3kc1a2b000cslzp0k3d7f9h");
    assert.equal(back.text, "tal");
  });

  it("reads the RSC searchParams record (arrays take the first value)", () => {
    const st = parseArchiveSearch({ q: ["x", "y"], result: "draw", sel: undefined });
    assert.equal(st.text, "x");
    assert.deepEqual(st.filter, { result: ["draw"] });
    assert.equal(st.sel, null);
  });

  it("drops a malformed selection", () => {
    assert.equal(parseArchiveSearch(new URLSearchParams("sel=../etc")).sel, null);
    assert.equal(parseArchiveSearch(new URLSearchParams("sel=")).sel, null);
  });

  it("keeps a 1-character search as text but not as a filter", () => {
    const st = parseArchiveSearch(new URLSearchParams("q=t"));
    assert.equal(st.text, "t");
    assert.deepEqual(st.filter, {});
    assert.equal(isFiltered(st.filter), false);
  });
});

describe("archive query keys", () => {
  it("gives equal keys for equal filters written in any order", () => {
    const a = qk.games.list(keyFilter(filterOf({ result: "win,draw", tc: "rapid,blitz" })));
    const b = qk.games.list(keyFilter(filterOf({ tc: "blitz,rapid", result: "draw,win" })));
    assert.deepEqual(a, b);
    assert.deepEqual(qk.games.list(keyFilter({})), ["games", "list", {}]);
  });

  it("starts with the domain, so invalidating ['games'] covers every list", () => {
    assert.deepEqual(qk.games.list(keyFilter({ moments: true })).slice(0, 2), ["games", "list"]);
  });
});

describe("filter edits", () => {
  it("the Result segment picks one result or all", () => {
    assert.equal(resultSegmentOf({}), "all");
    assert.equal(resultSegmentOf({ result: ["loss"] }), "loss");
    assert.equal(resultSegmentOf({ result: ["win", "loss"] }), "all");
    assert.deepEqual(withResultSegment({ tc: ["rapid"] }, "loss"), { tc: ["rapid"], result: ["loss"] });
    assert.deepEqual(withResultSegment({ result: ["loss"] }, "all"), {});
  });

  it("time controls keep the canonical order and drop an empty list", () => {
    assert.deepEqual(withTc({}, ["rapid", "bullet"]), { tc: ["bullet", "rapid"] });
    assert.deepEqual(withTc({ tc: ["rapid"] }, []), {});
  });

  it("moments and search", () => {
    assert.deepEqual(withMoments({}, true), { moments: true });
    assert.deepEqual(withMoments({ moments: true }, false), {});
    assert.deepEqual(withSearch({ tc: ["blitz"] }, "  tal "), { tc: ["blitz"], q: "tal" });
    assert.deepEqual(withSearch({ q: "tal" }, "t"), {});
  });

  it("chips: one per value, removable, search excluded; Clear All keeps the search", () => {
    const f = filterOf({ q: "tal", result: "loss", tc: "blitz,rapid", moments: "1" });
    const chips = filterChips(f);
    assert.deepEqual(
      chips.map((c) => c.label),
      ["Losses", "Blitz", "Rapid", "With Moments"],
    );
    assert.equal(activeFilterCount(f), 4);
    assert.equal(activeDimensions(f), 4);
    assert.deepEqual(chips[1]!.without, { q: "tal", result: ["loss"], tc: ["rapid"], moments: true });
    assert.deepEqual(chips[3]!.without, { q: "tal", result: ["loss"], tc: ["blitz", "rapid"] });
    assert.deepEqual(clearedFilters(f), { q: "tal" });
    assert.deepEqual(clearedFilters({ tc: ["rapid"] }), {});
  });

  it("sameFilter ignores order", () => {
    assert.ok(sameFilter({ tc: ["blitz", "rapid"] }, filterOf({ tc: "rapid,blitz" })));
    assert.ok(!sameFilter({ tc: ["blitz"] }, {}));
  });
});
