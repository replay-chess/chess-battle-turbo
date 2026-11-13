// Phase-04 plan 12.1 (`env.test.ts` row): DODO_API_BASE_URL is refused unless APP_ENV=test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DodoBaseUrlRefusedError, dodoApiBaseUrl } from "./dodo-env";

describe("dodoApiBaseUrl", () => {
  it("unset → null in every environment", () => {
    assert.equal(dodoApiBaseUrl({}), null);
    assert.equal(dodoApiBaseUrl({ NEXT_PUBLIC_APP_ENV: "production", DODO_API_BASE_URL: "  " }), null);
  });

  it("a test build may point at the upstream mock (trailing slash dropped)", () => {
    assert.equal(dodoApiBaseUrl({ NEXT_PUBLIC_APP_ENV: "test", DODO_API_BASE_URL: "http://localhost:4010/dodo/" }), "http://localhost:4010/dodo");
    assert.equal(dodoApiBaseUrl({ APP_ENV: "test", DODO_API_BASE_URL: "http://127.0.0.1:4010/dodo" }), "http://127.0.0.1:4010/dodo");
  });

  it("refused on production, dev, local and an unset app env", () => {
    for (const env of [
      { NEXT_PUBLIC_APP_ENV: "production" },
      { NEXT_PUBLIC_APP_ENV: "dev" },
      { APP_ENV: "production", NEXT_PUBLIC_APP_ENV: "test" },
      {},
    ]) {
      assert.throws(() => dodoApiBaseUrl({ ...env, DODO_API_BASE_URL: "http://localhost:4010/dodo" }), DodoBaseUrlRefusedError);
    }
  });

  it("refuses a value that is not an http(s) URL", () => {
    assert.throws(() => dodoApiBaseUrl({ APP_ENV: "test", DODO_API_BASE_URL: "localhost:4010" }), DodoBaseUrlRefusedError);
    assert.throws(() => dodoApiBaseUrl({ APP_ENV: "test", DODO_API_BASE_URL: "file:///etc/passwd" }), DodoBaseUrlRefusedError);
  });
});
