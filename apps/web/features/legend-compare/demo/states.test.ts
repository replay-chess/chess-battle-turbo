import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LegendCompareDTO } from "@repo/contracts/http/legend";
import { compareLines } from "../model";
import { COMPARE_DEMO_STATES, compareDemoDto, compareDemoExplanation, OPPONENT_LEFT_UCI, silentWav } from "./states";

describe("compare demo payloads", () => {
  it("every state (and its stress variant) is a valid A9 payload", () => {
    for (const state of COMPARE_DEMO_STATES) {
      for (const stress of [false, true]) {
        const r = LegendCompareDTO.safeParse(compareDemoDto(state, stress));
        assert.equal(r.success, true, `${state} stress=${stress}: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
      }
    }
  });

  it("followed: no divergence, every row matched", () => {
    const dto = compareDemoDto("followed");
    assert.equal(dto.divergence, null);
    assert.ok(dto.yourLine.rows.every((r) => r.mark === "match"));
    assert.equal(dto.summaryLine, "You found every one of Morphy’s moves.");
  });

  it("opponent left: the engine's 11…Nfd7, the comparison stops there", () => {
    const dto = compareDemoDto("opponent_left");
    assert.equal(dto.divergence?.by, "opponent");
    assert.equal(dto.divergence?.userSan, "Nfd7");
    assert.equal(dto.divergence?.legendSan, "Nbd7");
    assert.match(dto.paragraph, /^The engine left the game’s path on 11…Nfd7/);
    assert.equal(compareLines(dto).yours.length, OPPONENT_LEFT_UCI.length + 1, "the whole demo line replays");
  });

  it("the explanation and the silent narration audio", () => {
    assert.equal(compareDemoExplanation().segments.length, 5);
    const wav = silentWav(2, 1000);
    assert.equal(wav.length, 44 + 2000);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    assert.equal(new DataView(wav.buffer).getUint32(40, true), 2000);
    assert.equal(wav[44], 128, "silence is the 8-bit midpoint");
  });
});
