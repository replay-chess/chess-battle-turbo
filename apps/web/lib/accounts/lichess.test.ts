// lib/accounts/lichess.ts without a database: the token exchange's errors carry no secret, the revoke retries once and
// then reports `lichess.revoke_failed`, the authorize URL has no scope.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { installTestDeps } from "@/test/helpers/route-harness";
import { LichessOAuthError, authorizeUrl, exchangeCode, readAccount, revokeToken, setLichessFetch } from "./lichess";

const ENV = { LICHESS_BASE_URL: "http://li.test", LICHESS_CLIENT_ID: "replay-chess-test" };
let restores: (() => void)[] = [];
afterEach(() => {
  for (const r of restores.reverse()) r();
  restores = [];
});

function deps() {
  const t = installTestDeps({ env: ENV });
  restores.push(t.restore);
  return t.recorded;
}

describe("Lichess OAuth calls", () => {
  it("authorizeUrl: S256, state, redirect, client id, no scope", () => {
    deps();
    const u = new URL(authorizeUrl({ redirectUri: "https://app.test/api/accounts/lichess/callback", challenge: "c".repeat(43), state: "s".repeat(32) }));
    assert.equal(u.origin + u.pathname, "http://li.test/oauth");
    assert.equal(u.searchParams.get("client_id"), "replay-chess-test");
    assert.equal(u.searchParams.has("scope"), false);
  });

  it("exchangeCode: a 400 is `denied`, a network error `error`, a timeout `timeout`; no message carries the code", async () => {
    deps();
    restores.push(setLichessFetch(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    await assert.rejects(exchangeCode({ code: "SECRETCODE", verifier: "v".repeat(64), redirectUri: "x" }), (e: unknown) => {
      assert.ok(e instanceof LichessOAuthError);
      assert.equal(e.kind, "denied");
      assert.ok(!e.message.includes("SECRETCODE"));
      return true;
    });
    restores.push(setLichessFetch(async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    await assert.rejects(exchangeCode({ code: "c", verifier: "v".repeat(64), redirectUri: "x" }), (e: unknown) => e instanceof LichessOAuthError && e.kind === "timeout");
    restores.push(setLichessFetch(async () => new Response('{"token_type":"Bearer"}', { status: 200 })));
    await assert.rejects(exchangeCode({ code: "c", verifier: "v".repeat(64), redirectUri: "x" }), (e: unknown) => e instanceof LichessOAuthError && e.kind === "error");
  });

  it("readAccount validates with the lenient account schema", async () => {
    deps();
    restores.push(setLichessFetch(async () => new Response(JSON.stringify({ id: "a", username: "A" }), { status: 200 })));
    assert.equal((await readAccount("tok")).id, "a");
    restores.push(setLichessFetch(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })));
    await assert.rejects(readAccount("tok"), LichessOAuthError);
  });

  it("revokeToken: success at once; one retry; then the warning, never throwing", async () => {
    const recorded = deps();
    let calls = 0;
    restores.push(
      setLichessFetch(async (_u, init) => {
        calls += 1;
        assert.equal(init.method, "DELETE");
        return new Response(null, { status: calls === 1 ? 500 : 204 });
      }),
    );
    assert.equal(await revokeToken("tok"), true);
    assert.equal(calls, 2);
    calls = 0;
    restores.push(setLichessFetch(async () => Promise.reject(new Error("down"))));
    assert.equal(await revokeToken("tok"), false);
    assert.ok(recorded.messages.some((m) => m.message === "lichess.revoke_failed"));
    assert.ok(!JSON.stringify(recorded.messages).includes("tok"));
  });
});
