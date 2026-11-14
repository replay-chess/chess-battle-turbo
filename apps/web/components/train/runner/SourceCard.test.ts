// "Where this position came from" (browser pass D2): before the member's first try the card never names the best move
// or its eval, for a card from an own game and one from an imported game alike; after it, the cost line is shown.
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import type { TrainItemContext } from "@repo/contracts/http/train";
import { COST_HIDDEN, SourceCard } from "./SourceCard";

(globalThis as unknown as { React: typeof React }).React = React;

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const own: TrainItemContext = {
  gameRef: "cm3k9x2p10007slzpqa8hd4fe",
  gamePly: 36,
  gameLabel: "Your game vs tal_fan_77 · today · move 19",
  playedUci: "d1d2",
  playedSan: "Qd2",
  judgement: "miss",
  costText: "Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go.",
};
// The browser pass's card: a Chess.com game, a scored puzzle whose cost line is the "was the move here" template.
const imported: TrainItemContext = {
  gameRef: "cm3k9x2p10007slzpqa8hd4ff",
  gamePly: 51,
  gameLabel: "Your game vs magnus_fan · Nov 14 · move 26",
  playedUci: "g7g8",
  playedSan: "Rg8",
  judgement: "blunder",
  costText: "Rd1+ was the move here, about +7.2 for you. Rg8 let it go.",
};

describe("SourceCard", () => {
  for (const [source, context, best] of [["own game", own, "Rxf5"], ["imported game", imported, "Rd1+"]] as const) {
    it(`${source}: before the first try, no best move and no eval`, () => {
      const out = text(renderToStaticMarkup(React.createElement(SourceCard, { context, tried: false })));
      assert.ok(!out.includes(best), out);
      assert.ok(!out.includes(context.costText), out);
      assert.ok(!/[+-]\d+\.\d/.test(out), `no eval in "${out}"`);
      assert.ok(out.includes(COST_HIDDEN));
      assert.ok(out.includes(`You played ${context.playedSan}`), "the game move stays (it is the member's own move)");
      assert.ok(out.includes(context.gameLabel));
    });
    it(`${source}: after the first try, the cost line`, () => {
      const out = text(renderToStaticMarkup(React.createElement(SourceCard, { context, tried: true })));
      assert.ok(out.includes(context.costText), out);
      assert.ok(!out.includes(COST_HIDDEN));
    });
  }
});
