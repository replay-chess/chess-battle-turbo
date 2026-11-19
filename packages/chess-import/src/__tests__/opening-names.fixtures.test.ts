// Regression (staging, phase-6 fix-5 item C): imported games' opening names carried the Chess.com ECOUrl slug's move
// tail and lost its punctuation ("Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2",
// "Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4"). Through the real mappers, on every fixture game: the
// stored name has no move-number token, no "...", no castling; the book names the game when it knows the moves
// (with the book's apostrophes), else the provider's name is kept without its tail.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mapChessComGame } from "../chesscom/map";
import { mapLichessGame } from "../lichess/map";
import { encodeChessComGame, type ChessComGameSpec } from "../testing/encode";
import type { ImportedGame, MapResult } from "../types";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../chess-fixtures/import");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(FX, rel), "utf8")) as T;

/** What a displayed opening name must never carry. */
function assertCleanName(name: string | null, label: string): void {
  if (name === null) return;
  assert.doesNotMatch(name, /\b\d+\.(\.\.)?/, `${label}: move number in ${JSON.stringify(name)}`);
  assert.ok(!name.includes("..."), `${label}: "..." in ${JSON.stringify(name)}`);
  assert.ok(!name.includes("O-O"), `${label}: castling in ${JSON.stringify(name)}`);
  assert.equal(name, name.trim(), `${label}: untrimmed`);
  assert.ok(name.length > 0 && name.length <= 80, `${label}: length ${name.length}`);
}

/** Every importable fixture game, mapped by the real mappers. */
function fixtureImports(): { label: string; game: ImportedGame }[] {
  const out: { label: string; game: ImportedGame }[] = [];
  const keep = (label: string, r: MapResult) => {
    if (r.ok) out.push({ label, game: r.game });
  };
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    readJson<{ games: unknown[] }>(`chesscom/knightowl_88/${m}.json`).games.forEach((raw, i) =>
      keep(`chesscom ${m} #${i}`, mapChessComGame(raw, { usernameLower: "knightowl_88" })),
    );
  }
  const rec = path.join(FX, "chesscom/recorded");
  for (const f of existsSync(rec) ? readdirSync(rec).filter((x) => /^\d{4}-\d{2}\.json$/.test(x)) : []) {
    const member = readJson<{ member: string }>(`chesscom/recorded/${f.replace(".json", ".meta.json")}`).member;
    readJson<{ games: unknown[] }>(`chesscom/recorded/${f}`).games.forEach((raw, i) =>
      keep(`recorded ${f} #${i}`, mapChessComGame(raw, { usernameLower: member })),
    );
  }
  readFileSync(path.join(FX, "lichess/knightowl88/games.ndjson"), "utf8")
    .split("\n")
    .forEach((line, i) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      keep(`lichess #${i}`, mapLichessGame(raw, { userId: "knightowl88" }));
    });
  return out;
}

const ME = "KnightOwl_88";
const spec = (over: Partial<ChessComGameSpec>): ChessComGameSpec => ({
  id: 987654321,
  sans: ["e4", "e5"],
  white: { username: ME, rating: 1184, result: "win" },
  black: { username: "Opponent01", rating: 1201, result: "resigned" },
  timeClass: "rapid",
  timeControl: "600",
  endTime: Date.UTC(2026, 10, 14, 18, 0, 0) / 1000,
  ...over,
});
const mapped = (s: ChessComGameSpec): ImportedGame => {
  const r = mapChessComGame(encodeChessComGame(s), { usernameLower: ME.toLowerCase() });
  if (!r.ok) assert.fail(`skipped: ${r.reason} ${r.detail}`);
  return r.game;
};

// The staging games (the slugs as Chess.com sends them, moves that match them).
const PRZEPIORKA = {
  ecoUrl: "https://www.chess.com/openings/Indian-Game-East-Indian-Przepiorka-Variation...5.O-O-O-O-6.c3-c6-7.Nbd2",
  eco: "A49",
  sans: ["d4", "Nf6", "Nf3", "g6", "g3", "Bg7", "Bg2", "d6", "O-O", "O-O", "c3", "c6", "Nbd2", "Nbd7"],
};
const SPASSKY = {
  ecoUrl: "https://www.chess.com/openings/Queens-Indian-Defense-Spassky-System-4...Bb7-5.Bd3-Bb4",
  eco: "E14",
  sans: ["d4", "Nf6", "c4", "e6", "Nf3", "b6", "e3", "Bb7", "Bd3", "Bb4+", "Bd2", "Bxd2+"],
};

describe("imported opening names (regression: move tails from the Chess.com slug)", () => {
  const games = fixtureImports();

  it("maps the fixture games (Chess.com knightowl_88, the recorded months, Lichess)", () => {
    assert.ok(games.length >= 60, `${games.length} games`);
    assert.ok(games.some((g) => g.label.startsWith("recorded")));
    assert.ok(games.some((g) => g.label.startsWith("lichess")));
  });

  it("no stored name carries a move number, \"...\" or castling", () => {
    for (const { label, game } of games) assertCleanName(game.openingName, label);
  });

  it("the staging Przepiorka game is named by the book (A49)", () => {
    const g = mapped(spec({ ...PRZEPIORKA }));
    assert.equal(g.openingName, "Indian Defense: Przepiorka Variation");
    assert.equal(g.ecoCode, "A49");
  });

  it("the staging Queen's Indian Spassky game is named by the book, apostrophe and colon included", () => {
    const g = mapped(spec({ ...SPASSKY }));
    assert.equal(g.openingName, "Queen's Indian Defense: Spassky System");
    assert.equal(g.ecoCode, "E14");
  });

  it("moves the book does not know: the provider's name without its tail, case kept", () => {
    const g = mapped(
      spec({
        startFen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
        sans: ["e4", "Kd7"],
        ecoUrl: PRZEPIORKA.ecoUrl,
        eco: "A49",
      }),
    );
    assert.equal(g.openingName, "Indian Game East Indian Przepiorka Variation");
    assert.equal(g.ecoCode, "A49");
    const q = mapped(spec({ startFen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", sans: ["e4", "Kd7"], ecoUrl: SPASSKY.ecoUrl }));
    assert.equal(q.openingName, "Queens Indian Defense Spassky System");
  });
});
