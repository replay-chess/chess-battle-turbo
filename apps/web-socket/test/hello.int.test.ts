// `session:hello` and the user-room sequence (phase-02 plan 12.4 `hello`, 7.4.1 step 6, api-perf AP-25): the hello
// carries `bootId` and the user's current `useq`; every user-room event (here `test:echo` through /internal/emit)
// increments it by one; a restarted server has a new `bootId` (the client then refetches its user-level queries).
import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { closeAllClients, connect, startServer, user, waitFor, type TestServer } from "./helpers";

const RING = `web:${randomBytes(32).toString("base64")}`;
const keys = parseKeyRing(RING);

async function echo(url: string, userRef: string, text: string) {
  const raw = JSON.stringify({ v: 1, targets: [{ userRef }], event: "test:echo", data: { text } });
  const headers = signInternal({ keys, method: "POST", path: "/internal/emit", body: raw, nowMs: Date.now() });
  return fetch(`${url}/internal/emit`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: raw });
}

describe("session:hello", () => {
  const servers: TestServer[] = [];
  afterEach(() => closeAllClients());
  after(async () => {
    for (const s of servers) await s.close();
  });

  test("bootId and useq; useq + 1 per user-room event; a restart changes bootId", async () => {
    const a = await startServer({ env: { INTERNAL_API_SECRET: RING } });
    servers.push(a);
    const u = user("u");
    const first = await connect(a.url, u);
    assert.equal(first.hello.bootId, a.handle.bootId);
    assert.equal(first.hello.useq, 0);
    assert.ok(Math.abs(first.hello.serverNow - Date.now()) < 1_000);
    for (const [i, text] of ["one", "two"].entries()) {
      const got = waitFor(first.socket, "test:echo");
      assert.equal((await echo(a.url, u.ref, text)).status, 202);
      assert.equal((await got).useq, i + 1);
    }
    const second = await connect(a.url, u);
    assert.equal(second.hello.useq, 2, "a reconnect learns the current useq (no gap → no refetch)");

    const b = await startServer({ env: { INTERNAL_API_SECRET: RING } });
    servers.push(b);
    const third = await connect(b.url, u);
    assert.notEqual(third.hello.bootId, first.hello.bootId, "a new process, a new bootId");
    assert.equal(third.hello.useq, 0);
  });
});
