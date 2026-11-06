// lib/socket-token.ts (phase-02 plan §7.1.7): v2 claims, the SOCKET_TOKEN_SECRET ring and the dev-only fallback.
// Verification itself is tested in @repo/contracts (src/socket/test/token.test.ts); here the minted token must
// verify with the socket's own function and carry the right claims.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { parseSocketKeyRing, verifySocketToken } from "@repo/contracts/socket/token";
import {
  OPEN_ENDED_ENT_SEC,
  SOCKET_TOKEN_TTL_SECONDS,
  SocketTokenConfigError,
  claimName,
  devFallbackAllowed,
  entFromSessionClaims,
  entitledUntilSec,
  mintSocketTokenForViewer,
  socketTokenKeyRing,
  tokenEnvOf,
  type TokenViewer,
} from "../socket-token";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const NOW_S = Math.floor(NOW / 1000);
const KEY = randomBytes(32).toString("base64");
const KEY2 = randomBytes(32).toString("base64");
const ENV_TEST = { NEXT_PUBLIC_APP_ENV: "test", NODE_ENV: "test", SOCKET_TOKEN_SECRET: `d1:${KEY}` };

function viewer(overrides: Partial<TokenViewer["entitlement"]> & { name?: string; role?: "user" | "admin" } = {}): TokenViewer {
  const { name = "Ann Example", role = "user", ...ent } = overrides;
  return {
    ref: "cviewer00000000000000000000",
    role,
    user: { name },
    entitlement: {
      member: true,
      entitled: true,
      currentPeriodEnd: "2026-12-05T12:00:00.000Z",
      trial: { active: false, endsAt: null },
      ...ent,
    },
  };
}

describe("socket token v2 minting", () => {
  it("mints claims {v:2, sub, iat, exp, env, ent, role, name, kid} that the socket verifies", () => {
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: ENV_TEST });
    assert.equal(minted.source, "socket_token_secret");
    assert.equal(minted.expiresAt, NOW_S + SOCKET_TOKEN_TTL_SECONDS);
    const claims = verifySocketToken(minted.token, parseSocketKeyRing(`d1:${KEY}`), NOW, "test");
    assert.ok(claims);
    assert.deepEqual(
      { v: claims.v, sub: claims.sub, iat: claims.iat, exp: claims.exp, env: claims.env, role: claims.role, name: claims.name, kid: claims.kid },
      { v: 2, sub: "cviewer00000000000000000000", iat: NOW_S, exp: NOW_S + 900, env: "test", role: "user", name: "Ann Example", kid: "d1" },
    );
    assert.equal(claims.ent, Math.floor(Date.parse("2026-12-05T12:00:00.000Z") / 1000));
    assert.equal(claims.e2eRun, undefined);
  });

  it("signs with the first kid of the ring and verifies after rotation", () => {
    const env = { ...ENV_TEST, SOCKET_TOKEN_SECRET: `d2:${KEY2},d1:${KEY}` };
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env });
    assert.equal(minted.claims.kid, "d2");
    assert.ok(verifySocketToken(minted.token, parseSocketKeyRing(`d1:${KEY},d2:${KEY2}`), NOW, "test"));
    assert.equal(verifySocketToken(minted.token, parseSocketKeyRing(`d1:${KEY}`), NOW, "test"), null);
  });

  it("a token minted for one env is refused by a socket of another env", () => {
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: { ...ENV_TEST, NEXT_PUBLIC_APP_ENV: "dev" } });
    assert.equal(minted.claims.env, "dev");
    assert.equal(verifySocketToken(minted.token, parseSocketKeyRing(`d1:${KEY}`), NOW, "production"), null);
  });

  it("e2eRun only for APP_ENV=test", () => {
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: ENV_TEST, e2eRun: "run-1" });
    assert.equal(minted.claims.e2eRun, "run-1");
    assert.throws(
      () => mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: { ...ENV_TEST, NEXT_PUBLIC_APP_ENV: "dev" }, e2eRun: "run-1" }),
      SocketTokenConfigError,
    );
  });

  it("names are clipped to 40 characters and the role is carried", () => {
    const long = "x".repeat(60);
    const minted = mintSocketTokenForViewer(viewer({ name: `  ${long}  `, role: "admin" }), { nowMs: NOW, env: ENV_TEST });
    assert.equal(minted.claims.name.length, 40);
    assert.equal(minted.claims.role, "admin");
    assert.equal(claimName(" Bo "), "Bo");
  });
});

