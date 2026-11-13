/**
 * Authorisation of the P4 accounts and import routes (phase-04 plan §11.1, §11.2) against a real Postgres: signed out
 * → 401; never subscribed → 402 `trial_available` and lapsed → 402 `expired` on the member routes (sync, retry), while
 * every other account route stays open to them; admin passes; resources are scoped by the viewer (another member's
 * run ref is a 404, never 403; one member's unlink never touches another's link). SSRF / path injection: a handle
 * outside `^[A-Za-z0-9_-]{3,25}$` is a 400 before any upstream call, and the provider's URL is built with
 * `encodeURIComponent` from the validated handle only.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ErrorEnvelope } from "@repo/contracts/http/envelope";
import { jsonOf } from "../helpers/route-harness";
import { accountsWorld, CC_HANDLE, type Handlers } from "../api/accounts-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

async function codeOf(res: Response): Promise<{ status: number; code: string; reason?: string }> {
  if (res.status < 400) return { status: res.status, code: "ok" };
  const body = ErrorEnvelope.parse(await jsonOf(res));
  return { status: res.status, code: body.error.code, reason: (body.error.details as { reason?: string } | undefined)?.reason };
}

describe("P4 accounts and import routes: authz (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = accountsWorld(url ?? "");
  const H = {} as Record<"list" | "lookup" | "link" | "provider" | "sync" | "status" | "retry", Handlers>;

  before(async () => {
    await w.setup();
    H.list = await import("@/app/api/accounts/route");
    H.lookup = await import("@/app/api/accounts/chesscom/lookup/route");
    H.link = (await import("@/app/api/accounts/chesscom/route")) as unknown as Handlers;
    H.provider = await import("@/app/api/accounts/[provider]/route");
    H.sync = await import("@/app/api/accounts/[provider]/sync/route");
    H.status = await import("@/app/api/import/status/route");
    H.retry = await import("@/app/api/import/[ref]/retry/route");
  });
  after(() => w.teardown());
  beforeEach(async () => {
    for (const who of ["m", "o", "n", "l"] as const) await w.reset(who);
  });

  const SYNC = { body: {}, params: { provider: "chesscom" } };
  const REF = "cabcdefghijklmnopqrstuvwx";

  it("§11.1 matrix: signed out 401 everywhere; member routes 402 with the reason; the rest open to non-members", async () => {
    const rows: [string, Handlers, "GET" | "POST" | "PATCH" | "DELETE", string, Parameters<typeof w.call>[4]][] = [
      ["list", H.list, "GET", "/api/accounts", {}],
      ["lookup", H.lookup, "POST", "/api/accounts/chesscom/lookup", { body: { username: CC_HANDLE } }],
      ["status", H.status, "GET", "/api/import/status", {}],
      ["sync", H.sync, "POST", "/api/accounts/chesscom/sync", SYNC],
      ["retry", H.retry, "POST", `/api/import/${REF}/retry`, { body: {}, params: { ref: REF } }],
      ["update", H.provider, "PATCH", "/api/accounts/lichess", { body: { autoImport: true }, params: { provider: "lichess" } }],
      ["unlink", H.provider, "DELETE", "/api/accounts/lichess", { params: { provider: "lichess" } }],
    ];
    const member = new Set(["sync", "retry"]);
    for (const [name, h, method, path, init] of rows) {
      const out = await codeOf((await w.call(h, method, path, null, init)).res);
      assert.deepEqual([out.status, out.code], [401, "unauthorized"], `${name} signed out`);
      for (const who of ["n", "l"] as const) {
        const got = await codeOf((await w.call(h, method, path, who, init)).res);
        if (member.has(name)) {
          assert.deepEqual([got.status, got.code], [402, "subscription_required"], `${name} ${who}`);
          assert.equal(got.reason, who === "n" ? "trial_available" : "expired", `${name} ${who} reason`);
        } else {
          assert.ok(got.status !== 401 && got.status !== 402, `${name} open to ${who} (got ${got.status} ${got.code})`);
        }
      }
    }
    // The member and an admin pass the gate (the resource itself may not exist: 404, never 402/403).
    for (const viewer of [w.viewerOf("m"), w.viewerOf("m", { role: "admin" })]) {
      const got = await codeOf((await w.call(H.retry, "POST", `/api/import/${REF}/retry`, "m", { body: {}, params: { ref: REF }, viewer })).res);
      assert.deepEqual([got.status, got.code], [404, "not_found"]);
    }
  });

  it("resources are the viewer's: another member's run is a 404, another member's account is never touched", async () => {
    assert.equal((await w.call(H.link, "POST", "/api/accounts/chesscom", "o", { body: { username: CC_HANDLE, context: "settings" }, headers: { "idempotency-key": globalThis.crypto.randomUUID() } })).res.status, 201);
    const [run] = await w.db.$queryRawUnsafe<{ referenceId: string }[]>(`SELECT "referenceId" FROM import_runs WHERE "userId" = $1::bigint`, w.users.o.id.toString());
    const ref = run!.referenceId;
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'FAILED', "finishedAt" = now() WHERE "referenceId" = $1`, ref);
    assert.deepEqual(await codeOf((await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "m", { body: {}, params: { ref } })).res), { status: 404, code: "not_found", reason: undefined });
    const status = await w.call(H.status, "GET", "/api/import/status", "m");
    assert.deepEqual(((await jsonOf(status.res)) as { data: { runs: unknown[] } }).data.runs, []);
    assert.equal((await codeOf((await w.call(H.link, "DELETE", "/api/accounts/chesscom", "m")).res)).status, 404);
    const still = await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM linked_accounts WHERE "userId" = $1::bigint`, w.users.o.id.toString());
    assert.equal(still.length, 1);
    assert.equal((await codeOf((await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", SYNC)).res)).status, 404);
  });

  it("SSRF / path injection: bad handles are 400 before any upstream call; the URL carries only the encoded handle", async () => {
    const before = w.chesscomCalls.length;
    for (const username of ["../etc", "a/b", "%2e%2e", "knight owl", "x", "a".repeat(26), "user?x=1", "user#f", "ü_user", "@", "http://evil.test"]) {
      const out = await codeOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "m", { body: { username } })).res);
      assert.deepEqual([out.status, out.code], [400, "validation_failed"], username);
      const link = await codeOf(
        (await w.call(H.link, "POST", "/api/accounts/chesscom", "m", { body: { username, context: "settings" }, headers: { "idempotency-key": globalThis.crypto.randomUUID() } })).res,
      );
      assert.deepEqual([link.status, link.code], [400, "validation_failed"], `link ${username}`);
    }
    assert.equal(w.chesscomCalls.length, before, "no upstream call for an invalid handle");
    await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "m", { body: { username: " @Knight-Owl_9 " } });
    assert.equal(w.chesscomCalls.at(-1), "/pub/player/knight-owl_9");
    for (const provider of ["CHESSCOM", "x", "../chesscom"]) {
      const out = await codeOf((await w.call(H.sync, "POST", `/api/accounts/${provider}/sync`, "m", { body: {}, params: { provider } })).res);
      assert.equal(out.status, 400, provider);
    }
  });
});
