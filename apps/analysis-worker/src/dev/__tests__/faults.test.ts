// The provider fault table (phase-04 plan §7.7.4, §12.1 `faults.test.ts`; testing X12): the boot refusal in
// production, the table (modes, TTL, off), and the transport the provider clients see (synthetic 503 / 429 /
// timeout before the upstream is called; everything else passes through).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChessComClient } from "@repo/chess-import/chesscom/client";
import { isProviderError } from "@repo/chess-import/errors";
import { FAULT_TTL_MAX_SEC } from "@repo/contracts/internal/provider";
import { EnvError, loadEnv } from "../../config/env";
import { CountedGate } from "../../providers/gate";
import { FakeClock } from "../../scheduler/clock";
import { FAULT_RETRY_AFTER_SEC, FaultTable, FaultsAllowedError, faultingFetch, parseFaultsAllowed, providerOfUrl } from "../faults";

const BASES = { chesscom: "http://upstream.test/chesscom", lichess: "http://upstream.test/lichess" };

function realUpstream() {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    return new Response(JSON.stringify({
        "@id": "https://api.chess.com/pub/player/knightowl_88",
        url: "https://www.chess.com/member/knightowl_88",
        username: "knightowl_88",
        player_id: 1,
        status: "basic",
        joined: 1,
        last_online: 1,
      }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch };
}

describe("IMPORT_FAULTS_ALLOWED", () => {
  it("the worker refuses to boot with it in production", () => {
    for (const v of ["1", "on", "true", "yes"]) {
      assert.throws(
        () => loadEnv({ APP_ENV: "production", IMPORT_FAULTS_ALLOWED: v }),
        (e: unknown) => e instanceof EnvError && /IMPORT_FAULTS_ALLOWED is a test hook: it is refused with APP_ENV=production/.test(e.message),
      );
      assert.throws(() => parseFaultsAllowed({ IMPORT_FAULTS_ALLOWED: v }, "production"), FaultsAllowedError);
    }
  });

  it("is off by default and when set off, also in production", () => {
    assert.equal(parseFaultsAllowed({}, "production"), false);
    assert.equal(parseFaultsAllowed({ IMPORT_FAULTS_ALLOWED: "0" }, "production"), false);
    assert.equal(parseFaultsAllowed({ IMPORT_FAULTS_ALLOWED: " " }, "dev"), false);
  });

  it("is allowed in dev, test and local", () => {
    for (const appEnv of ["dev", "test", "local"]) assert.equal(parseFaultsAllowed({ IMPORT_FAULTS_ALLOWED: "1" }, appEnv), true);
  });

  it("refuses a value that is not on/off without echoing it", () => {
    assert.throws(
      () => parseFaultsAllowed({ IMPORT_FAULTS_ALLOWED: "s3cr3t-value" }, "dev"),
      (e: unknown) => e instanceof FaultsAllowedError && !e.message.includes("s3cr3t"),
    );
  });
});

describe("FaultTable", () => {
  it("applies a fault, lists it with its end, expires it after ttlSec and clears it with off", () => {
    let now = Date.UTC(2026, 10, 12, 10, 0, 0);
    const table = new FaultTable(() => now);
    assert.deepEqual(table.view(), { faults: [] });
    const after = table.apply({ provider: "chesscom", mode: "5xx", ttlSec: 60 });
    assert.deepEqual(after, { faults: [{ provider: "chesscom", mode: "5xx", until: "2026-11-12T10:01:00.000Z" }] });
    table.apply({ provider: "lichess", mode: "429", ttlSec: FAULT_TTL_MAX_SEC });
    assert.equal(table.active("chesscom"), "5xx");
    now += 59_999;
    assert.equal(table.active("chesscom"), "5xx");
    now += 1;
    assert.equal(table.active("chesscom"), null, "expired at exactly ttlSec");
    assert.deepEqual(
      table.view().faults.map((f) => f.provider),
      ["lichess"],
    );
    table.apply({ provider: "lichess", mode: "off", ttlSec: 1 });
    assert.deepEqual(table.view(), { faults: [] });
  });

  it("a new fault for a provider replaces the old one", () => {
    const table = new FaultTable(() => 0);
    table.apply({ provider: "lichess", mode: "timeout", ttlSec: 10 });
    table.apply({ provider: "lichess", mode: "429", ttlSec: 20 });
    assert.equal(table.active("lichess"), "429");
    assert.equal(table.view().faults.length, 1);
  });
});

describe("faultingFetch", () => {
  it("maps URLs to providers by the configured bases only", () => {
    assert.equal(providerOfUrl("http://upstream.test/chesscom/pub/player/x", BASES), "chesscom");
    assert.equal(providerOfUrl("http://upstream.test/lichess/api/games/user/x?max=1", BASES), "lichess");
    assert.equal(providerOfUrl("http://upstream.test/chesscomx/pub", BASES), null);
    assert.equal(providerOfUrl("http://websocket:3002/internal/emit", BASES), null);
  });

  it("answers 503 / 429 (Retry-After 30) without calling the upstream; other providers and URLs pass through", async () => {
    const table = new FaultTable(() => 0);
    const up = realUpstream();
    const f = faultingFetch(up.fetch, table, BASES);
    table.apply({ provider: "chesscom", mode: "5xx", ttlSec: 60 });
    const r1 = await f(`${BASES.chesscom}/pub/player/a`, {});
    assert.equal(r1.status, 503);
    table.apply({ provider: "chesscom", mode: "429", ttlSec: 60 });
    const r2 = await f(`${BASES.chesscom}/pub/player/a`, {});
    assert.equal(r2.status, 429);
    assert.equal(r2.headers.get("retry-after"), String(FAULT_RETRY_AFTER_SEC));
    assert.equal(up.calls.length, 0, "a faulted call never reaches the upstream");
    assert.equal((await f(`${BASES.lichess}/api/games/user/a`, {})).status, 200);
    assert.equal((await f("http://elsewhere.test/x", {})).status, 200);
    assert.equal(up.calls.length, 2);
    assert.equal(table.served.chesscom, 2);
    assert.equal(table.served.lichess, 0);
  });

  it("a timeout fault hangs until the caller's signal aborts", async () => {
    const table = new FaultTable(() => 0);
    table.apply({ provider: "lichess", mode: "timeout", ttlSec: 60 });
    const f = faultingFetch(realUpstream().fetch, table, BASES);
    const ctl = new AbortController();
    let settled = false;
    const p = f(`${BASES.lichess}/api/games/user/a`, { signal: ctl.signal }).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false);
    ctl.abort(new Error("deadline"));
    await assert.rejects(p, /deadline/);
  });

  it("through the real Chess.com client: 503 → upstream, 429 → rate_limited + the gate paused, timeout → timeout", async () => {
    const clock = new FakeClock(Date.UTC(2026, 10, 12, 10, 0, 0));
    const table = new FaultTable(() => clock.now());
    const gate = new CountedGate({ provider: "chesscom", clock });
    const client = new ChessComClient({
      baseUrl: BASES.chesscom,
      fetch: faultingFetch(realUpstream().fetch, table, BASES),
      clock,
      gate,
      caller: "worker",
    });
    table.apply({ provider: "chesscom", mode: "5xx", ttlSec: 600 });
    await assert.rejects(client.getProfile("knightowl_88"), (e: unknown) => isProviderError(e) && e.kind === "upstream" && e.status === 503);

    table.apply({ provider: "chesscom", mode: "429", ttlSec: 600 });
    await assert.rejects(
      client.getProfile("knightowl_88"),
      (e: unknown) => isProviderError(e) && e.kind === "rate_limited" && e.retryAfterSec === FAULT_RETRY_AFTER_SEC,
    );
    assert.ok(gate.pauseUntil >= clock.now() + 60_000, "the 429 paused the gate (Chess.com 60 s ≥ Retry-After 30 s)");

    table.apply({ provider: "chesscom", mode: "timeout", ttlSec: 600 });
    await clock.advance(61_000); // the pause ends
    const pending = client.getProfile("knightowl_88").then(
      () => "resolved",
      (e: unknown) => (isProviderError(e) ? e.kind : "other"),
    );
    await clock.advance(8_001); // the worker's 8 s profile timeout
    assert.equal(await pending, "timeout");

    table.apply({ provider: "chesscom", mode: "off", ttlSec: 1 });
    const profile = await client.getProfile("knightowl_88");
    assert.equal(profile.username, "knightowl_88");
  });
});
