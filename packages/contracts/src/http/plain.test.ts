// The zod-free contract module (AP-12): client chunks import it, so it must stay free of zod by construction (no
// imports at all), and the schema modules must hand out the very same functions and constants.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as games from "./games";
import * as legend from "./legend";
import * as plain from "./plain";
import * as practice from "./practice";
import * as review from "./review";
import * as jobs from "../internal/jobs";

describe("@repo/contracts/http/plain", () => {
  it("imports nothing (so it can never pull zod into a client chunk)", () => {
    const source = readFileSync(new URL("./plain.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /\brequire\(|\bimport\(/);
    assert.doesNotMatch(source, /^\s*export\s[^;]*\sfrom\s/m);
  });

  it("the schema modules re-export the same values", () => {
    for (const name of [
      "MAX_MOMENTS",
      "PROGRESS_EVENTS_MAX",
      "REVIEW_FALLBACK_SCHEDULE_MS",
      "REVIEW_FALLBACK_STOP_AFTER_MS",
      "REVIEW_STALL_SILENCE_MS",
      "WORKER_STALL_HEARTBEAT_MS",
      "annotatedPgnFilename",
      "reviewPath",
    ] as const) {
      assert.equal(review[name], plain[name], name);
    }
    for (const name of [
      "GAMES_PAGE_LIMIT",
      "GAMES_SEARCH_MAX",
      "GAMES_SEARCH_MIN",
      "GAME_RESULT_FILTERS",
      "GAME_TC_FILTERS",
      "gamesFilterOf",
      "gamesFilterToSearch",
    ] as const) {
      assert.equal(games[name], plain[name], name);
    }
    assert.equal(legend.LEGEND_COMPUTE_MAX_ATTEMPTS, plain.LEGEND_COMPUTE_MAX_ATTEMPTS);
    assert.equal(legend.legendComparePath, plain.legendComparePath);
    assert.equal(practice.practiceFromGamePath, plain.practiceFromGamePath);
    assert.equal(practice.practiceFromPositionPath, plain.practiceFromPositionPath);
    assert.equal(practice.practiceFromFenPath, plain.practiceFromFenPath);
    assert.equal(jobs.ANALYSIS_MIN_PLIES, plain.ANALYSIS_MIN_PLIES);
  });

  it("paths and the PGN file name", () => {
    assert.equal(plain.reviewPath("c1"), "/review/c1");
    assert.equal(plain.reviewPath("c1", { tab: "moves", ply: 3, moment: 2 }), "/review/c1?tab=moves&ply=3&m=2");
    // regression: review-opened-source — soft navigations kept document.referrer, so every open read "deeplink".
    assert.equal(plain.reviewPath("c1", { from: "game_over" }), "/review/c1?from=game_over");
    assert.equal(plain.reviewPath("c1", { from: "archive", moment: 1 }), "/review/c1?from=archive&m=1");
    assert.equal(plain.legendComparePath("c1", { tab: "practice", ply: 21 }), "/review/c1/legend?tab=practice&ply=21");
    assert.equal(plain.practiceFromGamePath("c 1", 4), "/practice?game=c%201&ply=4");
    assert.equal(
      plain.annotatedPgnFilename("Tal Fan 77", "Ångström Ünder", new Date("2026-11-09T18:42:10Z")),
      "replaychess-tal-fan-77-vs-angstrom-under-2026-11-09.pgn",
    );
  });
});
