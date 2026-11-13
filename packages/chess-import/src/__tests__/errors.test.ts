// ProviderError kinds → `ImportErrorV1.code` (phase-04 plan §6.4, §8.11) and the schema-issue description.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { describeIssues, importErrorCodeOf, PROVIDER_ERROR_KINDS, ProviderError } from "../errors";

describe("errors", () => {
  it("maps every kind to an ImportErrorV1 code", () => {
    const got = Object.fromEntries(
      PROVIDER_ERROR_KINDS.map((k) => [k, importErrorCodeOf(new ProviderError("chesscom", k, k))]),
    );
    assert.deepEqual(got, {
      not_found: "not_found",
      closed: "closed",
      rate_limited: "rate_limited",
      timeout: "timeout",
      upstream: "upstream",
      bad_response: "upstream",
      aborted: "internal",
    });
  });

  it("retryable only for rate_limited, timeout and upstream", () => {
    const retryable = PROVIDER_ERROR_KINDS.filter((k) => new ProviderError("lichess", k, k).retryable);
    assert.deepEqual(retryable, ["rate_limited", "timeout", "upstream"]);
  });

  it("describes schema issues by path and code only", () => {
    assert.equal(
      describeIssues([
        { path: ["white", "result"], code: "invalid_value" },
        { path: [], code: "unrecognized_keys" },
      ]),
      "white.result:invalid_value, (root):unrecognized_keys",
    );
  });
});
