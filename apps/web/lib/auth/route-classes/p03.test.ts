// Phase 3 route classes (phase-03 plan §3.2, §11.1): the public share page and image, How we grade; the review,
// archive and practice pages need a session at the edge and gate membership in their layouts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, compilePattern, SCANNER } from "./index";
import * as p03 from "./p03";

describe("P3 route classes", () => {
  const rows: [string, ReturnType<typeof classify>][] = [
    // regression: share-page-clerk-handshake (FIX-1): /r went through Clerk, whose development instance redirected
    // every first visit through its handshake (~1.7 s before the first byte); the page reads no session.
    ["/r/8kq2xh4m", "public_static"],
    ["/r/8kq2xh4m/og", "public_static"],
    ["/r/8kq2xh4m/", "public_static"],
    ["/r", "signed_in"],
    ["/rx/abc", "signed_in"],
    ["/how-we-grade", "public"],
    ["/how-we-grade/", "public"],
    ["/how-we-grades", "signed_in"],
    ["/review/cabc", "signed_in"],
    ["/review/cabc/complete", "signed_in"],
    ["/review/cabc/share", "signed_in"],
    ["/review/cabc/legend", "signed_in"],
    ["/review", "signed_in"],
    ["/games", "signed_in"],
    ["/practice", "signed_in"],
    ["/api/review/cabc/share", "api"],
    ["/api/share/8kq2xh4m", "api"],
    ["/api/me/games", "api"],
    ["/api/practice/context", "api"],
    // P1 classes are unchanged where P3 lists nothing.
    ["/analysis/x", "member"],
    ["/pricing", "public"],
    ["/game/x", "member"],
  ];
  for (const [path, cls] of rows) it(`${path} → ${cls}`, () => assert.equal(classify(path), cls));

  it("no review, archive or practice page is a member page (the lapsed-read flag decides in the layout)", () => {
    assert.deepEqual(p03.memberPages, []);
  });

  it("every P3 pattern compiles and none looks like a scanner probe", () => {
    for (const list of [p03.publicPages, p03.staticPages, p03.memberPages, p03.signedInPages, p03.noClerkApi]) {
      for (const pattern of list) {
        assert.doesNotThrow(() => compilePattern(pattern), pattern);
        assert.equal(SCANNER.test(pattern.replace(/\(\.\*\)$/, "")), false, pattern);
      }
    }
  });
});
