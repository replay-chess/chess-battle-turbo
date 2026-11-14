// The one-viewport scroll boxes contain their absolutely positioned content (regression:
// scroll-region-containing-block, REGRESSION-5). An `sr-only` / `.ts-vh` label is `position: absolute`; with no
// positioned ancestor inside the scroll box its containing block was [data-rc-main], so a label far down a scrolled
// list (the hub's "Step 2 of 2" line, the summary's grade labels) sat below main's bottom and grew main's scroll
// height: the devices suite's "main must not need its safety scroll" failed on phones at 150 % (android@150: the hub,
// the bank, the summary and Home). Both scroll boxes must stay positioned.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rule = (file: string, selector: string): string => {
  const css = readFileSync(path.join(WEB, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `${selector} in ${file}`);
  return m[1]!;
};

test(".rc-scroll (ScrollRegion) is the containing block of its content", () => {
  assert.match(rule("components/layout/board-stage.css", ".rc-scroll"), /(^|;|\s)position:\s*relative\s*;/);
});

test("the session summary's scroll box too", () => {
  assert.match(rule("components/train/summary/summary.css", ".ts__scroll"), /(^|;|\s)position:\s*relative\s*;/);
});
