// regression: lease-stale-claims (REGRESSION-6). A persona fixture that signs a pool user in and THEN resets it to a
// persona must mint a fresh session token afterwards (fixtures/auth.ts refreshSessionClaims). The reset writes the
// persona's Clerk claims (onboarded, membership), but the token minted at sign-in keeps the previous lease's claims for
// up to 60 s, so the next request is judged on them. Seen as home.spec "home document": the pool user's previous lease
// was `onboarding-fresh`, and GET /home under the `dev-trial` persona answered /onboarding's claim refresh
// (`onb-claim-refresh`) instead of Home. P4's lease (onboarding/_lib/p04.ts) always refreshed; the review and the
// weakness persona fixtures did not.
//
// Every fixture library under e2e/ (e2e/fixtures/*.ts, e2e/specs/**/_lib/*.ts) is checked: in each `provide(...)`
// body that calls signIn(...) before a persona reset (leasePersona / resetPoolPersona / resetPersona), a new token must
// follow the reset: refreshSessionClaims(...) (P4's lease) or a new sign-in (signInFresh / signIn).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESET = /\b(leasePersona|resetPoolPersona|resetPersona)\(/g;

function fixtureLibraries(): Array<{ file: string; src: string }> {
  return readdirSync(E2E, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".spec.ts"))
    .map((e) => path.join(e.parentPath, e.name))
    .filter((abs) => {
      const rel = path.relative(E2E, abs).split(path.sep).join("/");
      return /^fixtures\/[^/]+\.ts$/.test(rel) || /^specs\/(.+\/)?_lib\/[^/]+\.ts$/.test(rel);
    })
    .map((abs) => ({ file: path.relative(E2E, abs).split(path.sep).join("/"), src: readFileSync(abs, "utf8") }));
}

/** The body of every `provide(async (...) => { ... })` call, by brace matching. */
export function provideBodies(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf("provide(async"); i >= 0; i = src.indexOf("provide(async", i + 1)) {
    const open = src.indexOf("{", src.indexOf("=>", i));
    if (open < 0) continue;
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) {
        out.push(src.slice(open, j + 1));
        break;
      }
    }
  }
  return out;
}

/** The problems of one provide body: a reset after a signIn with no refreshSessionClaims after it. */
export function staleClaimProblems(body: string): string[] {
  const problems: string[] = [];
  for (const m of body.matchAll(RESET)) {
    const at = m.index ?? 0;
    if (!body.slice(0, at).includes("signIn(")) continue;
    const after = body.slice(at);
    if (!/\b(refreshSessionClaims|signInFresh|signIn)\(/.test(after)) problems.push(`${m[1]}() after signIn() without a new session token`);
  }
  return problems;
}

describe("regression: lease-stale-claims", () => {
  it("the check itself: a sign-in, then a reset, needs a claims refresh after the reset", () => {
    const stale = `provide(async (name) => { await signIn(page, email, ""); const l = await leasePersona(name, testInfo); return l; })`;
    const fresh = `provide(async (name) => { await signIn(page, email, ""); const l = await leasePersona(name, testInfo); await refreshSessionClaims(page); return l; })`;
    const before = `provide(async (name) => { await refreshSessionClaims(page); await signIn(page, e, ""); await leasePersona(name, t); })`;
    const leaseFirst = `provide(async (name) => { const l = await leasePersona(name, t); await signIn(page, l.email, ""); })`;
    assert.equal(provideBodies(stale).length, 1);
    assert.deepEqual(staleClaimProblems(provideBodies(stale)[0]!), ["leasePersona() after signIn() without a new session token"]);
    const signedAgain = `provide(async (name) => { await signIn(page, email, ""); const l = await leasePersona(name, testInfo); await signInFresh(page, email); return l; })`;
    assert.deepEqual(staleClaimProblems(provideBodies(signedAgain)[0]!), []);
    assert.deepEqual(staleClaimProblems(provideBodies(fresh)[0]!), []);
    assert.equal(staleClaimProblems(provideBodies(before)[0]!).length, 1, "a refresh before the reset does not count");
    assert.deepEqual(staleClaimProblems(provideBodies(leaseFirst)[0]!), [], "a sign-in after the reset mints its own token");
  });

  it("every e2e persona fixture that signs in and then resets refreshes the session's claims", () => {
    const libs = fixtureLibraries();
    const names = libs.map((l) => l.file);
    for (const want of ["specs/review/_lib/review.ts", "specs/weakness/_lib/weakness.ts", "specs/onboarding/_lib/p04.ts"]) {
      assert.ok(names.includes(want), `${want} is scanned`);
    }
    let checked = 0;
    const problems: string[] = [];
    for (const { file, src } of libs) {
      for (const body of provideBodies(src)) {
        if (!body.includes("signIn(") || !RESET.test(body)) continue;
        RESET.lastIndex = 0;
        checked++;
        for (const p of staleClaimProblems(body)) problems.push(`${file}: ${p}`);
      }
      RESET.lastIndex = 0;
    }
    assert.ok(checked >= 3, `persona fixtures checked: ${checked}`);
    assert.deepEqual(problems, []);
  });

  // regression: webkit-claims-refresh-signed-out (REGRESSION-6 r2, r3): the in-page getToken({skipCache}) right after a
  // ticket sign-in was answered "signed_out" by Clerk's development FAPI on WebKit under the full suite's load. The
  // sign-in's onboarding provisioning and the persona fixtures take a new sign-in instead.
  it("regression: webkit-claims-refresh-signed-out — the sign-in path and the persona fixtures sign in again, never refresh in page", () => {
    const auth = readFileSync(path.join(E2E, "fixtures/auth.ts"), "utf8");
    const body = auth.slice(auth.indexOf("async function provisionLetterOnboarded"), auth.indexOf("export async function markOnboardedForE2E"));
    assert.match(body, /await signInFresh\(page, email\)/);
    assert.doesNotMatch(body, /refreshSessionClaims\(/);
    for (const lib of ["specs/review/_lib/review.ts", "specs/weakness/_lib/weakness.ts"]) {
      const src = readFileSync(path.join(E2E, lib), "utf8");
      assert.match(src, /signInFresh\(page, email\)/, lib);
      assert.doesNotMatch(src, /refreshSessionClaims\(/, lib);
    }
  });
});
