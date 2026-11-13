// The reading phase against the in-process upstream (phase-04 plan §8.6, §8.7, D4-28) and the process gates
// (providers/gate.ts): month plans, conditional requests, the early chunk, the window and cap, partial reads before a
// provider error, the Lichess query modes and resume accounting, and "never two concurrent requests to one provider".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImportedGame } from "@repo/chess-import/types";
import { createProviders } from "../../providers";
import { FakeClock } from "../../scheduler/clock";
import type { ImportAccount, ImportCursor } from "../context";
import { lichessQuery, readChessCom, readLichess, skippedBefore, type ReadInput } from "../reading";
import { defaultImportSettings } from "../settings";
import { CHESSCOM_BASE, FakeUpstream, LICHESS_BASE } from "./upstream";

const NOW = Date.UTC(2026, 10, 12, 9, 30, 0);

function setup(tag = "4242") {
  const clock = new FakeClock(NOW);
  const upstream = new FakeUpstream(tag);
  const providers = createProviders({
    settings: defaultImportSettings({ chesscomBaseUrl: CHESSCOM_BASE, lichessBaseUrl: LICHESS_BASE }),
    clock,
    fetch: upstream.fetch,
  });
  return { clock, upstream, providers };
}

const account = (usernameLower: string, provider: "CHESSCOM" | "LICHESS" = "CHESSCOM"): ImportAccount => ({
  id: "1",
  userId: "1",
  provider,
  externalId: usernameLower,
  username: usernameLower,
  usernameLower,
  title: null,
  status: "ACTIVE",
  importState: "QUEUED",
  autoImport: true,
  importedCount: 0,
  skippedCount: 0,
  lastSyncOkAtMs: null,
});

const input = (o: Partial<ReadInput> = {}): ReadInput => ({
  account: account("knightowl_88"),
  cursor: null,
  initial: true,
  nowMs: NOW,
  windowMonths: 12,
  maxGames: 2000,
  alreadyImported: 0,
  ...o,
});

function hooks() {
  const early: ImportedGame[][] = [];
  const progress: number[] = [];
  return {
    early,
    progress,
    h: {
      signal: new AbortController().signal,
      early: async (g: ImportedGame[]) => void early.push(g),
      progress: async (seen: number) => void progress.push(seen),
    },
  };
}

const newestFirst = (games: readonly ImportedGame[]) =>
  games.every((g, i) => i === 0 || games[i - 1]!.endedAt.getTime() >= g.endedAt.getTime());

