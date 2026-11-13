// LichessClient (phase-04 plan §7.8, §8.7 steps 1–2, R-LI-06): the export URL, NDJSON over split chunks with a
// malformed line counted, one stream at a time (the gate is held for the whole stream), an early stop releases the
// gate, 429 pauses the gate on the ladder, 5xx / idle / abort errors, the web confirm call, and /api/user.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ProviderError } from "../../errors";
import { ProviderGate } from "../../gate";
import { userAgent } from "../../http";
import { encodeLichessGame } from "../../testing/encode";
import { FakeClock, flush } from "../../testing/fake-clock";
import { chunkStream, empty, hang, json, pushStream, recordingFetch } from "../../__tests__/helpers";
import { LICHESS_TIMEOUTS, LICHESS_USERNAME_RE, LichessClient } from "../client";

const kindOf = (kind: string) => (e: unknown) => e instanceof ProviderError && e.kind === kind;
const ndjson = (body: ReadableStream<Uint8Array>, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });

const game = (id: string) =>
  encodeLichessGame({
    id,
    sans: ["e4", "e5"],
    speed: "blitz",
    status: "resign",
    winner: "white",
    white: { id: "knightowl88", name: "KnightOwl88", rating: 1500 },
    black: { id: "opponent01", name: "Opponent01", rating: 1490 },
    createdAt: 1,
    lastMoveAt: 2,
    clock: { initial: 300, increment: 0 },
  });

