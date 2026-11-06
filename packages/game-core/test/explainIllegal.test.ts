import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Chess } from "chess.js";
import { ILLEGAL_REASONS, explainIllegal, explainWith, type IllegalReason } from "../src/rules/explainIllegal";

const require = createRequire(import.meta.url);
const file = require.resolve("@repo/chess-fixtures/rules/illegal-reasons.json");
const fixture = JSON.parse(readFileSync(file, "utf8")) as {
  cases: {
    id: string;
    fen: string;
    mover?: "w" | "b";
    from: string;
    to: string;
    reason: IllegalReason;
    text: string;
  }[];
};

for (const c of fixture.cases) {
  test(`illegal-reasons: ${c.id}`, () => {
    const r = explainIllegal(c.fen, c.from, c.to, c.mover ? { mover: c.mover } : {});
    assert.equal(r.reason, c.reason);
    assert.equal(r.text, c.text);
    assert.equal(r.toast, `That move isn’t legal: ${c.text}`);
  });
}

test("the fixture covers every reason", () => {
  const covered = new Set(fixture.cases.map((c) => c.reason));
  for (const r of ILLEGAL_REASONS) assert.ok(covered.has(r), r);
});

test("legal moves get no explanation", () => {
  assert.equal(explainWith(new Chess(), "e2", "e4"), null);
  assert.equal(explainWith(new Chess("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2"), "e5", "d6"), null);
});

test("names replace White/Black in the opponent reasons", () => {
  const r = explainIllegal(new Chess().fen(), "e7", "e5", { names: { w: "knightowl_88", b: "martin_k" } });
  assert.equal(r.text, "that’s martin_k’s piece.");
});
