import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  SOCKET_TOKEN_TTL_SECONDS,
  signSocketToken,
  verifySocketToken,
} from "../socket-token";

const SECRET = "test-secret-do-not-use";
const NOW = 1_800_000_000;

describe("signSocketToken", () => {
  it("produces a two-part base64url token that expires 15 minutes out by default", () => {
    const { token, expiresAt } = signSocketToken({ userReferenceId: "user_1", secret: SECRET, now: NOW });
    assert.equal(expiresAt, NOW + SOCKET_TOKEN_TTL_SECONDS);
    const parts = token.split(".");
    assert.equal(parts.length, 2);
    assert.match(parts[0]!, /^[A-Za-z0-9_-]+$/);
    assert.match(parts[1]!, /^[A-Za-z0-9_-]+$/);
    const payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    assert.deepEqual(payload, { sub: "user_1", exp: expiresAt });
  });

  it("honours a custom ttl", () => {
    const { expiresAt } = signSocketToken({
      userReferenceId: "user_1",
      secret: SECRET,
      now: NOW,
      ttlSeconds: 60,
    });
    assert.equal(expiresAt, NOW + 60);
  });

  it("refuses to sign without a secret or subject", () => {
    assert.throws(() => signSocketToken({ userReferenceId: "user_1", secret: "" }));
    assert.throws(() => signSocketToken({ userReferenceId: "", secret: SECRET }));
  });
});

describe("verifySocketToken", () => {
  it("round-trips a freshly signed token", () => {
    const { token } = signSocketToken({ userReferenceId: "user_abc", secret: SECRET, now: NOW });
    assert.deepEqual(verifySocketToken(token, SECRET, NOW + 1), { userReferenceId: "user_abc" });
  });

  it("rejects a tampered payload", () => {
    const { token } = signSocketToken({ userReferenceId: "user_abc", secret: SECRET, now: NOW });
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "user_victim", exp: NOW + SOCKET_TOKEN_TTL_SECONDS }),
      "utf8",
    ).toString("base64url");
    assert.equal(verifySocketToken(`${forged}.${signature}`, SECRET, NOW + 1), null);
  });

  it("rejects a tampered signature", () => {
    const { token } = signSocketToken({ userReferenceId: "user_abc", secret: SECRET, now: NOW });
    const [payload, signature] = token.split(".");
    const flipped = (signature![0] === "A" ? "B" : "A") + signature!.slice(1);
    assert.equal(verifySocketToken(`${payload}.${flipped}`, SECRET, NOW + 1), null);
    // Different length signature must also fail (length check precedes compare).
    assert.equal(verifySocketToken(`${payload}.${signature}x`, SECRET, NOW + 1), null);
  });

  it("rejects an expired token", () => {
    const { token, expiresAt } = signSocketToken({ userReferenceId: "user_abc", secret: SECRET, now: NOW });
    assert.equal(verifySocketToken(token, SECRET, expiresAt), null);
    assert.equal(verifySocketToken(token, SECRET, expiresAt + 1), null);
    assert.deepEqual(verifySocketToken(token, SECRET, expiresAt - 1), { userReferenceId: "user_abc" });
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signSocketToken({ userReferenceId: "user_abc", secret: "other-secret", now: NOW });
    assert.equal(verifySocketToken(token, SECRET, NOW + 1), null);
  });

  it("rejects malformed input and a missing secret without throwing", () => {
    assert.equal(verifySocketToken(undefined, SECRET, NOW), null);
    assert.equal(verifySocketToken(42, SECRET, NOW), null);
    assert.equal(verifySocketToken("", SECRET, NOW), null);
    assert.equal(verifySocketToken("abc", SECRET, NOW), null);
    assert.equal(verifySocketToken("a.b.c", SECRET, NOW), null);
    assert.equal(verifySocketToken(".", SECRET, NOW), null);
    const { token } = signSocketToken({ userReferenceId: "user_abc", secret: SECRET, now: NOW });
    assert.equal(verifySocketToken(token, undefined, NOW), null);
    assert.equal(verifySocketToken(token, "", NOW), null);
  });

  it("rejects a validly signed payload whose body is not a token", () => {
    const sign = (body: string) => {
      const encoded = Buffer.from(body, "utf8").toString("base64url");
      return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
    };
    assert.equal(verifySocketToken(sign("not json"), SECRET, NOW), null);
    assert.equal(verifySocketToken(sign("null"), SECRET, NOW), null);
    assert.equal(verifySocketToken(sign(JSON.stringify({ sub: "", exp: NOW + 10 })), SECRET, NOW), null);
    assert.equal(verifySocketToken(sign(JSON.stringify({ sub: "u", exp: "soon" })), SECRET, NOW), null);
    assert.equal(verifySocketToken(sign(JSON.stringify({ sub: "u" })), SECRET, NOW), null);
  });
});