async function drain(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("LichessClient", () => {
  it("builds the worker's anonymous export URL (§7.8) on the injected base URL", () => {
    const c = new LichessClient({ baseUrl: "http://127.0.0.1:4010/lichess", gate: null });
    const u = new URL(c.exportUrl("KnightOwl88", { since: 1_700_000_000_000, until: 1_790_000_000_000.7, max: 2000 }));
    assert.equal(u.origin + u.pathname, "http://127.0.0.1:4010/lichess/api/games/user/knightowl88");
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      since: "1700000000000",
      until: "1790000000000",
      max: "2000",
      rated: "true",
      perfType: "ultraBullet,bullet,blitz,rapid,classical,correspondence",
      moves: "true",
      clocks: "true",
      evals: "true",
      opening: "true",
      finished: "true",
      pgnInJson: "false",
      tags: "false",
    });
  });

  it("validates usernames before calling out", async () => {
    assert.ok(LICHESS_USERNAME_RE.test("ab"));
    assert.ok(LICHESS_USERNAME_RE.test("Knight_Owl-88"));
    assert.ok(!LICHESS_USERNAME_RE.test("_x"));
    assert.ok(!LICHESS_USERNAME_RE.test("a/b"));
    const rf = recordingFetch(() => json({}));
    const c = new LichessClient({ fetch: rf.fetch, gate: null });
    await assert.rejects(drain(c.streamGames("../x", {})), kindOf("not_found"));
    assert.equal(rf.calls.length, 0);
  });

  it("streams games over split chunks, skipping and counting a malformed line", async () => {
    const lines = [JSON.stringify(game("Game0001")), "{oops", JSON.stringify(game("Game0002"))].join("\n");
    const cut = Math.floor(lines.length / 3);
    const rf = recordingFetch(() => ndjson(chunkStream([lines.slice(0, cut), lines.slice(cut, 2 * cut), lines.slice(2 * cut)])));
    const c = new LichessClient({ fetch: rf.fetch, gate: null });
    const stats = { lines: 0, invalid: 0 };
    const out = (await drain(c.streamGames("knightowl88", { max: 10 }, { stats }))) as { id: string }[];
    assert.deepEqual(
      out.map((g) => g.id),
      ["Game0001", "Game0002"],
    );
    assert.deepEqual(stats, { lines: 3, invalid: 1 });
    assert.equal(rf.calls[0]!.headers.accept, "application/x-ndjson");
    assert.equal(rf.calls[0]!.headers["user-agent"], userAgent());
    assert.equal(rf.calls[0]!.headers.authorization, undefined, "always anonymous (D4-21)");
  });

  it("holds the gate for the whole stream: a second stream starts only after the first ends", async () => {
    const gate = new ProviderGate({ provider: "lichess" });
    const first = pushStream();
    const rf = recordingFetch((_, __, n) => (n === 1 ? ndjson(first.stream) : ndjson(chunkStream([JSON.stringify(game("Game0003"))]))));
    const c = new LichessClient({ fetch: rf.fetch, gate });
    const a = drain(c.streamGames("knightowl88", {}));
    const b = drain(c.streamGames("knightowl88", {}));
    first.push(JSON.stringify(game("Game0001")) + "\n");
    await flush();
    assert.equal(rf.calls.length, 1, "the second request waits for the gate");
    assert.equal(rf.maxActive, 1);
    first.close();
    assert.equal((await a).length, 1);
    assert.equal((await b).length, 1);
    assert.equal(rf.calls.length, 2);
  });

  it("an early stop by the consumer releases the gate", async () => {
    const gate = new ProviderGate({ provider: "lichess" });
    const s = pushStream();
    const c = new LichessClient({ fetch: async () => ndjson(s.stream), gate });
    s.push(JSON.stringify(game("Game0001")) + "\n" + JSON.stringify(game("Game0002")) + "\n");
    for await (const g of c.streamGames("knightowl88", {})) {
      assert.equal((g as { id: string }).id, "Game0001");
      break;
    }
    assert.equal(gate.snapshot().held, false);
  });

  it("a 429 pauses the gate (60 s, then 120 s) and is rate_limited", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "lichess", clock });
    const c = new LichessClient({ fetch: async () => empty(429), gate, clock });
    const t0 = clock.now();
    await assert.rejects(drain(c.streamGames("knightowl88", {})), kindOf("rate_limited"));
    assert.equal(gate.pauseUntil - t0, 60_000);
    const p = drain(c.streamGames("knightowl88", {}));
    const check = assert.rejects(p, kindOf("rate_limited"));
    await clock.advance(60_000);
    await check;
    assert.equal(gate.pauseUntil - clock.now(), 120_000);
  });

  it("5xx is upstream; a stalled stream times out after 30 s idle", async () => {
    const c5 = new LichessClient({ fetch: async () => empty(503), gate: null });
    await assert.rejects(drain(c5.streamGames("knightowl88", {})), kindOf("upstream"));
    assert.equal(LICHESS_TIMEOUTS.streamIdleMs, 30_000);
    assert.equal(LICHESS_TIMEOUTS.streamTotalMs, 600_000);
    const clock = new FakeClock();
    const s = pushStream();
    const c = new LichessClient({ fetch: async () => ndjson(s.stream), gate: null, clock });
    const p = drain(c.streamGames("knightowl88", {}));
    const check = assert.rejects(p, kindOf("timeout"));
    s.push(JSON.stringify(game("Game0001")) + "\n");
    await clock.advance(30_000);
    await check;
  });

  it("no response headers within 30 s is a timeout; a caller abort is aborted", async () => {
    const clock = new FakeClock();
    const c = new LichessClient({ fetch: async (_, init) => hang(init), gate: null, clock });
    const p = drain(c.streamGames("knightowl88", {}));
    const check = assert.rejects(p, kindOf("timeout"));
    await clock.advance(30_000);
    await check;
    const s = pushStream();
    const ctl = new AbortController();
    const c2 = new LichessClient({ fetch: async () => ndjson(s.stream), gate: null });
    const run = drain(c2.streamGames("knightowl88", {}, { signal: ctl.signal }));
    s.push(JSON.stringify(game("Game0001")) + "\n");
    await flush();
    ctl.abort();
    await assert.rejects(run, kindOf("aborted"));
  });

  it("web confirm: newest five rated games without moves", async () => {
    const rf = recordingFetch(() => ndjson(chunkStream([`${JSON.stringify({ id: "Game0001" })}\n`])));
    const c = new LichessClient({ fetch: rf.fetch, gate: null });
    const out = await c.recentGames("KnightOwl88");
    assert.equal(out.length, 1);
    const u = new URL(rf.calls[0]!.url);
    assert.equal(u.pathname, "/api/games/user/knightowl88");
    assert.equal(u.searchParams.get("max"), "5");
    assert.equal(u.searchParams.get("moves"), "false");
    assert.equal(u.searchParams.get("rated"), "true");
    assert.equal(u.searchParams.get("opening"), "true");
  });

  it("getUser parses the public user and refuses closed accounts", async () => {
    const user = { id: "knightowl88", username: "KnightOwl88", perfs: { blitz: { games: 3, rating: 1500, rd: 80, prog: 0 } } };
    const c = new LichessClient({ fetch: async () => json(user), gate: null });
    assert.equal((await c.getUser("KnightOwl88")).id, "knightowl88");
    const closed = new LichessClient({ fetch: async () => json({ ...user, disabled: true }), gate: null });
    await assert.rejects(closed.getUser("KnightOwl88"), kindOf("closed"));
    const missing = new LichessClient({ fetch: async () => empty(404), gate: null });
    await assert.rejects(missing.getUser("KnightOwl88"), kindOf("not_found"));
  });
});
