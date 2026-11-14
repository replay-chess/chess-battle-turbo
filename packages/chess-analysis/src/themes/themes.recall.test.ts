// Tier-1 tagger quality gate (phase-05 plan §8.11, §12.1 "per Tier-1 detector: 50 committed CC0 puzzles carrying the
// tag … recall ≥ 85 %, and 50 without (precision tracked)"). The fixtures (`@repo/chess-fixtures/puzzles/<theme>.json`)
// were selected from the Lichess CC0 dump by scripts/theme-fixtures.ts without consulting the tagger; Lichess's own
// tags are the oracle. Each puzzle: the FEN before the opponent's setup move, the setup move, then the solution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { tagThemes, TIER1_THEMES } from "./index";

type Row = [string, string, string, number, string];
interface Fixture {
  theme: string;
  with: Row[];
  without: Row[];
}

const require = createRequire(import.meta.url);
const load = (theme: string) =>
  JSON.parse(readFileSync(require.resolve(`@repo/chess-fixtures/puzzles/${theme}.json`), "utf8")) as Fixture;

/** Recall threshold per Tier-1 theme (plan §8.11). */
const MIN_RECALL = 0.85;

function tags(row: Row): Set<string> {
  const moves = row[2].split(" ");
  const chess = new Chess(row[1]);
  const setup = moves[0]!;
  const m = chess.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] });
  return new Set(
    tagThemes({ fen: chess.fen(), line: moves.slice(1), setupUci: setup, setupCaptured: !!m.captured }).themes,
  );
}

describe("Tier-1 theme recall on the committed CC0 fixtures", () => {
  for (const theme of TIER1_THEMES) {
    it(`${theme}: recall ≥ ${MIN_RECALL * 100} % (precision tracked)`, (t) => {
      const fx = load(theme);
      assert.equal(fx.theme, theme);
      assert.equal(fx.with.length, 50);
      assert.equal(fx.without.length, 50);
      const found = fx.with.filter((r) => tags(r).has(theme)).length;
      const falsePositives = fx.without.filter((r) => tags(r).has(theme)).length;
      const recall = found / fx.with.length;
      const precision = found + falsePositives === 0 ? 1 : found / (found + falsePositives);
      t.diagnostic(`${theme}: recall ${(recall * 100).toFixed(0)} %, precision ${(precision * 100).toFixed(0)} % (50/50)`);
      assert.ok(recall >= MIN_RECALL, `${theme} recall ${(recall * 100).toFixed(0)} %`);
    });
  }
});