describe("Chess.com reading (§8.6)", () => {
  it("initial: every month of the window newest first, the early chunk after the newest month, months done", async () => {
    const { upstream, providers } = setup();
    upstream.addChessComFixture();
    const { early, progress, h } = hooks();
    const r = await readChessCom(providers.chesscom, input(), h);
    assert.equal(r.error, null);
    assert.equal(r.candidates.length, 45);
    assert.ok(newestFirst(r.candidates));
    assert.equal(r.skipped, 3);
    assert.deepEqual(r.skippedByReason, { variant: 1, unrated: 1, parse_error: 1 });
    assert.equal(r.variants, 1);
    assert.equal(r.seen, 48);
    assert.equal(early.length, 1);
    assert.deepEqual(early[0], r.candidates.slice(0, early[0]!.length), "the early chunk is the newest games");
    assert.ok(early[0]!.every((g) => g.endedAt.getUTCMonth() === 9), "all from the newest month (2026/10)");
    assert.deepEqual(progress.length, 3, "a progress call per month");
    assert.deepEqual(
      upstream.to("chesscom").map((q) => q.path.replace("/pub/player/knightowl_88", "")),
      ["", "/games/archives", "/games/2026/10", "/games/2026/09", "/games/2026/08"],
    );
    assert.ok(Object.values(r.chesscom!.archives!.months).every((m) => m.done));
    assert.ok(r.chesscom!.archivesEtag);
    assert.equal(r.chesscom!.profile!.playerId !== null, true);
  });

  it("incremental with stored validators: 304s cost nothing and read no game", async () => {
    const { upstream, providers } = setup();
    upstream.addChessComFixture();
    const first = await readChessCom(providers.chesscom, input(), hooks().h);
    const cursor: ImportCursor = {
      archivesEtag: first.chesscom!.archivesEtag,
      archivesLastModified: null,
      archives: { v: 1, months: Object.fromEntries(Object.entries(first.chesscom!.archives!.months).map(([k, m]) => [k, { ...m, done: false }])) },
      lichessSinceMs: null,
      lichessResumeUntilMs: null,
      seen: 48,
      skippedVariants: 1,
    };
    const n0 = upstream.requests.length;
    const r = await readChessCom(providers.chesscom, input({ initial: false, cursor }), hooks().h);
    assert.equal(r.candidates.length, 0);
    const again = upstream.requests.slice(n0);
    assert.ok(again.filter((q) => /games\/\d{4}/.test(q.path)).every((q) => q.headers["if-none-match"]), "conditional month requests");
  });

  it("a closed or missing profile stops at once; a month failure returns what was read with the error", async () => {
    const { upstream, providers } = setup();
    upstream.addChessComFixture();
    const missing = await readChessCom(providers.chesscom, input({ account: account("nobody_here") }), hooks().h);
    assert.equal(missing.error?.kind, "not_found");
    assert.equal(missing.candidates.length, 0);
    upstream.faults.push({ provider: "chesscom", match: /2026\/09$/, status: 503 });
    const { early, h } = hooks();
    const partial = await readChessCom(providers.chesscom, input(), h);
    assert.equal(partial.error?.kind, "upstream");
    assert.equal(partial.earlyDone, true);
    assert.equal(partial.candidates.length, early[0]!.length, "the newest month only");
    assert.equal(partial.chesscom!.archives, null, "no month is marked read after a failure");
  });

  it("IMPORT_MAX_GAMES caps the newest games and stops fetching months", async () => {
    const { upstream, providers } = setup();
    upstream.addChessComFixture();
    const r = await readChessCom(providers.chesscom, input({ maxGames: 10 }), hooks().h);
    assert.equal(r.candidates.length, 10);
    assert.equal(upstream.to("chesscom", /games\/\d{4}/).length, 1);
  });

  it("drops games older than the window start", async () => {
    const { upstream, providers } = setup();
    upstream.addChessComFixture();
    const r = await readChessCom(providers.chesscom, input({ nowMs: Date.UTC(2027, 8, 15) }), hooks().h);
    assert.ok(r.candidates.every((g) => g.endedAt.getTime() >= Date.UTC(2026, 8, 1)), "window start 2026-09-01");
    assert.ok(r.candidates.length < 45 && r.candidates.length > 0);
  });
});

