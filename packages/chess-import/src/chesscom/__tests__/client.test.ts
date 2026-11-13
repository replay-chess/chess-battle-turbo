// ChessComClient (phase-04 plan §7.8, §8.6 steps 1–4, R-CC-02/03/04): URLs with encodeURIComponent and lower-cased
// handles, the injectable base URL, User-Agent, closed accounts, serial profile → stats, archive month keys and
// conditional GETs, schema failures, per-caller timeouts on the fake clock, and one gate shared by many callers.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ProviderError } from "../../errors";
import { ProviderGate } from "../../gate";
import { userAgent } from "../../http";
import { FakeClock } from "../../testing/fake-clock";
import { empty, hang, json, recordingFetch } from "../../__tests__/helpers";
import { CHESSCOM_TIMEOUTS, ChessComClient, compareMonthKeys, monthKeyOfArchiveUrl } from "../client";

const PROFILE = {
  "@id": "https://api.chess.com/pub/player/knightowl_88",
  url: "https://www.chess.com/member/KnightOwl_88",
  username: "knightowl_88",
  player_id: 41_000_001,
  status: "basic",
  name: "Knight Owl",
  followers: 3,
  country: "https://api.chess.com/pub/country/IN",
  joined: 1_600_000_000,
  last_online: 1_794_000_000,
  is_streamer: false,
  verified: false,
  league: "Wood",
  streaming_platforms: [],
};
const STATS = {
  chess_rapid: { last: { rating: 1184, date: 1_794_000_000, rd: 45 }, record: { win: 200, loss: 180, draw: 20 } },
  chess_blitz: { last: { rating: 1032, date: 1_794_000_000, rd: 60 }, record: { win: 30, loss: 25, draw: 5 } },
};
const kindOf = (kind: string) => (e: unknown) => e instanceof ProviderError && e.kind === kind;

