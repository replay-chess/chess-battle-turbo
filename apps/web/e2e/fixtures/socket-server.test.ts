// Unit tests of the e2e socket fixture's environment (phase-02 plan 12.0: the fixture servers are test hooks).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SocketFixtureError, socketDatabaseUrl, socketServerEnv } from "./socket-server";

const LOCAL = "postgresql://u:p@localhost:5432/replay";

describe("e2e socket fixture env", () => {
  it("refuses every database but a local Postgres or the Neon dev endpoint", () => {
    assert.equal(socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: LOCAL }), LOCAL);
    const dev = "postgresql://u:p@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/db";
    assert.equal(socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: dev }), dev);
    for (const bad of ["postgresql://u:p@ep-other-123.us-east-1.aws.neon.tech/db", "postgresql://u:p@db.example.com/x"]) {
      assert.throws(() => socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: bad }), SocketFixtureError);
    }
  });

  it("main is real-timing with v1; fast and restartable are TIMING_PROFILE=fast with v1 off, all APP_ENV=test", () => {
    const prev = process.env.E2E_SOCKET_DATABASE_URL;
    const prevSecret = process.env.SOCKET_TOKEN_SECRET;
    process.env.E2E_SOCKET_DATABASE_URL = LOCAL;
    try {
      // regression: REGRESSION-2 — a server without the token secret refused every handshake silently.
      delete process.env.SOCKET_TOKEN_SECRET;
      assert.throws(() => socketServerEnv("fast", { strict: true }), SocketFixtureError);
      process.env.SOCKET_TOKEN_SECRET = "t1:dGVzdA==";
      assert.equal(socketServerEnv("fast").SOCKET_TOKEN_SECRET, "t1:dGVzdA==");
      const main = socketServerEnv("main");
      assert.equal(main.APP_ENV, "test");
      assert.equal(main.PORT, "3002");
      assert.equal(main.PROTOCOL_V1, "on");
      assert.equal(main.TIMING_PROFILE, undefined);
      assert.equal(main.SENTRY_DSN, "");
      for (const kind of ["fast", "restartable"] as const) {
        const e = socketServerEnv(kind);
        assert.equal(e.APP_ENV, "test");
        assert.equal(e.TIMING_PROFILE, "fast");
        assert.equal(e.PROTOCOL_V1, "off");
        assert.match(e.INTERNAL_API_SECRET!, /(^|,)ops:/);
        assert.match(e.POSTHOG_HOST!, /^http:\/\/127\.0\.0\.1:/);
      }
      // FIX-A: the v1 server's LEGACY secret is the web's INTERNAL_API_SECRET verbatim (the web compares the
      // x-internal-token header with it as a string); the v2-only servers get none.
      const prevInt = process.env.INTERNAL_API_SECRET;
      const prevLegacy = process.env.LEGACY_INTERNAL_API_SECRET;
      delete process.env.LEGACY_INTERNAL_API_SECRET;
      process.env.INTERNAL_API_SECRET = "web:d2Vi";
      try {
        assert.equal(socketServerEnv("main").LEGACY_INTERNAL_API_SECRET, "web:d2Vi");
        assert.equal(socketServerEnv("fast").LEGACY_INTERNAL_API_SECRET, undefined);
        process.env.INTERNAL_API_SECRET = "bare-shared";
        assert.equal(socketServerEnv("main").LEGACY_INTERNAL_API_SECRET, "bare-shared");
      } finally {
        if (prevInt === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = prevInt;
        if (prevLegacy !== undefined) process.env.LEGACY_INTERNAL_API_SECRET = prevLegacy;
      }
      assert.equal(socketServerEnv("fast").PORT, "3102");
      assert.equal(socketServerEnv("restartable").PORT, "3103");
    } finally {
      if (prevSecret === undefined) delete process.env.SOCKET_TOKEN_SECRET;
      else process.env.SOCKET_TOKEN_SECRET = prevSecret;
      if (prev === undefined) delete process.env.E2E_SOCKET_DATABASE_URL;
      else process.env.E2E_SOCKET_DATABASE_URL = prev;
    }
  });
});
