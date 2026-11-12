import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROBOTS_DISALLOW, foldDisallow } from "./index";
import { rules as p01 } from "./p01";

describe("robots rules registry", () => {
  it("P1 output is the pre-registry list, in order (byte-identical robots.txt)", () => {
    assert.deepEqual(foldDisallow([p01]), [
      "/api/",
      "/admin/",
      "/monitoring",
      "/game/",
      "/analysis/",
      "/join/",
      "/join-tournament/",
      "/queue",
      "/position/",
      "/tournament/",
      "/dev/",
    ]);
  });

  it("P3 appends the review, share, archive and practice paths after P1's (phase-03 plan §3.2)", () => {
    assert.deepEqual(ROBOTS_DISALLOW.slice(-4), ["/review/", "/r/", "/games", "/practice"]);
    assert.deepEqual(ROBOTS_DISALLOW.slice(0, -4), foldDisallow([p01]));
    assert.equal(ROBOTS_DISALLOW.includes("/how-we-grade"), false);
  });

  it("later phases append, skip duplicates and can reopen an earlier path", () => {
    const out = foldDisallow([
      { disallow: ["/a/", "/join/", "/b/"] },
      { disallow: ["/b/", "/play/"], undisallow: ["/join/"] },
    ]);
    assert.deepEqual(out, ["/a/", "/b/", "/play/"]);
  });
});
