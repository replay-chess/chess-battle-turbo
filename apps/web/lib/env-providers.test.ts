// Plan §12.1 `WEB/lib/env.test.ts` rows for the provider overrides (kept beside their own module, lib/env-providers.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHESSCOM_API_BASE_DEFAULT,
  LICHESS_BASE_URL_DEFAULT,
  ProviderEnvError,
  lichessClientId,
  providerBaseUrls,
  upstreamContact,
} from "./env-providers";

const MOCK = { CHESSCOM_API_BASE: "http://localhost:4010/chesscom/", LICHESS_BASE_URL: "http://localhost:4010/lichess" };

describe("providerBaseUrls", () => {
  it("defaults to the real origins", () => {
    assert.deepEqual(providerBaseUrls({}), { chesscom: CHESSCOM_API_BASE_DEFAULT, lichess: LICHESS_BASE_URL_DEFAULT });
  });

  it("honours the e2e mock overrides in test, dev and local builds (trailing slash dropped)", () => {
    for (const appEnv of ["test", "dev", undefined]) {
      assert.deepEqual(providerBaseUrls({ ...MOCK, NEXT_PUBLIC_APP_ENV: appEnv }), {
        chesscom: "http://localhost:4010/chesscom",
        lichess: "http://localhost:4010/lichess",
      });
    }
  });

  it("refuses an override in production (either env name), but accepts the real origin spelled out", () => {
    assert.throws(() => providerBaseUrls({ ...MOCK, NEXT_PUBLIC_APP_ENV: "production" }), ProviderEnvError);
    assert.throws(() => providerBaseUrls({ CHESSCOM_API_BASE: "https://evil.test", APP_ENV: "production" }), ProviderEnvError);
    assert.throws(() => providerBaseUrls({ LICHESS_BASE_URL: "https://lichess.org.evil.test", APP_ENV: "production" }), ProviderEnvError);
    assert.deepEqual(
      providerBaseUrls({ CHESSCOM_API_BASE: "https://api.chess.com/", LICHESS_BASE_URL: "https://lichess.org", NEXT_PUBLIC_APP_ENV: "production" }),
      { chesscom: CHESSCOM_API_BASE_DEFAULT, lichess: LICHESS_BASE_URL_DEFAULT },
    );
  });

  it("rejects non-http schemes, credentials, queries and garbage", () => {
    for (const bad of ["ftp://x.test", "javascript:alert(1)", "http://u:p@x.test", "http://x.test/?a=1", "http://x.test/#f", "not a url"]) {
      assert.throws(() => providerBaseUrls({ CHESSCOM_API_BASE: bad }), ProviderEnvError, bad);
    }
  });
});

describe("lichessClientId / upstreamContact", () => {
  it("default and override", () => {
    assert.equal(lichessClientId({}), "replay-chess-dev");
    assert.equal(lichessClientId({ LICHESS_CLIENT_ID: "playchess.tech" }), "playchess.tech");
    assert.throws(() => lichessClientId({ LICHESS_CLIENT_ID: "a b&c" }), ProviderEnvError);
    assert.equal(upstreamContact({}), "hello@playchess.tech");
    assert.equal(upstreamContact({ UPSTREAM_CONTACT: "ops@playchess.tech" }), "ops@playchess.tech");
  });
});
