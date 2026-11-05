import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicByRouteClass } from "./public-paths";
import { defaultIsPublicPath } from "./session-guard";

describe("isPublicByRouteClass", () => {
  it("public pages never show the session modal", () => {
    for (const p of ["/", "/pricing", "/legends", "/legends/paul-morphy", "/openings/x", "/profile/abc", "/sign-in", "/sign-in/factor-one", "/help", "/too-many-requests", "/blog/some-post", "/learn/x"]) {
      assert.equal(isPublicByRouteClass(p), true, p);
    }
  });

  it("member, signed-in, unlisted and dev routes are watched", () => {
    for (const p of ["/play", "/game/abc", "/tournaments", "/onboarding", "/admin", "/dev", "/dev/ui/data", "/legendsx", "/queue", "/checkout", "/some-typo"]) {
      assert.equal(isPublicByRouteClass(p), false, p);
    }
  });

  it("agrees with F8's interim list on the paths that list covers", () => {
    for (const p of ["/", "/pricing", "/about", "/blog", "/careers", "/community", "/contact", "/cookies", "/docs", "/help", "/learn", "/press", "/privacy", "/terms", "/too-many-requests", "/legends", "/openings", "/sign-up", "/play", "/game/x", "/dev/ui/data", "/onboarding"]) {
      assert.equal(isPublicByRouteClass(p), defaultIsPublicPath(p), p);
    }
  });
});
