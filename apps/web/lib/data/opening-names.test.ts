// Regression (staging, phase-6 fix-5 item C): an imported game's opening name is shown as a proper name everywhere it
// is read — the archive row (gameRowOf), the review header (buildReviewDTO) and Home's Continue card (continueOf) —
// for names stored by the fixed mapper and for names stored before the fix (the raw Chess.com slug with its move tail,
// "…Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2", or the older "O-O-O O" decode). Games are the import fixtures
// (the same games the e2e upstream mock serves) mapped by the real mappers.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { mapChessComGame, openingNameFromEcoUrl } from "@repo/chess-import/chesscom/map";
import { mapLichessGame } from "@repo/chess-import/lichess/map";
import type { ImportedGame } from "@repo/chess-import/types";
import { continueOf } from "@/lib/home/home.server";
import { gameRowOf } from "@/lib/services/analysis/archive";
import type { ArchiveRow } from "@/lib/services/analysis/archive-sql";
import { buildReviewDTO } from "@/lib/services/analysis/review-dto";
import type { ReviewRow } from "@/lib/services/analysis/review-sql";

const require = createRequire(import.meta.url);
const FX = path.dirname(require.resolve("@repo/chess-fixtures/import/chesscom/knightowl_88/profile.json"));
const IMPORT = path.resolve(FX, "../..");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const NOW = Date.parse("2026-11-19T12:00:00Z");
const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function assertClean(name: string | null | undefined, label: string): void {
  if (name == null) return;
  assert.doesNotMatch(name, /\b\d+\.(\.\.)?/, `${label}: move number in ${JSON.stringify(name)}`);
  assert.ok(!name.includes("..."), `${label}: "..." in ${JSON.stringify(name)}`);
  assert.ok(!name.includes("O-O"), `${label}: castling in ${JSON.stringify(name)}`);
  assert.ok(name.trim().length > 0, `${label}: empty`);
}

type Stored = { label: string; source: "CHESSCOM" | "LICHESS"; ecoCode: string | null; openingName: string | null; moves: string; startingFen: string };

/** Every importable fixture game as the fixed mapper stores it, and (Chess.com) as the pre-fix mapper stored it. */
function storedGames(): Stored[] {
  const out: Stored[] = [];
  const add = (label: string, raw: unknown, g: ImportedGame) => {
    const base = { source: g.source, ecoCode: g.ecoCode, moves: g.moves, startingFen: g.startingFen };
    out.push({ label, ...base, openingName: g.openingName });
    if (g.source !== "CHESSCOM") return;
    const r = raw as { eco?: string; pgn: string };
    const old = openingNameFromEcoUrl(/\[ECOUrl "([^"]*)"\]/.exec(r.pgn)?.[1] ?? r.eco);
    const eco = /\[ECO "([A-E]\d\d)"\]/.exec(r.pgn)?.[1] ?? null;
    out.push({ label: `${label} (pre-fix)`, ...base, ecoCode: eco, openingName: old });
    if (old?.includes("O-O O-O")) out.push({ label: `${label} (pre-fix O-O-O O)`, ...base, ecoCode: eco, openingName: old.replace("O-O O-O", "O-O-O O") });
  };
  const months: [string, string][] = ["2026-08", "2026-09", "2026-10"].map((m) => [path.join(FX, `${m}.json`), "knightowl_88"]);
  const rec = path.join(IMPORT, "chesscom/recorded");
  for (const f of readdirSync(rec).filter((x) => /^\d{4}-\d{2}\.json$/.test(x))) {
    months.push([path.join(rec, f), readJson<{ member: string }>(path.join(rec, f.replace(".json", ".meta.json"))).member]);
  }
  for (const [file, member] of months) {
    readJson<{ games: unknown[] }>(file).games.forEach((raw, i) => {
      const r = mapChessComGame(raw, { usernameLower: member });
      if (r.ok) add(`${path.basename(file)} #${i}`, raw, r.game);
    });
  }
  readFileSync(path.join(IMPORT, "lichess/knightowl88/games.ndjson"), "utf8")
    .split("\n")
    .forEach((line, i) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      const r = mapLichessGame(raw, { userId: "knightowl88" });
      if (r.ok) add(`lichess #${i}`, raw, r.game);
    });
  return out;
}

