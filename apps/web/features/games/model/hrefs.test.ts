import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendComparePath } from "@repo/contracts/http/legend";
import { reviewPath } from "@repo/contracts/http/review";
import { gameRowFixtures } from "@repo/contracts/http/fixtures/review";
import { compareHrefOf, reviewHrefOf } from "./hrefs";

describe("archive links", () => {
  it("equal the contract's path builders", () => {
    for (const row of gameRowFixtures()) {
      assert.equal(reviewHrefOf(row.ref), reviewPath(row.ref, { from: "archive" }));
      assert.equal(compareHrefOf(row.ref), legendComparePath(row.ref));
    }
  });

  it("regression: review-opened-source: an archive link names its source (?from=archive), not the referrer", () => {
    const href = reviewHrefOf("cm3k9x2p10007slzpqa8hd4fe");
    assert.equal(new URL(href, "http://x").searchParams.get("from"), "archive");
  });
});
