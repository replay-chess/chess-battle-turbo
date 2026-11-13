// The import fixtures (phase-04 plan §12.5) against the mappers: every game's `*.expected.json` row matches, every
// stored `moves` string replays legally with chess.js from `startingFen` to the stored FEN and ply count, a game
// stored as CHECKMATE / STALEMATE / THREEFOLD / FIFTY_MOVE / INSUFFICIENT_MATERIAL really ends that way on the board,
// the fixture set covers every case §12.5 lists (incl. the three revision-2 cases), and every provider document
// passes the strict schemas the canary uses. The recorded real month (V-3) is checked when present.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { mapChessComGame, previewOf } from "../chesscom/map";
import { chessComSchemas } from "../chesscom/types";
import { mapLichessGame } from "../lichess/map";
import { ndjsonLines } from "../lichess/ndjson";
import { lichessSchemas } from "../lichess/types";
import { chessComRatings, lichessRatings } from "../ratings";
import type { ImportedGame, MapResult } from "../types";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../chess-fixtures/import");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(FX, rel), "utf8")) as T;

type Expected = {
  externalId: string;
  skip?: string;
  colour?: "w" | "b";
  outcome?: string;
  endMethod?: string;
  plyCount?: number;
  fen?: string;
  timeClass?: string;
  clocksLength?: number;
  startPly?: number;
  endedAt?: string;
  evalHintLength?: number;
  ratingDelta?: number;
  opponentTitle?: string;
  case?: string;
};

/** Replays the stored UCI with chess.js (independently of the mapper) and checks the board-provable endings. */
function assertReplays(g: ImportedGame, label: string): Chess {
  const c = new Chess(g.startingFen);
  const uci = g.moves ? g.moves.split(" ") : [];
  uci.forEach((u, i) => {
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      assert.fail(`${label}: illegal move ${u} at ply ${i + 1}`);
    }
  });
  assert.equal(uci.length, g.plyCount, `${label}: plyCount`);
  assert.equal(c.fen(), g.fen, `${label}: final FEN`);
  const board: Record<string, () => boolean> = {
    CHECKMATE: () => c.isCheckmate(),
    STALEMATE: () => c.isStalemate(),
    THREEFOLD: () => c.isThreefoldRepetition(),
    FIFTY_MOVE: () => c.isDrawByFiftyMoves(),
    INSUFFICIENT_MATERIAL: () => c.isInsufficientMaterial(),
  };
  const check = board[g.endMethod];
  if (check) assert.ok(check(), `${label}: a ${g.endMethod} game ends that way on the board`);
  if (g.moveClocksMs.length) assert.equal(g.moveClocksMs.length, g.plyCount, `${label}: one clock per ply`);
  return c;
}

function assertExpected(r: MapResult, e: Expected, label: string): ImportedGame | null {
  if (e.skip) {
    assert.equal(r.ok, false, `${label}: expected skip ${e.skip}`);
    assert.equal(!r.ok && r.reason, e.skip, label);
    return null;
  }
  if (!r.ok) assert.fail(`${label}: skipped (${r.reason}: ${r.detail})`);
  const g = r.game;
  assert.equal(g.externalId, e.externalId, label);
  assert.equal(g.color, e.colour, `${label}: colour`);
  assert.equal(g.outcome, e.outcome, `${label}: outcome`);
  assert.equal(g.endMethod, e.endMethod, `${label}: endMethod`);
  assert.equal(g.plyCount, e.plyCount, `${label}: plyCount`);
  assert.equal(g.fen, e.fen, `${label}: fen`);
  assert.equal(g.timeClass, e.timeClass, `${label}: timeClass`);
  assert.equal(g.moveClocksMs.length, e.clocksLength, `${label}: clocks length`);
  assert.equal(g.startPly, e.startPly, `${label}: startPly`);
  assert.equal(g.endedAt.toISOString(), e.endedAt, `${label}: endedAt`);
  if (e.evalHintLength !== undefined) assert.equal(g.evalHint?.cp.length ?? 0, e.evalHintLength, `${label}: evalHint`);
  if (e.ratingDelta !== undefined) assert.equal(g.ratingDelta, e.ratingDelta, `${label}: ratingDelta`);
  if (e.opponentTitle) assert.equal(g.color === "w" ? g.blackTitle : g.whiteTitle, e.opponentTitle, `${label}: title`);
  assertReplays(g, label);
  return g;
}

const localDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

describe("Chess.com fixture account knightowl_88", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const mapped: { g: ImportedGame; e: Expected }[] = [];
  const skipped: string[] = [];

  for (const m of months) {
    it(`${m}: every game matches its expected row and replays legally`, () => {
      const src = readJson<{ games: unknown[] }>(`chesscom/knightowl_88/${m}.json`);
      const exp = readJson<{ games: Expected[] }>(`chesscom/knightowl_88/${m}.expected.json`);
      assert.equal(src.games.length, exp.games.length);
      src.games.forEach((raw, i) => {
        const e = exp.games[i]!;
        const strict = chessComSchemas("strict").game.safeParse(raw);
        assert.ok(strict.success, `${m} #${i}: strict schema`);
        const g = assertExpected(mapChessComGame(raw, { usernameLower: "knightowl_88" }), e, `${m} #${i} (${e.case ?? e.externalId})`);
        if (g) mapped.push({ g, e });
        else skipped.push(e.skip!);
      });
      const ends = src.games.map((g) => (g as { end_time: number }).end_time);
      assert.deepEqual(ends, [...ends].sort((a, b) => a - b), "archive order is by end time");
    });
  }

  it("covers every case §12.5 lists (48 games)", () => {
    assert.equal(mapped.length + skipped.length, 48);
    const methods = new Set(mapped.map((x) => x.g.endMethod));
    for (const m of [
      "CHECKMATE",
      "RESIGNATION",
      "TIMEOUT",
      "AGREEMENT",
      "THREEFOLD",
      "STALEMATE",
      "INSUFFICIENT_MATERIAL",
      "FIFTY_MOVE",
      "TIMEOUT_VS_INSUFFICIENT",
      "ABANDONED",
    ])
      assert.ok(methods.has(m as ImportedGame["endMethod"]), `has ${m}`);
    assert.deepEqual([...skipped].sort(), ["parse_error", "unrated", "variant"]);
    assert.ok(mapped.some((x) => x.g.timeClass === "DAILY"), "a daily game");
    assert.ok(mapped.some((x) => x.g.startPly % 2 === 1 && x.g.startingFen.split(" ")[1] === "b"), "custom setup, Black to move");
    const allUci = mapped.flatMap((x) => x.g.moves.split(" ").map((u) => ({ u, x })));
    assert.ok(allUci.some(({ u }) => /^[a-h][27][a-h][18][nbr]$/.test(u)), "an under-promotion");
    const flags = { ep: false, oo: false, ooo: false };
    for (const { g } of mapped) {
      const c = new Chess(g.startingFen);
      for (const u of g.moves.split(" ")) {
        const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        flags.ep ||= mv.isEnPassant();
        flags.oo ||= mv.isKingsideCastle();
        flags.ooo ||= mv.isQueensideCastle();
      }
    }
    assert.deepEqual(flags, { ep: true, oo: true, ooo: true }, "en passant and both castlings");
    assert.ok(mapped.some((x) => x.g.color === "w") && mapped.some((x) => x.g.color === "b"), "both colours");
  });

  it("a daily game ending 23:30 UTC is on the next local day in Asia/Kolkata, the same day in New York", () => {
    const daily = mapped.find((x) => x.g.timeClass === "DAILY" && x.g.endedAt.toISOString().endsWith("T23:30:00.000Z"));
    assert.ok(daily, "the 23:30 UTC daily game");
    const utcDay = daily.g.endedAt.toISOString().slice(0, 10);
    const next = new Date(Date.parse(`${utcDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    assert.equal(localDate(daily.g.endedAt, "Asia/Kolkata"), next);
    assert.equal(localDate(daily.g.endedAt, "America/New_York"), utcDay);
  });

  it("profile, stats and archives pass the strict schemas and match V3OnbPreview", () => {
    const profile = chessComSchemas("strict").profile.parse(readJson("chesscom/knightowl_88/profile.json"));
    const stats = chessComSchemas("strict").stats.parse(readJson("chesscom/knightowl_88/stats.json"));
    const archives = chessComSchemas("strict").archives.parse(readJson("chesscom/knightowl_88/archives.json"));
    const p = previewOf(profile, stats);
    assert.deepEqual(p.ratings, { rapid: 1184, blitz: 1032, bullet: 871, daily: null });
    const r = chessComRatings(stats);
    assert.ok(r.rapid!.games > r.blitz!.games && r.rapid!.games > r.bullet!.games, "rapid has the most games");
    assert.equal(archives.archives.length, 3);
  });
});

describe("Lichess fixture account knightowl88", () => {
  it("streams games.ndjson in uneven chunks: 30 games, one malformed line counted, every row matches", async () => {
    const bytes = readFileSync(path.join(FX, "lichess/knightowl88/games.ndjson"));
    let off = 0;
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (off >= bytes.length) return ctl.close();
        const size = 1 + ((n++ * 7919) % 4096);
        ctl.enqueue(new Uint8Array(bytes.subarray(off, off + size)));
        off += size;
      },
    });
    const exp = readJson<{ games: Expected[]; invalidLines: number }>("lichess/knightowl88/games.expected.json");
    const stats = { lines: 0, invalid: 0 };
    const rows: unknown[] = [];
    for await (const v of ndjsonLines(stream, { stats })) rows.push(v);
    assert.equal(stats.invalid, exp.invalidLines);
    assert.equal(rows.length, 30);
    assert.equal(exp.games.length, 30);
    const games: ImportedGame[] = [];
    rows.forEach((raw, i) => {
      const e = exp.games[i]!;
      assert.ok(lichessSchemas("strict").game.safeParse(raw).success, `line ${i}: strict schema`);
      const g = assertExpected(mapLichessGame(raw, { userId: "knightowl88" }), e, `lichess #${i} (${e.case ?? e.externalId})`);
      if (g) games.push(g);
    });
    // Coverage (§12.5): analysis with mate scores, clocks, a BOT opponent, fromPosition, correspondence, aborted.
    assert.ok(games.some((g) => g.evalHint?.cp.some((v) => Math.abs(v) >= 29_000)), "a mate score in an eval hint");
    assert.ok(games.some((g) => g.moveClocksMs.length > 0), "clocks");
    assert.ok(games.some((g) => g.whiteTitle === "BOT" || g.blackTitle === "BOT"), "a BOT opponent");
    assert.ok(games.some((g) => g.startPly % 2 === 1 && g.startingFen.split(" ")[1] === "b"), "fromPosition, Black to move");
    assert.ok(games.some((g) => g.timeClass === "DAILY"), "correspondence");
    assert.ok(exp.games.some((e) => e.skip === "aborted"), "an aborted game");
    const created = games.map((g) => g.endedAt.getTime());
    assert.deepEqual(created, [...created].sort((a, b) => b - a), "newest first");
  });

  it("account.json passes the strict schema and folds into rating buckets", () => {
    const acct = lichessSchemas("strict").account.parse(readJson("lichess/knightowl88/account.json"));
    assert.equal(acct.id, "knightowl88");
    const r = lichessRatings(acct.perfs);
    assert.deepEqual(Object.keys(r).sort(), ["blitz", "bullet", "classical", "daily", "rapid"]);
    assert.equal(r.bullet!.games, 46);
  });
});