function archiveRow(s: Stored): ArchiveRow {
  return {
    gameId: 1n,
    ref: "cgame000000000000000000001",
    color: "w",
    result: "WIN",
    timeClass: "RAPID",
    mode: "IMPORTED",
    endedAt: new Date(NOW - 3_600_000),
    opponentName: "opponent_01",
    opponentRating: 1200,
    opponentUserId: null,
    ratingDelta: null,
    accuracy: null,
    headline: null,
    momentsCount: 0,
    ecoCode: s.ecoCode,
    source: s.source,
    analysisStatus: "QUEUED",
    fen: INITIAL,
    openingName: s.openingName,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    positionTitle: null,
    hasComparison: false,
    openingMoves: s.moves,
    startingFen: s.startingFen,
  } as ArchiveRow;
}

let refs = 0;
function reviewRow(s: Stored): ReviewRow {
  const plies = s.moves.split(" ").length;
  return {
    gameId: 10n,
    // a fresh ref per row: replayedGame memoises the replay by ref and move-text length
    ref: `cop${String(++refs).padStart(22, "0")}`,
    analysisStatus: "QUEUED",
    chessPositionId: null,
    memberId: 1n,
    color: "w",
    isPlayer: true,
    version: 1,
    gradedPlies: 0,
    totalPlies: plies,
    failedAtPly: null,
    analysisUpdatedAt: null,
    reviewUpdatedAt: null,
    jobStatus: "QUEUED",
    attempts: 0,
    maxAttempts: 4,
    runAt: new Date(NOW - 1_000),
    heartbeatAt: null,
    lastKickAt: null,
    lastError: null,
    shareCode: null,
    shareShowUsername: null,
    shareExpiresAt: null,
    comparisonStatus: null,
    comparisonUpdatedAt: null,
    mode: "IMPORTED",
    source: s.source,
    startingFen: s.startingFen,
    startPly: 0,
    moves: s.moves,
    moveClocksMs: [],
    plyCount: plies,
    gameStatus: "COMPLETED",
    outcome: "WHITE",
    endMethod: "RESIGNATION",
    completedAt: new Date(NOW - 3_600_000),
    playedAt: new Date(NOW - 3_600_000),
    timeClass: "RAPID",
    ecoCode: s.ecoCode,
    openingName: s.openingName,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    botElo: null,
    metaPosition: null,
    youName: "knightowl_88",
    ratingBefore: 1184,
    opponentUserId: null,
    opponentName: "opponent_01",
    opponentRating: 1200,
    myAccuracy: null,
    myPhaseAccuracy: null,
    momentsCount: 0,
    oppAccuracy: null,
    oppPhaseAccuracy: null,
    positionRef: null,
    legendMoveNumber: null,
    legendMeta: null,
    whitePlayerName: null,
    blackPlayerName: null,
    whiteLegendName: null,
    blackLegendName: null,
    tournamentName: null,
    eventDate: null,
    legendHasPgn: null,
    queueAhead: 0,
    engine: null,
    evals: null,
    best: null,
    judgements: null,
    middlegamePly: null,
    endgamePly: null,
    accuracyWhite: null,
    accuracyBlack: null,
    countsWhite: null,
    countsBlack: null,
    depthP50: null,
    content: null,
    textStatus: null,
    progress: null,
    reviewStartedAt: null,
    reviewCompletedAt: null,
    legendName: null,
  } as unknown as ReviewRow;
}

type ContinueRow = Parameters<typeof continueOf>[0][number];

function continueRow(s: Stored): ContinueRow {
  return {
    ref: "cgame000000000000000000001",
    color: "w",
    result: "WIN",
    endedAt: new Date(NOW - 3_600_000),
    opponentName: "opponent_01",
    opponentRating: null,
    momentsCount: 0,
    accuracy: null,
    analysisStatus: "QUEUED",
    plyCount: s.moves.split(" ").length,
    openingName: s.openingName,
    startingFen: s.startingFen,
    startPly: 0,
    moves: s.moves,
    gradedPlies: null,
    totalPlies: null,
    kPly: null,
  } as ContinueRow;
}

