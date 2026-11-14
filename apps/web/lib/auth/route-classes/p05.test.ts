// Phase 5 route classes (phase-05 plan §3.1, §4, §11; interface check §0.7): Home and every Train page need a session at
// the edge and gate membership in the page; `/` stays public (the landing redirect is WP-H's middleware block); the
// P5 APIs keep the default "api" class (Clerk runs, route() answers 401/402).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, compilePattern, SCANNER } from "./index";
import * as p05 from "./p05";

describe("P5 route classes", () => {
  const rows: [string, ReturnType<typeof classify>][] = [
    ["/home", "signed_in"],
    ["/home/", "signed_in"],
    ["/homework", "signed_in"],
    ["/train", "signed_in"],
    ["/train/bank", "signed_in"],
    ["/train/bank/session", "signed_in"],
    ["/train/puzzles", "signed_in"],
    ["/train/session/cm5t9s3ss0001slzpbankdrl1", "signed_in"],
    ["/train/session/cm5t9s3ss0001slzpbankdrl1/summary", "signed_in"],
    ["/api/train/today", "api"],
    ["/api/train/sessions/cm5t9s3ss0001slzpbankdrl1/extend", "api"],
    ["/api/home", "api"],
    ["/api/me/badges", "api"],
    ["/api/reports", "api"],
    // Unchanged around them.
    ["/", "public"],
    ["/play", "member"],
    ["/review/cabc", "signed_in"],
  ];
  for (const [path, cls] of rows) it(`${path} → ${cls}`, () => assert.equal(classify(path), cls));

  it("lists no member page (the page gate decides, so a later lapsed-read rule needs no edge change) and no public page", () => {
    assert.deepEqual(p05.memberPages, []);
    assert.deepEqual(p05.publicPages, []);
    assert.deepEqual(p05.noClerkApi, []);
  });

  it("`/home(.*)` stops at the segment boundary (`/homework` is not Home)", () => {
    assert.equal(compilePattern("/home(.*)").test("/homework"), false);
    assert.equal(compilePattern("/train(.*)").test("/training"), false);
    assert.equal(compilePattern("/train(.*)").test("/train/bank/session"), true);
  });

  it("no P5 path looks like a scanner probe", () => {
    for (const p of ["/home", "/train/bank/session", "/api/train/attempts"]) assert.equal(SCANNER.test(p), false, p);
  });
});
