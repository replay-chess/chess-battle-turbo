import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewServerEvents } from "@repo/analytics";
import { beaconProps, hasSessionCookie, referrerDomain } from "./beacon";

describe("share_page_viewed beacon", () => {
  it("keeps only the bare host of the referrer", () => {
    assert.equal(referrerDomain(""), "none");
    assert.equal(referrerDomain("https://www.Reddit.com/r/chess/comments/abc?x=1"), "reddit.com");
    assert.equal(referrerDomain("https://t.co/xyz"), "t.co");
    assert.equal(referrerDomain("http://localhost:3000/review/x"), "none");
    assert.equal(referrerDomain("http://localhost/"), "none");
    assert.equal(referrerDomain("not a url"), "none");
  });

  it("reads Clerk's session flag cookie without a request", () => {
    assert.equal(hasSessionCookie(""), false);
    assert.equal(hasSessionCookie("__client_uat=0; theme=dark"), false);
    assert.equal(hasSessionCookie("theme=dark; __client_uat=1731340000"), true);
    assert.equal(hasSessionCookie("__client_uat_AbCd=1731340000"), true);
  });

  it("always matches the registry schema", () => {
    for (const [ref, cookie] of [
      ["", ""],
      ["https://news.ycombinator.com/item?id=1", "__client_uat=17"],
      ["https://x.com/", "__client_uat=0"],
    ] as const) {
      assert.equal(reviewServerEvents.share_page_viewed.safeParse(beaconProps(ref, cookie)).success, true);
    }
  });
});
