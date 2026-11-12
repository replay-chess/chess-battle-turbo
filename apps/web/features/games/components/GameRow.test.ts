// An archive row's accessible name (WCAG 2.5.3 Label in Name; plan §4.5 a11y). The option is named by its content, so
// the visible text is always part of the name (axe label-content-name-mismatch), and screen-reader-only joiners make it
// read as one sentence.
// regression: games-row-label-in-name (FIX-1): an aria-label reworded the visible text ("Win vs Engine 1400 (1400)"
// while the row showed "WIN Engine 14001400"), which axe flagged on every row.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gameRowFixtures } from "@repo/contracts/http/fixtures/review";
import { GameRow } from "./GameRow";

// tsconfig has jsx: "preserve", so tsx compiles the component's JSX to React.createElement (classic runtime).
(globalThis as { React?: typeof React }).React = React;

const rows = gameRowFixtures();

function render(row: (typeof rows)[number]) {
  return renderToStaticMarkup(
    createElement(GameRow, { row, id: `o-${row.ref}`, selected: false, index: 0, onPick: () => undefined, onOpen: () => undefined }),
  );
}

/** The text a screen reader gets from the content (aria-hidden subtrees dropped, tags stripped). */
function nameOf(html: string): string {
  let out = html;
  for (;;) {
    const next = out.replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>(?:(?!<\1[\s>])[\s\S])*?<\/\1>/, "");
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("archive row name", () => {
  it("has no aria-label: the option is named by what it shows", () => {
    for (const row of rows) assert.doesNotMatch(render(row), /aria-label=/, row.ref);
  });

  it("reads result, opponent, rating, note, context, date and the rating change as one sentence", () => {
    const row = rows.find((r) => r.headline === "Missed Rxf5 · move 19")!;
    const name = nameOf(render(row));
    assert.match(name, /^LOSS vs tal_fan_77 \(1203\), Missed Rxf5 · move 19, Two Knights Defense: Main Line · C59 · Rapid 10\+0, Nov 9/);
    if (row.ratingDelta != null) assert.match(name, /, rating [+−]?\d+$/);
  });

  it("the visible words are part of the name, in order (rating separated from the name)", () => {
    for (const row of rows) {
      const html = render(row);
      const name = nameOf(html);
      assert.ok(name.startsWith(row.result.toUpperCase()), row.ref);
      if (row.opponent.rating != null) assert.ok(name.includes(`${row.opponent.name} (${row.opponent.rating})`), row.ref);
    }
  });
});
