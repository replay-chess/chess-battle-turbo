// Socket token v2 (phase-02 plan §7.4.2, §12.1): sign/verify, wrong env, expired, tampered signature, unknown kid,
// key rotation (two kids), and `e2eRun` refused outside the test env.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { parseKeyRing } from "../../internal/auth";
import { SOCKET_TOKEN_TTL_SEC } from "../limits";
import {
  mintSocketToken,
  parseSocketKeyRing,
  signSocketToken,
  SOCKET_TOKEN_BARE_KID,
  type SocketTokenClaims,
  verifySocketToken,
  verifySocketTokenDetailed,
} from "../token";
import { BLACK_REF, T0, WHITE_NAME } from "./fixtures";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring = parseKeyRing(`k1:${k1}`);
const rotated = parseKeyRing(`k2:${k2},k1:${k1}`);
const NOW = T0;

function claims(over: Partial<SocketTokenClaims> = {}): SocketTokenClaims {
  const iat = Math.floor(NOW / 1000);
  return { v: 2, sub: BLACK_REF, iat, exp: iat + 900, env: "dev", ent: iat + 86_400, role: "user", name: WHITE_NAME, kid: "k1", ...over };
}

/** Signs any object the way the token format does, bypassing signSocketToken's guards (a forger with the key). */
function signRaw(payload: object, key: Buffer | string): string {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${createHmac("sha256", key).update(p).digest("base64url")}`;
}

/** Re-encodes the payload of a token without re-signing it. */
function tamper(token: string, change: (c: Record<string, unknown>) => void): string {
  const [payload, sig] = token.split(".") as [string, string];
  const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  change(c);
  return `${Buffer.from(JSON.stringify(c)).toString("base64url")}.${sig}`;
}

describe("socket token v2", () => {
  it("signs and verifies", () => {
    const token = signSocketToken(claims(), ring);
    assert.deepEqual(verifySocketToken(token, ring, NOW, "dev"), claims());
  });

  it("mints with the ring's signing kid and a 15-minute lifetime", () => {
    const { token, expiresAt, claims: c } = mintSocketToken({ sub: BLACK_REF, env: "dev", ent: 0, role: "admin", name: "Ana" }, rotated, NOW);
    assert.equal(c.kid, "k2");
    assert.equal(c.exp - c.iat, SOCKET_TOKEN_TTL_SEC);
    assert.equal(expiresAt, c.exp);
    assert.deepEqual(verifySocketToken(token, rotated, NOW + 60_000, "dev"), c);
    const short = mintSocketToken({ sub: BLACK_REF, env: "dev", ent: 0, role: "user", name: "Ana", ttlSec: 60 }, ring, NOW);
    assert.equal(short.claims.exp - short.claims.iat, 60);
    const capped = mintSocketToken({ sub: BLACK_REF, env: "dev", ent: 0, role: "user", name: "Ana", ttlSec: 86_400 }, ring, NOW);
    assert.equal(capped.claims.exp - capped.claims.iat, SOCKET_TOKEN_TTL_SEC);
  });

  it("refuses the wrong env", () => {
    const token = signSocketToken(claims({ env: "production" }), ring);
    assert.equal(verifySocketToken(token, ring, NOW, "dev"), null);
    assert.deepEqual(verifySocketTokenDetailed(token, ring, NOW, "dev"), { ok: false, reason: "env" });
  });

  it("refuses an expired token (exp ≤ now)", () => {
    const token = signSocketToken(claims(), ring);
    assert.equal(verifySocketToken(token, ring, NOW + 900_000, "dev"), null);
    assert.ok(verifySocketToken(token, ring, NOW + 899_000, "dev"));
  });

  it("refuses a token issued in the future beyond the skew", () => {
    const token = signSocketToken(claims(), ring);
    assert.deepEqual(verifySocketTokenDetailed(token, ring, NOW - 61_000, "dev"), { ok: false, reason: "not_yet_valid" });
    assert.ok(verifySocketToken(token, ring, NOW - 59_000, "dev"));
  });

  it("refuses a tampered payload or signature", () => {
    const token = signSocketToken(claims(), ring);
    assert.deepEqual(verifySocketTokenDetailed(tamper(token, (c) => (c.ent = 9_999_999_999)), ring, NOW, "dev"), {
      ok: false,
      reason: "bad_sig",
    });
    assert.equal(verifySocketToken(tamper(token, (c) => (c.role = "admin")), ring, NOW, "dev"), null);
    const [payload, sig] = token.split(".") as [string, string];
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    assert.equal(verifySocketToken(flipped, ring, NOW, "dev"), null);
    assert.equal(verifySocketToken(`${payload}.${sig}.x`, ring, NOW, "dev"), null);
    assert.equal(verifySocketToken(`${payload}`, ring, NOW, "dev"), null);
  });

  it("refuses an unknown kid", () => {
    const other = parseKeyRing(`k9:${randomBytes(32).toString("base64")}`);
    const token = signSocketToken(claims({ kid: "k9" }), other);
    assert.deepEqual(verifySocketTokenDetailed(token, ring, NOW, "dev"), { ok: false, reason: "unknown_kid" });
  });

  it("rotation: a receiver with both kids accepts tokens of either; the old ring refuses the new kid", () => {
    const old = signSocketToken(claims({ kid: "k1" }), rotated);
    const fresh = signSocketToken(claims({ kid: "k2" }), rotated);
    assert.ok(verifySocketToken(old, rotated, NOW, "dev"));
    assert.ok(verifySocketToken(fresh, rotated, NOW, "dev"));
    assert.equal(verifySocketToken(fresh, ring, NOW, "dev"), null);
  });

  it("e2eRun is accepted in env test only", () => {
    const testToken = signSocketToken(claims({ env: "test", e2eRun: "w3-quick-match-17" }), ring);
    assert.equal(verifySocketToken(testToken, ring, NOW, "test")?.e2eRun, "w3-quick-match-17");
    assert.throws(() => signSocketToken(claims({ env: "dev", e2eRun: "x" }), ring), /env test only/);
    // A dev token with e2eRun signed by someone who holds the key but bypasses the minting guard.
    const forged = signRaw(claims({ env: "dev", e2eRun: "x" }), ring.keys.get("k1") as Buffer);
    assert.deepEqual(verifySocketTokenDetailed(forged, ring, NOW, "dev"), { ok: false, reason: "e2e_run" });
  });

  it("refuses non-v2 claims, unknown fields and a lifetime above 15 minutes", () => {
    const key = ring.keys.get("k1") as Buffer;
    const sign = (c: object) => signRaw(c, key);
    assert.deepEqual(verifySocketTokenDetailed(sign({ ...claims(), v: 1 }), ring, NOW, "dev"), { ok: false, reason: "invalid_claims" });
    assert.deepEqual(verifySocketTokenDetailed(sign({ ...claims(), extra: 1 }), ring, NOW, "dev"), { ok: false, reason: "invalid_claims" });
    assert.deepEqual(verifySocketTokenDetailed(sign({ sub: BLACK_REF, exp: 9_999_999_999, kid: "k1" }), ring, NOW, "dev"), {
      ok: false,
      reason: "invalid_claims",
    });
    const c = claims();
    assert.deepEqual(verifySocketTokenDetailed(sign({ ...c, exp: c.iat + 901 }), ring, NOW, "dev"), { ok: false, reason: "ttl" });
    assert.throws(() => signSocketToken({ ...c, exp: c.iat + 901 }, ring), /lifetime/);
  });

  it("never throws on junk", () => {
    for (const junk of [undefined, null, 42, {}, "", ".", "a.b", "x".repeat(2_000), "%%%.%%%", "eyJ9.abc"]) {
      assert.equal(verifySocketToken(junk, ring, NOW, "dev"), null);
    }
    assert.equal(verifySocketToken(signSocketToken(claims(), ring), parseKeyRing(""), NOW, "dev"), null);
  });

  it("refuses v1 tokens ({sub, exp} signed with the old shared secret)", () => {
    const legacy = parseSocketKeyRing("legacy-shared-secret-value");
    assert.equal(legacy.signingKid, SOCKET_TOKEN_BARE_KID);
    const v1 = signRaw({ sub: BLACK_REF, exp: Math.floor(NOW / 1000) + 600 }, "legacy-shared-secret-value");
    assert.equal(verifySocketToken(v1, legacy, NOW, "dev"), null);
  });
});
