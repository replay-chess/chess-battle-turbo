// The Lighthouse job's public share (seed/public-share.ts; FIX-1): one fixed code on every database, a synthetic
// sharer, the design GAME. The writes are exercised by the nightly job and the local runs (FIX-1 hand-back).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SHARE_CODE_RE } from "../src/json/share";
import { PUBLIC_SHARE_USER, publicShareCode } from "./public-share";

describe("public-share seed", () => {
  it("has one fixed, valid share code", () => {
    assert.equal(publicShareCode(), publicShareCode());
    assert.match(publicShareCode(), SHARE_CODE_RE);
    assert.equal(publicShareCode(), "7kd0cbpz");
  });

  it("the sharer is synthetic (no Clerk identity, a reserved local domain)", () => {
    assert.match(PUBLIC_SHARE_USER.email, /@replaychess\.local$/);
  });

  it("is the code the Lighthouse config of /r collects", () => {
    const rc = readFileSync(fileURLToPath(new URL("../../../apps/web/lighthouserc.share.cjs", import.meta.url)), "utf8");
    assert.match(rc, new RegExp(`const PUBLIC_SHARE_CODE = "${publicShareCode()}";`));
  });
});