/** The three displayed names of one stored game. */
function shown(s: Stored): { archive: string | null; review: string | null; home: string | null } {
  return {
    archive: gameRowOf(archiveRow(s), NOW).opening?.name ?? null,
    review: buildReviewDTO(reviewRow(s), { nowMs: NOW, siteOrigin: "https://dev.example.test" }).game.opening?.name ?? null,
    home: continueOf([continueRow(s)], new Date(NOW), "UTC")?.openingName ?? null,
  };
}

/** SAN from the start → the stored UCI string. */
const uci = (sans: string[]): string => {
  const c = new Chess();
  return sans.map((san) => {
    const m = c.move(san);
    return `${m.from}${m.to}${m.promotion ?? ""}`;
  }).join(" ");
};

describe("displayed opening names of imported games (regression: move tails from the Chess.com slug)", () => {
  const games = storedGames();

  it("covers the fixture games, stored by the fixed mapper and by the pre-fix one", () => {
    assert.ok(games.length >= 100, `${games.length} stored names`);
    assert.ok(games.some((g) => g.label.includes("(pre-fix)") && /\d+\./.test(g.openingName ?? "")), "pre-fix names with move tails");
  });

  it("archive row, review header and Continue card show no move number, no \"...\", no castling", () => {
    for (const g of games) {
      const s = shown(g);
      assertClean(s.archive, `archive ${g.label}`);
      assertClean(s.review, `review ${g.label}`);
      assertClean(s.home, `home ${g.label}`);
      if (g.openingName && g.ecoCode) assert.equal(s.archive, s.review, `${g.label}: archive and review agree`);
      if (g.openingName && s.archive) assert.equal(s.home, s.archive, `${g.label}: Home and archive agree`);
    }
  });

  it("the staging Przepiorka game (pre-fix name, and the older \"O-O-O O\" decode) reads as the book's name", () => {
    const moves = uci(["d4", "Nf6", "Nf3", "g6", "g3", "Bg7", "Bg2", "d6", "O-O", "O-O", "c3", "c6", "Nbd2", "Nbd7"]);
    for (const openingName of [
      "Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2",
      "Indian Game East Indian Przepiorka Variation...5.O-O-O O 6.c3",
    ]) {
      const s = shown({ label: "przepiorka", source: "CHESSCOM", ecoCode: "A49", openingName, moves, startingFen: INITIAL });
      assert.deepEqual(s, {
        archive: "Indian Defense: Przepiorka Variation",
        review: "Indian Defense: Przepiorka Variation",
        home: "Indian Defense: Przepiorka Variation",
      });
    }
  });

  it("the staging Queen's Indian Spassky game reads as the book's name with its apostrophe", () => {
    const moves = uci(["d4", "Nf6", "c4", "e6", "Nf3", "b6", "e3", "Bb7", "Bd3", "Bb4+", "Bd2", "Bxd2+"]);
    const s = shown({ label: "spassky", source: "CHESSCOM", ecoCode: "E14", openingName: "Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4", moves, startingFen: INITIAL });
    assert.deepEqual(s, {
      archive: "Queen's Indian Defense: Spassky System",
      review: "Queen's Indian Defense: Spassky System",
      home: "Queen's Indian Defense: Spassky System",
    });
  });

  it("a game the book cannot name keeps the provider's name without its tail; native book names are kept as stored", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    const odd = shown({ label: "odd start", source: "CHESSCOM", ecoCode: "E14", openingName: "Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4", moves: "e2e4 e8d7", startingFen: fen });
    assert.deepEqual(odd, { archive: "Queens Indian Defense Spassky System", review: "Queens Indian Defense Spassky System", home: "Queens Indian Defense Spassky System" });
    // a stored book name stands even where the book's line for the moves is longer (the worker names by position)
    const native = shown({ label: "native", source: "LICHESS", ecoCode: "C50", openingName: "Italian Game", moves: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6", startingFen: INITIAL });
    assert.deepEqual(native, { archive: "Italian Game", review: "Italian Game", home: "Italian Game" });
  });
});
