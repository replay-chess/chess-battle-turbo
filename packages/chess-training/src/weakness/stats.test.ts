// The significance tests' numerics (FIX-2, D-P6-FIX2-1): ln Γ, the regularized incomplete gamma P(a, x), the Poisson
// upper tail (exact for integer k and φ = 1, checked against a direct sum) and its quasi-Poisson widening by φ.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lnGamma, poissonUpperTail, quasiZ, regularizedGammaP } from "./stats";

/** P(X ≥ k) for X ~ Poisson(mu) by summing the pmf (k ≤ ~200). */
function exactTail(k: number, mu: number): number {
  let below = 0;
  let term = Math.exp(-mu);
  for (let i = 0; i < k; i++) {
    below += term;
    term *= mu / (i + 1);
  }
  return 1 - below;
}

describe("weakness stats", () => {
  it("ln Γ matches factorials and Γ(1/2) = √π", () => {
    for (const n of [1, 2, 5, 10, 20]) {
      let f = 1;
      for (let i = 2; i < n; i++) f *= i;
      assert.ok(Math.abs(lnGamma(n) - Math.log(f)) < 1e-10, String(n));
    }
    assert.ok(Math.abs(lnGamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-12);
  });

  it("the Poisson tail is exact for integer k (series and continued-fraction branches)", () => {
    for (const [k, mu] of [[5, 1], [30, 20], [10, 2.5], [100, 80], [1, 0.01], [3, 7], [40, 21], [200, 150]] as const) {
      const got = poissonUpperTail(k, mu);
      const want = exactTail(k, mu);
      assert.ok(Math.abs(got - want) <= 1e-10 + 1e-8 * want, `k ${k} mu ${mu}: ${got} vs ${want}`);
    }
    assert.equal(poissonUpperTail(0, 3), 1);
    assert.equal(poissonUpperTail(4, 0), 0);
  });

  it("φ widens the tail (k/φ at mean μ/φ): the same excess is less surprising", () => {
    assert.ok(poissonUpperTail(40, 21, 1.6) > poissonUpperTail(40, 21, 1));
    assert.ok(Math.abs(poissonUpperTail(40, 20, 2) - regularizedGammaP(20, 10)) < 1e-15);
    assert.equal(poissonUpperTail(40, 21, 0.5), poissonUpperTail(40, 21, 1), "never narrower than Poisson");
  });

  it("the stored z is (k − μ) / √(φ μ)", () => {
    assert.ok(Math.abs(quasiZ(40, 21, 1.5)! - 19 / Math.sqrt(31.5)) < 1e-12);
    assert.equal(quasiZ(4, 0), null);
  });
});
