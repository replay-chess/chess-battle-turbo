// Onboarding phone layout guard (INTEGRATE-2 regression): in the compact layout the step body is the scroll fallback,
// so its cards must not shrink. With the default flex-shrink the Link step's Chess.com card was squeezed under the
// Lichess card on a 393×660 phone viewport (field and "Look Up Profile" unreachable).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../components/onboarding/onboarding.css"), "utf8");

function compactBlock(): string {
  const start = css.indexOf("@media (max-width: 600px), (max-width: 900px) and (orientation: portrait)");
  assert.ok(start >= 0, "the compact media block exists");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unbalanced compact block");
}

describe("onboarding compact layout", () => {
  it("the body scrolls and its cards keep their height", () => {
    const block = compactBlock();
    assert.match(block, /\.onb-body\s*>\s*\.onb-card\s*\{\s*flex-shrink:\s*0;?\s*\}/);
    assert.match(css, /\.onb-body\s*\{[^}]*overflow-y:\s*auto/);
  });
});
