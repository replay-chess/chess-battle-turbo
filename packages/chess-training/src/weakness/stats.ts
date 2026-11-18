// The significance tests of the Weakness Profile (FIX-2, docs/decisions.md D-P6-FIX2-1 and D-P6-FIX2-2). Pure, no
// dependencies, browser-safe.
//
// A member's event count k over n moves is compared with the band's rate p: under "the member is like the band" the
// count is about Poisson with mean μ = n·p, widened by the theme's dispersion φ ≥ 1 (errors inside one game are not
// independent). The quasi-Poisson tail P(X ≥ k) is read as the Poisson tail of k/φ at mean μ/φ, which for real
// arguments is the regularized lower incomplete gamma function P(k/φ, μ/φ).

/** ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9: ~15 significant digits). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = c[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized lower incomplete gamma function P(a, x) = γ(a, x) / Γ(a), a > 0, x ≥ 0. */
export function regularizedGammaP(a: number, x: number): number {
  if (!(a > 0)) throw new RangeError(`regularizedGammaP: a = ${a}`);
  if (x <= 0) return 0;
  const lead = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    // Series: P = e^{-x} x^a / Γ(a) · Σ x^n / (a (a+1) … (a+n)).
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(lead));
  }
  // Continued fraction for Q = 1 − P (modified Lentz).
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(lead) * h);
}

/**
 * P(X ≥ k) for a count X with mean `mu` and variance φ·mu (quasi-Poisson): 1 for k ≤ 0, 0 for mu ≤ 0 < k. With φ = 1
 * and integer k it is the exact Poisson upper tail.
 */
export function poissonUpperTail(k: number, mu: number, phi = 1): number {
  if (k <= 0) return 1;
  if (mu <= 0) return 0;
  const f = Math.max(1, phi);
  return regularizedGammaP(k / f, mu / f);
}

/**
 * The dispersion-widened z of k against mean mu, (k − μ) / sqrt(φ·μ), stored in `rows[].z` for the record (the
 * eligibility reads the tail probability, not this normal approximation). Null when mu ≤ 0.
 */
export function quasiZ(k: number, mu: number, phi = 1): number | null {
  if (!(mu > 0)) return null;
  return (k - mu) / Math.sqrt(Math.max(1, phi) * mu);
}
