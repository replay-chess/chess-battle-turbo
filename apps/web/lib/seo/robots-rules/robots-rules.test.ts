import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROBOTS_DISALLOW, foldDisallow } from "./index";

describe("robots rules registry", () => {
  it("P1 output is the pre-registry list, in order (byte-identical robots.txt)", () => {
    assert.deepEqual(ROBOTS_DISALLOW, [
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

  it("later phases append, skip duplicates and can reopen an earlier path", () => {
    const out = foldDisallow([
      { disallow: ["/a/", "/join/", "/b/"] },
      { disallow: ["/b/", "/play/"], undisallow: ["/join/"] },
    ]);
    assert.deepEqual(out, ["/a/", "/b/", "/play/"]);
  });
});