describe("key ring and the dev-only fallback", () => {
  it("SOCKET_TOKEN_SECRET wins over INTERNAL_API_SECRET", () => {
    const keys = socketTokenKeyRing({ ...ENV_TEST, INTERNAL_API_SECRET: "legacy-shared-secret" });
    assert.equal(keys?.source, "socket_token_secret");
    assert.equal(keys?.ring.signingKid, "d1");
  });

  it("falls back to the old shared secret on dev and test only", () => {
    for (const env of [
      { NEXT_PUBLIC_APP_ENV: "dev", NODE_ENV: "production", INTERNAL_API_SECRET: "legacy-shared-secret" },
      { NEXT_PUBLIC_APP_ENV: "test", NODE_ENV: "production", INTERNAL_API_SECRET: "legacy-shared-secret" },
      { NODE_ENV: "development", INTERNAL_API_SECRET: "legacy-shared-secret" },
    ]) {
      const keys = socketTokenKeyRing(env);
      assert.equal(keys?.source, "dev_fallback", JSON.stringify(env));
      assert.equal(keys?.ring.signingKid, "s0");
    }
  });

  it("production never falls back (unset → not configured)", () => {
    assert.equal(socketTokenKeyRing({ NEXT_PUBLIC_APP_ENV: "production", NODE_ENV: "production", INTERNAL_API_SECRET: "x" }), null);
    assert.equal(socketTokenKeyRing({ NODE_ENV: "production", INTERNAL_API_SECRET: "x" }), null);
    assert.equal(devFallbackAllowed({ NEXT_PUBLIC_APP_ENV: "production" }), false);
    assert.throws(
      () => mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: { NEXT_PUBLIC_APP_ENV: "production", NODE_ENV: "production" } }),
      SocketTokenConfigError,
    );
  });

  it("a fallback token is verifiable with the old secret as a bare key (the v1 socket's HMAC)", () => {
    const env = { NEXT_PUBLIC_APP_ENV: "dev", INTERNAL_API_SECRET: "legacy-shared-secret" };
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env });
    assert.ok(verifySocketToken(minted.token, parseSocketKeyRing("legacy-shared-secret"), NOW, "dev"));
  });

  it("a malformed ring is a config error that does not echo key material", () => {
    try {
      socketTokenKeyRing({ SOCKET_TOKEN_SECRET: "d1:QUJDREVG" });
      assert.fail("should throw");
    } catch (err) {
      assert.ok(err instanceof SocketTokenConfigError);
      assert.ok(!String((err as Error).message).includes("QUJDREVG"));
    }
  });

  it("tokenEnvOf maps unknown values to local", () => {
    assert.equal(tokenEnvOf({ NEXT_PUBLIC_APP_ENV: "dev" }), "dev");
    assert.equal(tokenEnvOf({ NEXT_PUBLIC_APP_ENV: "staging" }), "local");
    assert.equal(tokenEnvOf({}), "local");
  });
});

describe("ent (entitled until)", () => {
  it("0 for a non-member", () => {
    assert.equal(entitledUntilSec(viewer({ member: false, entitled: false }), NOW), 0);
  });

  it("the trial end for a trial member", () => {
    const v = viewer({ entitled: false, currentPeriodEnd: null, trial: { active: true, endsAt: "2026-11-09T12:00:00.000Z" } });
    assert.equal(entitledUntilSec(v, NOW), Math.floor(Date.parse("2026-11-09T12:00:00.000Z") / 1000));
  });

  it("open-ended members (admin, paywall off, grace) get now + 24 h", () => {
    assert.equal(entitledUntilSec(viewer({ entitled: false, currentPeriodEnd: null }), NOW), NOW_S + OPEN_ENDED_ENT_SEC);
    assert.equal(entitledUntilSec(viewer({ currentPeriodEnd: "2026-11-06T12:05:00.000Z" }), NOW), NOW_S + OPEN_ENDED_ENT_SEC);
  });

  it("session claims are used only when they carry both entitled and entUntil", () => {
    assert.equal(entFromSessionClaims({ entitled: true, lapsed: false }, NOW), null);
    assert.equal(entFromSessionClaims({ entitled: true, entUntil: NOW_S + 3600 }, NOW), NOW_S + 3600);
    assert.equal(entFromSessionClaims({ entitled: true, entUntil: NOW_S - 1 }, NOW), 0);
    assert.equal(entFromSessionClaims({ entitled: false, entUntil: NOW_S + 3600 }, NOW), 0);
    assert.equal(entFromSessionClaims(null, NOW), null);
    const minted = mintSocketTokenForViewer(viewer(), { nowMs: NOW, env: ENV_TEST, ent: NOW_S + 3600 });
    assert.equal(minted.claims.ent, NOW_S + 3600);
  });
});