describe("Lichess reading (§8.7)", () => {
  it("one anonymous stream, newest first; malformed and aborted lines are skipped; the newest creation time", async () => {
    const { upstream, providers } = setup();
    const acc = upstream.addLichessFixture();
    const r = await readLichess(providers.lichess, input({ account: account("knightowl88", "LICHESS") }), hooks().h);
    assert.equal(r.error, null);
    assert.equal(r.candidates.length, 29);
    assert.equal(r.skippedByReason.parse_error, 1, "the malformed line");
    assert.equal(r.skippedByReason.aborted, 1);
    const firstValid = acc.lines.find((l) => typeof l !== "string") as { createdAt: number };
    assert.equal(r.lichess!.newestCreatedMs, firstValid.createdAt);
    const q = upstream.to("lichess")[0]!;
    assert.equal(q.headers.authorization, undefined);
    assert.equal(q.query.get("since"), String(Date.UTC(2025, 10, 1)));
    assert.equal(q.query.get("max"), "2000");
    assert.equal(q.query.get("pgnInJson"), "false");
  });

  it("the query modes: initial, incremental (since + 1, max 1000), resume (until = resume − 1, the original since)", () => {
    const cursor = (o: Partial<ImportCursor>): ImportCursor => ({
      archivesEtag: null,
      archivesLastModified: null,
      archives: { v: 1, months: {} },
      lichessSinceMs: null,
      lichessResumeUntilMs: null,
      seen: 0,
      skippedVariants: 0,
      ...o,
    });
    const ws = Date.UTC(2025, 10, 1);
    assert.deepEqual(lichessQuery(input()), { since: ws, max: 2000, resumed: false });
    assert.deepEqual(lichessQuery(input({ initial: false, cursor: cursor({ lichessSinceMs: NOW - 5_000 }) })), {
      since: NOW - 4_999,
      max: 1000,
      resumed: false,
    });
    assert.deepEqual(lichessQuery(input({ cursor: cursor({ lichessResumeUntilMs: NOW - 9_000 }), alreadyImported: 140 })), {
      since: ws,
      until: NOW - 9_001,
      max: 1860,
      resumed: true,
    });
  });

  const sinceCursor = (lichessSinceMs: number): ImportCursor => ({
    archivesEtag: null,
    archivesLastModified: null,
    archives: { v: 1, months: {} },
    lichessSinceMs,
    lichessResumeUntilMs: null,
    seen: 0,
    skippedVariants: 0,
  });

  it("regression: lichess-incremental-1000-gap (FIX-1): a full 1000-game stream pages on with until, nothing older is lost", async () => {
    const { upstream, providers } = setup();
    // 1100 new games, one a minute, all newer than the cursor S.
    const S = NOW - 2 * 86_400_000;
    upstream.addLichessMany("knightowl88", 1100, NOW - 60_000, 60_000);
    const r = await readLichess(
      providers.lichess,
      input({ account: account("knightowl88", "LICHESS"), initial: false, cursor: sinceCursor(S) }),
      hooks().h,
    );
    assert.equal(r.error, null);
    assert.equal(r.candidates.length, 1100, "all 1100, not the newest 1000");
    const reqs = upstream.to("lichess").map((x) => ({ since: x.query.get("since"), until: x.query.get("until"), max: x.query.get("max"), perf: x.query.get("perfType") }));
    assert.equal(reqs.length, 3, "page 1, page 2, the correspondence look-back");
    assert.deepEqual([reqs[0]!.since, reqs[0]!.until, reqs[0]!.max], [String(S + 1), null, "1000"]);
    const oldestOfPage1 = NOW - 60_000 - 999 * 60_000;
    assert.deepEqual([reqs[1]!.since, reqs[1]!.until, reqs[1]!.max], [String(S + 1), String(oldestOfPage1 - 1), "1000"]);
    assert.equal(reqs[2]!.perf, "correspondence");
    assert.equal(r.lichess!.newestCreatedMs, NOW - 60_000, "the cursor still advances to the newest game");
    // Newest first across the pages (the resume point of each saved chunk stays correct).
    const created = r.candidates.map((g) => g.createdAtMs!);
    assert.deepEqual(created, [...created].sort((a, b) => b - a));
  });

  it("an incremental read stops at IMPORT_MAX_GAMES for the run (the newest N, as an initial import)", async () => {
    const { upstream, providers } = setup();
    upstream.addLichessMany("knightowl88", 2600, NOW - 60_000, 60_000);
    const r = await readLichess(
      providers.lichess,
      input({ account: account("knightowl88", "LICHESS"), initial: false, cursor: sinceCursor(NOW - 5 * 86_400_000) }),
      hooks().h,
    );
    assert.equal(r.candidates.length, 2000);
    assert.deepEqual(upstream.to("lichess").map((x) => x.query.get("max")), ["1000", "1000"], "full: no look-back needed");
  });

  it("regression: lichess-correspondence-running-at-sync (FIX-1): a correspondence game created before the cursor is read once finished", async () => {
    const { upstream, providers } = setup();
    const acc = upstream.addLichessMany("knightowl88", 3, NOW - 2 * 3_600_000, 3_600_000);
    const template = acc.lines[0] as Record<string, unknown>;
    // Created ten days ago, finished today: older than the cursor, so the main stream (since = cursor + 1) misses it.
    const corr = { ...template, id: upstream.lichessId(500), speed: "correspondence", perf: "correspondence", clock: undefined, clocks: undefined, daysPerTurn: 3, createdAt: NOW - 10 * 86_400_000, lastMoveAt: NOW - 60_000 };
    acc.lines = [...acc.lines, corr];
    const r = await readLichess(
      providers.lichess,
      input({ account: account("knightowl88", "LICHESS"), initial: false, cursor: sinceCursor(NOW - 3 * 86_400_000) }),
      hooks().h,
    );
    assert.equal(r.error, null);
    assert.deepEqual(r.candidates.map((g) => g.externalId).at(-1), upstream.lichessId(500), "appended after the main stream");
    assert.equal(r.candidates.length, 4);
    const look = upstream.to("lichess")[1]!;
    assert.equal(look.query.get("perfType"), "correspondence");
    assert.equal(look.query.get("since"), String(Date.UTC(2025, 10, 1)), "the whole import window");
    // An initial read has no look-back (its window read already includes every finished correspondence game).
    const fresh = setup();
    fresh.upstream.addLichessFixture();
    await readLichess(fresh.providers.lichess, input({ account: account("knightowl88", "LICHESS") }), hooks().h);
    assert.equal(fresh.upstream.to("lichess").length, 1);
  });

  it("a cut stream returns what it read; skips before the saved part are counted by position", async () => {
    const { upstream, providers } = setup();
    upstream.addLichessFixture();
    upstream.breakLichessAfter = 12;
    const r = await readLichess(providers.lichess, input({ account: account("knightowl88", "LICHESS") }), hooks().h);
    assert.equal(r.error?.kind, "upstream");
    assert.ok(r.candidates.length > 0 && r.candidates.length < 29);
    // The malformed line comes after the 7th game: once 7+ candidates are saved it is covered.
    assert.equal(skippedBefore(r, 0), 0);
    assert.equal(skippedBefore(r, r.candidates.length), r.skipped);
  });
});

