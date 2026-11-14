// Glicko-2 (phase-05 plan §8.7, §12.1): Glickman's 2012 worked example, the PUZZLE preset's reference vectors and
// bounds, the config being honoured (no constants inside the function), and the direction of a single result.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import * as rating from "./index";
import { glicko2, type GlickoConfig, type GlickoState } from "./glicko2";
import { PUZZLE } from "./presets";

const close = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);

const OPEN: GlickoConfig = { tau: 0.5, rdFloor: 0, rdCeil: 1e9, sigmaMax: 1 };

describe("glicko2", () => {
  it("reproduces Glickman (2012)'s worked example with τ = 0.5", () => {
    const next = glicko2(
      { r: 1500, rd: 200, vol: 0.06 },
      [
        { r: 1400, rd: 30, s: 1 },
        { r: 1550, rd: 100, s: 0 },
        { r: 1700, rd: 300, s: 0 },
      ],
      OPEN,
    );
    // The paper prints 1464.06, 151.52 and 0.05999 after rounding its intermediate values.
    close(next.r, 1464.06, 0.02, "r′");
    close(next.rd, 151.52, 0.01, "RD′");
    close(next.vol, 0.05999, 0.00001, "σ′");
  });

  it("only grows the RD for a period with no games", () => {
    const next = glicko2({ r: 1500, rd: 200, vol: 0.06 }, [], OPEN);
    assert.equal(next.r, 1500);
    close(next.rd, Math.sqrt(200 ** 2 + (0.06 * 173.7178) ** 2), 1e-9, "RD′");
  });

  it("raises the rating after a win against a stronger puzzle and lowers it after a loss against a weaker one", () => {
    const me: GlickoState = { r: 1500, rd: 120, vol: 0.06 };
    assert.ok(glicko2(me, [{ r: 1700, rd: 50, s: 1 }], PUZZLE).r > 1500);
    assert.ok(glicko2(me, [{ r: 1300, rd: 50, s: 0 }], PUZZLE).r < 1500);
    const draw = glicko2(me, [{ r: 1500, rd: 50, s: 0.5 }], PUZZLE);
    close(draw.r, 1500, 1e-6, "a draw against an equal opponent");
  });

  it("holds no constants: a custom config is honoured", () => {
    const me: GlickoState = { r: 1500, rd: 300, vol: 0.06 };
    const games = [{ r: 1500, rd: 50, s: 1 }];
    const tight = glicko2(me, games, { tau: 0.3, rdFloor: 280, rdCeil: 290, sigmaMax: 0.05 });
    assert.ok(tight.rd >= 280 && tight.rd <= 290, `RD ${tight.rd}`);
    assert.ok(tight.vol <= 0.05);
    const ceil = glicko2({ r: 1500, rd: 340, vol: 0.09 }, [], { tau: 0.5, rdFloor: 10, rdCeil: 200, sigmaMax: 0.2 });
    assert.equal(ceil.rd, 200);
    const t1 = glicko2({ r: 1500, rd: 100, vol: 0.06 }, [{ r: 2100, rd: 50, s: 1 }], { ...OPEN, tau: 0.2 });
    const t2 = glicko2({ r: 1500, rd: 100, vol: 0.06 }, [{ r: 2100, rd: 50, s: 1 }], { ...OPEN, tau: 1.2 });
    assert.ok(t2.vol > t1.vol, "a larger τ lets the volatility move more after a surprise");
  });
});

describe("PUZZLE preset", () => {
  it("is τ 0.5, RD 50–350, σ ≤ 0.1", () => {
    assert.deepEqual({ ...PUZZLE }, { tau: 0.5, rdFloor: 50, rdCeil: 350, sigmaMax: 0.1 });
    assert.ok(Object.isFrozen(PUZZLE));
    assert.equal(rating.presets.PUZZLE, PUZZLE);
    assert.equal(rating.PUZZLE, PUZZLE);
    assert.equal(rating.glicko2, glicko2);
  });

  // Reference vectors: one puzzle (RD 50) per period. Row 1 checked by hand through the paper's steps (μ −0.0921,
  // φ 1.4391, g(φj) 0.98764, E 0.47728, v 4.1091, φ′ 1.17414 → RD′ 203.97, μ′ 0.61962 → r′ 1607.64); all rows match a
  // separate transcription of the paper's algorithm (WP-B hand-back).
  const vectors: [GlickoState, number, 0 | 0.5 | 1, GlickoState][] = [
    [{ r: 1484, rd: 250, vol: 0.06 }, 1500, 1, { r: 1607.64, rd: 203.97, vol: 0.06 }],
    [{ r: 1484, rd: 250, vol: 0.06 }, 1500, 0, { r: 1371.11, rd: 203.97, vol: 0.06 }],
    [{ r: 1512, rd: 80, vol: 0.06 }, 1600, 1, { r: 1533.95, rd: 78.75, vol: 0.06 }],
    [{ r: 1512, rd: 80, vol: 0.06 }, 1400, 0.5, { r: 1506.56, rd: 78.82, vol: 0.06 }],
  ];
  for (const [state, puzzle, s, want] of vectors) {
    it(`r ${state.r}/RD ${state.rd} vs ${puzzle} scoring ${s}`, () => {
      const next = glicko2(state, [{ r: puzzle, rd: 50, s }], PUZZLE);
      close(next.r, want.r, 0.01, "r′");
      close(next.rd, want.rd, 0.01, "RD′");
      close(next.vol, want.vol, 0.0001, "σ′");
    });
  }

  it("clamps RD at the floor and the volatility at the cap", () => {
    assert.equal(glicko2({ r: 1500, rd: 20, vol: 0.001 }, [{ r: 1500, rd: 50, s: 1 }], PUZZLE).rd, 50);
    const wild = glicko2({ r: 1500, rd: 20, vol: 0.5 }, [{ r: 1500, rd: 50, s: 1 }], PUZZLE);
    assert.equal(wild.vol, 0.1);
    close(wild.r, 1521.21, 0.01, "r′ uses the unclamped σ′ inside the period");
    close(wild.rd, 86.38, 0.01, "RD′");
  });
});
