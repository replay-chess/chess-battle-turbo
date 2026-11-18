// One vocabulary for the per-game records, the stored document and the wire payload (INTEGRATE-1). The codec
// (@repo/chess-analysis) owns the index orders of STATS_V1 / ERROR_LOG_V1; the wire contract (@repo/contracts, which has
// no dependencies and cannot import the codec) spells the same tuples for its zod enums, and the stored document's
// schema reuses the contract's. This package depends on both, so the agreement is checked here, at compile time and
// at run time, together with the thresholds the contract repeats as literals.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOCK_BUCKET, CLOCK_BUCKET_KEYS as CA_CLOCK_KEYS } from "@repo/chess-analysis/clock";
import { ERROR_LOG_J, ERROR_LOG_JUDGEMENTS, ERROR_THEMES_MAX, STATS_V1_PIECES, STATS_V1_REACHED_CP, WEAKNESS_PHASES as CA_PHASES } from "@repo/chess-analysis/codec";
import * as themes from "@repo/chess-analysis/themes/index";
import {
  CLOCK_BUCKET_KEYS as CT_CLOCK_KEYS,
  WEAKNESS_GAMES_REQUIRED,
  WEAKNESS_MAX_GAMES,
  WEAKNESS_PHASES as CT_PHASES,
  WEAKNESS_PIECES as CT_PIECES,
  WEAKNESS_PRELIMINARY_FROM,
} from "@repo/contracts/http/weakness";
import { CONVERSION_CP, GAMES_REQUIRED, MAX_GAMES, PRELIMINARY_FROM, SCOPE_DEFAULT } from "./constants";
import { CLOCK_LT1, CLOCK_UNKNOWN, clockIndex, J_BLUNDER, J_MISS, J_MISTAKE } from "./records";
import { CLOCK_KEYS, PHASES, PIECES } from "./types";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const phasesAgree: Same<typeof CA_PHASES, typeof CT_PHASES> = true;
const clockKeysAgree: Same<typeof CA_CLOCK_KEYS, typeof CT_CLOCK_KEYS> = true;
const piecesAgree: Same<typeof STATS_V1_PIECES, typeof CT_PIECES> = true;

describe("weakness vocabulary", () => {
  it("the codec's tuples and the wire contract's are the same, in the same order", () => {
    assert.ok(phasesAgree && clockKeysAgree && piecesAgree);
    assert.deepEqual([...CT_PHASES], [...CA_PHASES]);
    assert.deepEqual([...CT_CLOCK_KEYS], [...CA_CLOCK_KEYS]);
    assert.deepEqual([...CT_PIECES], [...STATS_V1_PIECES]);
  });

  it("the engine's orders are the codec's own arrays, not copies", () => {
    assert.equal(PHASES, CA_PHASES);
    assert.equal(CLOCK_KEYS, CA_CLOCK_KEYS);
    assert.equal(PIECES, STATS_V1_PIECES);
  });

  it("the record constants are the codec's", () => {
    assert.equal(ERROR_LOG_JUDGEMENTS[J_MISTAKE], "MISTAKE");
    assert.equal(ERROR_LOG_JUDGEMENTS[J_BLUNDER], "BLUNDER");
    assert.equal(ERROR_LOG_JUDGEMENTS[J_MISS], "MISS");
    assert.deepEqual([J_MISTAKE, J_BLUNDER, J_MISS], [ERROR_LOG_J.MISTAKE, ERROR_LOG_J.BLUNDER, ERROR_LOG_J.MISS]);
    assert.equal(CLOCK_UNKNOWN, CLOCK_BUCKET.UNKNOWN);
    assert.equal(CLOCK_LT1, CLOCK_BUCKET.LT1);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(clockIndex), [null, 0, 1, 2, 3, null]);
    assert.equal(CA_CLOCK_KEYS[clockIndex(CLOCK_BUCKET.LT1)!], "lt1");
    assert.equal(CONVERSION_CP, STATS_V1_REACHED_CP);
    assert.equal(themes.ERROR_THEMES_MAX, ERROR_THEMES_MAX);
  });

  it("the contract's thresholds equal the engine's constants", () => {
    assert.equal(WEAKNESS_GAMES_REQUIRED, GAMES_REQUIRED);
    assert.equal(WEAKNESS_PRELIMINARY_FROM, PRELIMINARY_FROM);
    assert.equal(WEAKNESS_MAX_GAMES, MAX_GAMES);
    assert.equal(SCOPE_DEFAULT.maxGames, MAX_GAMES);
  });
});
