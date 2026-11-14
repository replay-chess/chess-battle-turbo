// Glicko-2 (Glickman, "Example of the Glicko-2 system", 2012), parameterised by a config (phase-05 plan §8.7,
// feasibility #11). This function holds no product constants: every caller passes a preset from `presets.ts` (P5's
// `PUZZLE`; P9 adds `GAME`). Pure and dependency-free: the browser imports it for the rating preview (D-13).
//
// One rating period per call. The results are the period's games; P5 calls it with one (the puzzle as an opponent
// with a fixed rating and RD).

/** A player's rating on the Glicko scale: rating, rating deviation, volatility. */
export interface GlickoState {
  r: number;
  rd: number;
  vol: number;
}

/** One game of the period: the opponent's rating and RD, and the score (1 win, 0.5 draw, 0 loss). */
export interface GlickoResult {
  r: number;
  rd: number;
  s: number;
}

export interface GlickoConfig {
  /** τ: how much the volatility may change in a period. */
  tau: number;
  /** RD after the update is clamped to [rdFloor, rdCeil]. */
  rdFloor: number;
  rdCeil: number;
  /** Upper bound of the stored volatility. */
  sigmaMax: number;
}

/** The Glicko-2 scale factor (173.7178 = 400 / ln 10). */
export const GLICKO_SCALE = 173.7178;
const BASE = 1500;
const EPSILON = 1e-6;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * The new state after one rating period. With no results only the RD grows (step 6 of the paper), clamped as usual.
 */
export function glicko2(state: GlickoState, results: readonly GlickoResult[], cfg: GlickoConfig): GlickoState {
  const mu = (state.r - BASE) / GLICKO_SCALE;
  const phi = state.rd / GLICKO_SCALE;
  const sigma = state.vol;

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { r: state.r, rd: clamp(GLICKO_SCALE * phiStar, cfg.rdFloor, cfg.rdCeil), vol: Math.min(sigma, cfg.sigmaMax) };
  }

  // Step 3–4: estimated variance v and improvement Δ.
  let vInv = 0;
  let deltaSum = 0;
  for (const res of results) {
    const muJ = (res.r - BASE) / GLICKO_SCALE;
    const phiJ = res.rd / GLICKO_SCALE;
    const gj = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (res.s - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility by the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const tau = cfg.tau;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  // Step 6–7: new φ and μ.
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;

  // Step 8: back to the Glicko scale, then the config's bounds.
  return {
    r: GLICKO_SCALE * muNew + BASE,
    rd: clamp(GLICKO_SCALE * phiNew, cfg.rdFloor, cfg.rdCeil),
    vol: Math.min(sigmaNew, cfg.sigmaMax),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