describe("recorded Chess.com month (V-3)", () => {
  const dir = path.join(FX, "chesscom/recorded");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)) : [];

  it("exists (recorded by scripts/record-fixture.ts)", () => {
    assert.ok(files.length >= 1, "a recorded month");
  });

  for (const f of files) {
    it(`${f}: strict schema, %clk on every ply of every game, anonymised, mapper totals match the meta file`, () => {
      const month = readJson<{ games: unknown[] }>(`chesscom/recorded/${f}`);
      const meta = readJson<{ member: string; totals: Record<string, number>; clkGames: number }>(
        `chesscom/recorded/${f.replace(".json", ".meta.json")}`,
      );
      const totals: Record<string, number> = {};
      let clkGames = 0;
      for (const raw of month.games) {
        assert.ok(chessComSchemas("strict").game.safeParse(raw).success, "strict schema");
        const g = raw as { pgn: string; white: { username: string }; black: { username: string }; url: string };
        assert.ok(
          [g.white.username, g.black.username].every((u) => u === meta.member || /^opponent_\d{2}$/.test(u)),
          "usernames anonymised",
        );
        const plies = (g.pgn.split("\n\n")[1] ?? "").match(/\{\[%clk [^\]]+\]\}/g)?.length ?? 0;
        if (plies > 0) clkGames += 1;
        const r = mapChessComGame(raw, { usernameLower: meta.member });
        const key = r.ok ? "imported" : r.reason;
        totals[key] = (totals[key] ?? 0) + 1;
        if (r.ok) {
          assert.equal(r.game.moveClocksMs.length, r.game.plyCount, "V-3: %clk on every ply");
          assertReplays(r.game, `recorded ${r.game.externalId}`);
        }
      }
      assert.deepEqual(totals, meta.totals);
      assert.equal(clkGames, meta.clkGames);
      assert.equal(clkGames, month.games.length, "every recorded game carries %clk");
    });
  }
});

