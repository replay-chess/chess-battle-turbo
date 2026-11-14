// The Mistake Bank's selected position (phase-05 plan §4.3 Desktop: `.mbinfo`; FIX-2, review round 2): under the
// board, the eyebrow, "{theme} · you played {SAN}", the judgement badge with "{Judgement} · vs opp · when · move N ·
// Phase", and the mastery dots with "Mastery n of 5 · best move hidden until you try"; the iPad-portrait compact pane
// carries the mastery line too. The best move is never on this screen.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { before, describe, it } from "node:test";
import { bankRowsFixture } from "@repo/contracts/http/fixtures/p05";

nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier.endsWith(".css") ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
});
(globalThis as unknown as { React: typeof React }).React = React;
let mod: typeof import("./BankDetail");
before(async () => {
  mod = await import("./BankDetail");
});

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("BankDetail", () => {
  const row = { ...bankRowsFixture()[0]!, mastery: 2 };

  it("desktop / iPad landscape: the judgement line and the mastery line with its dots", () => {
    const html = renderToStaticMarkup(React.createElement(mod.BankDetail, { row }));
    const meta = /data-testid="bank-detail-meta"[^>]*>(.*?)<\/p>/s.exec(html)?.[1] ?? "";
    assert.match(meta, /<span role="img" aria-label="/, "the judgement badge");
    assert.equal(text(meta), `Miss · vs ${row.opponent} · ${row.playedAtLabel} · move ${row.moveNo} · Middlegame`);
    const mastery = /data-testid="bank-detail-mastery"[^>]*>(.*?)<\/p>/s.exec(html)?.[1] ?? "";
    assert.match(mastery, /role="img" aria-label="Mastery 2 of 5"/);
    assert.equal((mastery.match(/rounded-full/g) ?? []).length, 5, "five dots");
    assert.equal(text(mastery), "Mastery 2 of 5 · best move hidden until you try");
    assert.match(html, /<p class="[^"]*vh640:hidden[^"]*" data-testid="bank-detail-mastery"/, "hidden on short screens, as the board's .tall");
  });

  it("iPad portrait (compact): the judgement and the mastery line", () => {
    const html = renderToStaticMarkup(React.createElement(mod.BankDetailCompact, { row }));
    assert.match(text(html), /You played Qd2 · Miss/);
    assert.match(text(html), /Mastery 2 of 5 · best move hidden until you try/);
  });
});
