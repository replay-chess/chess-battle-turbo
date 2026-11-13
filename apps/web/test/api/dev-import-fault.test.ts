// /api/dev/import-fault (phase-04 plan §7.7.4, §11.1; testing X12): a test hook that 404s unless test hooks are on
// and the caller is an admin or the e2e runner; when allowed it validates the body with the contract and forwards
// it to the worker's /internal/dev/fault, signed with the web's worker kid (webwk), and passes the table back.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parseKeyRing, verifyInternal, ReplayGuard } from "@repo/contracts/internal/auth";
import { WORKER_DEV_FAULT_PATH } from "@repo/contracts/internal/provider";

const { GET, POST } = await import("@/app/api/dev/import-fault/route");

const TOKEN = "e2e-token-for-the-fault-route-test";
const RING = `webwk:${randomBytes(32).toString("base64")}`;
const HOOKS_ON = {
  NEXT_PUBLIC_APP_ENV: "test",
  ALLOW_TEST_HOOKS: "1",
  E2E_TEST_TOKEN: TOKEN,
  ANALYSIS_WORKER_URL: "http://worker.test:3003",
  INTERNAL_API_SECRET: RING,
};
const TABLE = { faults: [{ provider: "lichess", mode: "429", until: "2026-11-12T10:05:00.000Z" }] };

type Sent = { url: string; method: string; headers: Headers; body: string };
let sent: Sent[] = [];
let workerAnswer: () => Response = () => Response.json(TABLE);
const realFetch = globalThis.fetch;
const saved: Record<string, string | undefined> = {};

function setEnv(env: Record<string, string>) {
  for (const k of Object.keys(HOOKS_ON)) {
    if (!(k in saved)) saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
}

beforeEach(() => {
  sent = [];
  workerAnswer = () => Response.json(TABLE);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return workerAnswer();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const req = (method: "GET" | "POST", body?: string, headers: Record<string, string> = { "x-e2e-token": TOKEN }) =>
  new Request("http://localhost:3000/api/dev/import-fault", { method, headers, body }) as unknown as Parameters<typeof GET>[0];

describe("/api/dev/import-fault", () => {
  it("404 when test hooks are off, even with the e2e token, and the worker is never called", async () => {
    setEnv({ ...HOOKS_ON, ALLOW_TEST_HOOKS: "0" });
    assert.equal((await GET(req("GET"))).status, 404);
    assert.equal((await POST(req("POST", '{"v":1,"provider":"lichess","mode":"429","ttlSec":60}'))).status, 404);
    setEnv({ ...HOOKS_ON, NEXT_PUBLIC_APP_ENV: "production" });
    assert.equal((await GET(req("GET"))).status, 404);
    assert.deepEqual(sent, []);
  });

  it("POST with the e2e token: validated, signed with webwk over the exact bytes, the worker's table passed back", async () => {
    setEnv(HOOKS_ON);
    const body = JSON.stringify({ v: 1, provider: "lichess", mode: "429", ttlSec: 300 });
    const res = await POST(req("POST", body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: TABLE });
    assert.equal(sent.length, 1);
    const call = sent[0]!;
    assert.equal(call.url, `http://worker.test:3003${WORKER_DEV_FAULT_PATH}`);
    assert.equal(call.method, "POST");
    assert.deepEqual(JSON.parse(call.body), JSON.parse(body));
    const headers: Record<string, string> = {};
    call.headers.forEach((v, k) => (headers[k] = v));
    const verdict = verifyInternal({
      headers,
      method: "POST",
      path: WORKER_DEV_FAULT_PATH,
      body: Buffer.from(call.body),
      keys: parseKeyRing(RING),
      nowMs: Date.now(),
      replay: new ReplayGuard(),
    });
    assert.ok(verdict.ok && verdict.kid === "webwk", "signed with the web's worker kid");
  });

  it("GET reads the table; a bad body is refused before the worker; a worker without the switch is a 502", async () => {
    setEnv(HOOKS_ON);
    const read = await GET(req("GET"));
    assert.equal(read.status, 200);
    assert.equal(sent[0]!.method, "GET");
    for (const bad of ['{"v":1,"provider":"lichess","mode":"429","ttlSec":601}', '{"v":1,"provider":"x","mode":"5xx","ttlSec":1}', "nope"]) {
      const r = await POST(req("POST", bad));
      assert.equal(r.status, 400, bad);
    }
    assert.equal(sent.length, 1, "no worker call for a bad body");
    workerAnswer = () => Response.json({ error: "not_found" }, { status: 404 });
    assert.equal((await POST(req("POST", '{"v":1,"provider":"chesscom","mode":"off","ttlSec":1}'))).status, 502);
  });

  it("a wrong e2e token is not the runner (and the admin check then decides)", async () => {
    setEnv(HOOKS_ON);
    // With a wrong token the route falls back to the admin session check (Clerk), which cannot run outside a Next
    // request: the call fails instead of reaching the worker, so the token comparison did not let it through. The
    // signed-in non-admin 404 is proven over HTTP (test/authz/legacy-routes.ts row, e2e prod-guard / security specs).
    await assert.rejects(async () => GET(req("GET", undefined, { "x-e2e-token": "wrong" })));
    assert.deepEqual(sent, []);
  });
});