describe("ChessComClient", () => {
  it("builds lower-cased, encoded player URLs on the injected base URL with the User-Agent", async () => {
    const rf = recordingFetch(() => json(PROFILE));
    const c = new ChessComClient({ baseUrl: "http://127.0.0.1:4010/chesscom/", fetch: rf.fetch, gate: null });
    await c.getProfile("KnightOwl_88");
    assert.equal(rf.calls[0]!.url, "http://127.0.0.1:4010/chesscom/pub/player/knightowl_88");
    assert.equal(rf.calls[0]!.headers["user-agent"], userAgent());
    const contact = new ChessComClient({ fetch: rf.fetch, gate: null, contact: "ops@playchess.tech" });
    await contact.getProfile("knightowl_88");
    assert.equal(rf.calls[1]!.url, "https://api.chess.com/pub/player/knightowl_88");
    assert.match(rf.calls[1]!.headers["user-agent"]!, /ops@playchess\.tech/);
  });

  it("refuses a handle that is not a Chess.com username without calling out", async () => {
    const rf = recordingFetch(() => json(PROFILE));
    const c = new ChessComClient({ fetch: rf.fetch, gate: null });
    for (const bad of ["a", "../stats", "x y", "name?q=1", "ab%2F", "x".repeat(26)])
      await assert.rejects(c.getProfile(bad), kindOf("not_found"), bad);
    assert.equal(rf.calls.length, 0);
  });

  it("404 → not_found; 410 or a closed status → closed", async () => {
    const c404 = new ChessComClient({ fetch: async () => empty(404), gate: null });
    await assert.rejects(c404.getProfile("nobody_here"), kindOf("not_found"));
    const c410 = new ChessComClient({ fetch: async () => empty(410), gate: null });
    await assert.rejects(c410.getProfile("gone_user"), kindOf("closed"));
    for (const status of ["closed", "closed:fair_play_violations", "closed:abuse"]) {
      const c = new ChessComClient({ fetch: async () => json({ ...PROFILE, status }), gate: null });
      await assert.rejects(c.getProfile("knightowl_88"), kindOf("closed"), status);
    }
  });

  it("fetches profile then stats one after the other, never together (R-CC-02)", async () => {
    const clock = new FakeClock();
    const rf = recordingFetch(
      async (url) => {
        await clock.sleep(300);
        return json(url.endsWith("/stats") ? STATS : PROFILE);
      },
      () => clock.now(),
    );
    const c = new ChessComClient({ fetch: rf.fetch, clock, caller: "web" });
    const p = c.getPreview("KnightOwl_88");
    await clock.advance(1_000);
    const { preview } = await p;
    assert.equal(rf.maxActive, 1);
    assert.deepEqual(
      rf.calls.map((x) => x.url.replace("https://api.chess.com/pub/player/knightowl_88", "")),
      ["", "/stats"],
    );
    assert.ok(rf.calls[1]!.at >= rf.calls[0]!.at + 300);
    assert.equal(preview.ratings.rapid, 1184);
    assert.equal(preview.ratedGames, 460);
  });

  it("skips the stats call when the profile is missing", async () => {
    const rf = recordingFetch(() => empty(404));
    const c = new ChessComClient({ fetch: rf.fetch, gate: null });
    await assert.rejects(c.getPreview("nobody_here"), kindOf("not_found"));
    assert.equal(rf.calls.length, 1);
  });

  it("lists archive months oldest first and stores the validators; 304 reuses them", async () => {
    const rf = recordingFetch((_, __, n) =>
      n === 1
        ? json(
            {
              archives: [
                "https://api.chess.com/pub/player/knightowl_88/games/2026/10",
                "https://api.chess.com/pub/player/knightowl_88/games/2025/12",
                "https://api.chess.com/pub/player/knightowl_88/games/2026/01",
              ],
            },
            200,
            { etag: 'W/"a1"', "last-modified": "Sunday, 01-Nov-2026 13:40:21 GMT+0000" },
          )
        : empty(304, { etag: 'W/"a1"' }),
    );
    const c = new ChessComClient({ fetch: rf.fetch, gate: null });
    const first = await c.getArchives("knightowl_88");
    assert.deepEqual(first, {
      status: 200,
      months: ["2025/12", "2026/01", "2026/10"],
      etag: 'W/"a1"',
      lastModified: "Sunday, 01-Nov-2026 13:40:21 GMT+0000",
    });
    const second = await c.getArchives("knightowl_88", {
      validators: { etag: 'W/"a1"', lastModified: "Sunday, 01-Nov-2026 13:40:21 GMT+0000" },
    });
    assert.equal(second.status, 304);
    assert.equal(rf.calls[1]!.headers["if-none-match"], 'W/"a1"');
    assert.equal(rf.calls[1]!.headers["if-modified-since"], "Sunday, 01-Nov-2026 13:40:21 GMT+0000");
    assert.equal(rf.calls[1]!.url, "https://api.chess.com/pub/player/knightowl_88/games/archives");
  });

  it("reads a month (raw games) and passes 304 through", async () => {
    const rf = recordingFetch((_, __, n) => (n === 1 ? json({ games: [{ a: 1 }, { b: 2 }] }, 200, { etag: "m1" }) : empty(304)));
    const c = new ChessComClient({ fetch: rf.fetch, gate: null });
    const m = await c.getMonth("knightowl_88", "2026/09");
    assert.equal(rf.calls[0]!.url, "https://api.chess.com/pub/player/knightowl_88/games/2026/09");
    assert.deepEqual(m, { status: 200, games: [{ a: 1 }, { b: 2 }], etag: "m1", lastModified: null });
    assert.equal((await c.getMonth("knightowl_88", "2026/09", { validators: { etag: "m1" } })).status, 304);
    await assert.rejects(c.getMonth("knightowl_88", "2026-09" as never), RangeError);
  });

  it("a body that breaks the schema is bad_response", async () => {
    const c = new ChessComClient({ fetch: async () => json({ archives: "nope" }), gate: null });
    await assert.rejects(c.getArchives("knightowl_88"), kindOf("bad_response"));
    const c2 = new ChessComClient({ fetch: async () => json({ archives: ["https://x/not-a-month"] }), gate: null });
    await assert.rejects(c2.getArchives("knightowl_88"), kindOf("bad_response"));
    const c3 = new ChessComClient({ fetch: async () => json({ username: "x" }), gate: null });
    await assert.rejects(c3.getProfile("knightowl_88"), kindOf("bad_response"));
  });

  it("strict mode (the canary) refuses an unknown field that lenient mode strips", async () => {
    const body = { ...PROFILE, brand_new_field: 1 };
    const lenient = new ChessComClient({ fetch: async () => json(body), gate: null });
    assert.equal((await lenient.getProfile("knightowl_88")).username, "knightowl_88");
    const strict = new ChessComClient({ fetch: async () => json(body), gate: null, schemaMode: "strict" });
    await assert.rejects(strict.getProfile("knightowl_88"), kindOf("bad_response"));
  });

  it("times out per caller: web months after 5 s, worker months after 15 s", async () => {
    assert.equal(CHESSCOM_TIMEOUTS.web.month, 5_000);
    assert.equal(CHESSCOM_TIMEOUTS.worker.month, 15_000);
    assert.equal(CHESSCOM_TIMEOUTS.worker.profile, 8_000);
    for (const [caller, ms] of [
      ["web", 5_000],
      ["worker", 15_000],
    ] as const) {
      const clock = new FakeClock();
      const c = new ChessComClient({ fetch: async (_, init) => hang(init), clock, caller });
      const p = c.getMonth("knightowl_88", "2026/10");
      let done = false;
      const check = assert.rejects(p, kindOf("timeout")).then(() => (done = true));
      await clock.advance(ms - 1);
      assert.equal(done, false, `${caller} still waiting at ${ms - 1} ms`);
      await clock.advance(1);
      await check;
    }
  });

  it("a 429 pauses the shared gate, so a second client on the same gate waits 60 s", async () => {
    const clock = new FakeClock();
    const t0 = clock.now();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    const rf = recordingFetch((_, __, n) => (n === 1 ? empty(429) : json(PROFILE)), () => clock.now());
    const worker = new ChessComClient({ fetch: rf.fetch, clock, gate });
    const lookup = new ChessComClient({ fetch: rf.fetch, clock, gate, caller: "web" });
    await assert.rejects(worker.getProfile("knightowl_88"), kindOf("rate_limited"));
    const p = lookup.getProfile("knightowl_88");
    await clock.advance(60_000);
    await p;
    assert.equal(rf.calls[1]!.at - t0, 60_000);
  });

  it("a lookup that cannot get the gate within its cap is refused with rate_limited", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    gate.pause();
    const c = new ChessComClient({ fetch: async () => json(PROFILE), clock, gate });
    await assert.rejects(c.getProfile("knightowl_88", { maxWaitMs: 5_000 }), kindOf("rate_limited"));
  });

  it("month keys parse and sort", () => {
    assert.equal(monthKeyOfArchiveUrl("https://api.chess.com/pub/player/x/games/2026/03"), "2026/03");
    assert.equal(monthKeyOfArchiveUrl("https://api.chess.com/pub/player/x/games/archives"), null);
    assert.ok(compareMonthKeys("2025/12", "2026/01") < 0);
    assert.equal(compareMonthKeys("2026/01", "2026/01"), 0);
  });
});
