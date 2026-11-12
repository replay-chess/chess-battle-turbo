import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewClientEvents } from "@repo/analytics";
import { backLabel, shellBack, engineFirstLine, engineLine, loadingLine, practiceFrom, readyLine } from "./copy";

describe("practice copy", () => {
  it("the board's lines", () => {
    assert.equal(engineLine(1400, "w"), "Engine 1400 plays Black. Untimed and unrated; take back as often as you like.");
    assert.equal(engineFirstLine(1400, "b"), "Engine 1400 plays White. The engine moves first.");
    assert.equal(readyLine("w"), "Engine ready · your move as White");
    assert.equal(loadingLine(34.4), "Starting the engine · 34%");
    assert.equal(loadingLine(140), "Starting the engine · 100%");
  });

  it("Back is named by where it goes", () => {
    assert.equal(backLabel("/review/abc/legend"), "Back to the Comparison");
    assert.equal(backLabel("/review/abc"), "Back to the Review");
    assert.equal(backLabel("/position/xyz"), "Back to the Position");
    assert.equal(backLabel("/"), "Back");
  });

  // regression: review-back-wrong-target (FIX-2): the phone top bar's Back on practice said "Back to Review" and went
  // to /games; it now goes where practice came from, with that place's name.
  it("the phone top bar's Back goes where practice came from", () => {
    assert.deepEqual(shellBack("/review/abc/legend"), { key: "review", href: "/review/abc/legend", label: "Comparison" });
    assert.deepEqual(shellBack("/review/abc"), { key: "review", href: "/review/abc", label: "Review" });
    assert.deepEqual(shellBack("/position/xyz"), { key: "play", href: "/position/xyz", label: "Position" });
    assert.deepEqual(shellBack("/play"), { key: "play", href: "/play", label: "Play" });
  });

  it("practice_started.from from the link, the referrer or the source, always a registry value", () => {
    assert.equal(practiceFrom("game_over", null, "game"), "game_over");
    assert.equal(practiceFrom(null, "/review/abc/legend", "game"), "compare");
    assert.equal(practiceFrom(null, "/review/abc", "game"), "review");
    assert.equal(practiceFrom(null, "/game/abc", "game"), "game_over");
    assert.equal(practiceFrom("nope", null, "fen"), "fen");
    assert.equal(practiceFrom(null, null, "position"), "position");
    for (const from of ["compare", "review", "position", "fen", "game_over"] as const) {
      assert.equal(reviewClientEvents.practice_started.safeParse({ from, ply_bucket: 20 }).success, true);
    }
  });
});