describe("provider gates (§7.7.2: never two concurrent requests to one provider)", () => {
  it("two imports of one provider in parallel queue request by request", async () => {
    const { upstream, providers } = setup();
    upstream.latencyMs = 5;
    upstream.addChessComFixture("knightowl_88");
    upstream.addChessComFixture("knightowl_99");
    const [a, b] = await Promise.all([
      readChessCom(providers.chesscom, input(), hooks().h),
      readChessCom(providers.chesscom, input({ account: account("knightowl_99") }), hooks().h),
    ]);
    assert.equal(a.candidates.length, 45);
    assert.equal(b.candidates.length, 45);
    assert.equal(upstream.maxActive.chesscom, 1, "the upstream never saw two at once");
    assert.equal(providers.gates.chesscom.stats.maxInFlight, 1);
    assert.equal(providers.gates.chesscom.stats.calls, 10);
  });

  it("a 429 pauses every caller of that provider (60 s for Chess.com), the other provider is free", async () => {
    const { clock, upstream, providers } = setup();
    upstream.addChessComFixture();
    upstream.addLichessFixture();
    upstream.faults.push({ provider: "chesscom", match: /archives$/, status: 429 });
    const r = await readChessCom(providers.chesscom, input(), hooks().h);
    assert.equal(r.error?.kind, "rate_limited");
    assert.equal(providers.gates.pauseUntil("chesscom"), clock.now() + 60_000);
    assert.equal(providers.gates.chesscom.stats.pauses, 1);
    const l = await readLichess(providers.lichess, input({ account: account("knightowl88", "LICHESS") }), hooks().h);
    assert.equal(l.candidates.length, 29, "Lichess is not paused by Chess.com's 429");
  });
});