describe("design/onboarding.json (§12.5, testing X13)", () => {
  type Line = { startFen: string; san: string[] };
  const fx = JSON.parse(
    readFileSync(path.resolve(FX, "../design/onboarding.json"), "utf8"),
  ) as { lines: Record<string, Line> };

  it("KT is Kasparov–Topalov before 24.Rxd4, the FEN on the Welcome / Activating / Done boards", () => {
    const kt = fx.lines.KT!;
    assert.equal(kt.startFen, "b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24");
    assert.equal(kt.san[0], "Rxd4");
    const c = new Chess(kt.startFen);
    for (const s of kt.san) c.move(s);
    assert.equal(kt.san.at(-1), "Qa7");
  });

  it("one sample puzzle per rating band except new_to_chess; the Lichess mates end in mate, every solution replays", () => {
    const bands = ["UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"];
    assert.deepEqual(
      Object.keys(fx.lines)
        .filter((k) => k.startsWith("PUZZLE_"))
        .sort(),
      bands.map((b) => `PUZZLE_${b}`).sort(),
    );
    assert.equal(fx.lines.PUZZLE_R800_1200!.startFen, "r3k2r/1p3p2/1np2pb1/p2p3p/3P1b1P/2NBP1P1/PP1K1P2/R6R w kq - 0 16");
    // FIX-1: Lichess CC0 puzzles (91Hz0 mateIn1, E5uss mateIn3, OeeyB and 78xH8 win material); the solver moves first.
    for (const b of ["UNDER_800", "R1200_1600", "R1600_2000", "R2000_PLUS"]) {
      const l = fx.lines[`PUZZLE_${b}`]!;
      const c = new Chess(l.startFen);
      assert.ok(l.san.length > 0, `${b} has its solution`);
      for (const s of l.san) c.move(s);
      if (b === "UNDER_800" || b === "R1200_1600") assert.ok(c.isCheckmate(), `${b} ends in mate`);
    }
  });
});
