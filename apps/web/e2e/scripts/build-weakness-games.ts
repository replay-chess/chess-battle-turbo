/**
 * Builds `packages/chess-fixtures/weakness/persona-games.json` (phase-06 plan §6.8, §12.4; the owner's "real data, not
 * mocks" rule): the real CC0 Lichess games the P6 personas are made of. Each persona's games are written as finished
 * games of the leased user, analysed by the running worker, extracted into the bank and turned into a profile by
 * RECOMPUTE_WEAKNESS (packages/db/seed/p06-personas.ts); nothing about the profile is hand-written.
 *
 * Source: one monthly dump of the Lichess open database (CC0 1.0, https://database.lichess.org/, 2026-10), sampled by
 * WP2 (`packages/chess-training/scripts/build-baseline.ts`) into a per-cell subset outside the repository
 * (`{ "1500:BLITZ": [{ id, tc, color, elo, headers, movetext }] }`, movetext with `%clk`). The extract keeps, per
 * game, only the moves (UCI), the per-ply clocks, the time control, the side the member played, both ratings, the
 * result, the termination and the ECO code. Lichess ids, player names, dates and `%eval` comments are dropped; the
 * personas re-date every game relative to the reset.
 *
 *   cd apps/web
 *   npx tsx e2e/scripts/build-weakness-games.ts --from <subset.json> [--out <file>]
 *
 * Deterministic: games are taken in the subset's order, keeping those with ≥ MIN_PLIES plies and a clock on every
 * ply, until each cell has its count.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Chess } from "chess.js";

/** Games per cell (band:timeClass): the most any P6 persona takes from that cell (p06-persona-states.ts). */
export const CELL_COUNTS: Record<string, number> = {
  "1500:BLITZ": 40,
  "1500:RAPID": 20,
  "1200:BLITZ": 12,
  "1200:RAPID": 6,
  "1200:BULLET": 20,
};

/** A short game says little about a player's patterns; the personas keep real middlegames. */
export const MIN_PLIES = 24;

type SourceGame = { id: string; tc: string; color: "w" | "b"; elo: number; headers: Record<string, string>; movetext: string };

export type PersonaGame = {
  /** Stable key inside the cell ("1500:BLITZ#07"). */
  k: string;
  /** Lichess TimeControl, "180+2". */
  tc: string;
  /** The side the member played. */
  c: "w" | "b";
  elo: number;
  oppElo: number;
  res: "1-0" | "0-1" | "1/2-1/2";
  /** Lichess Termination header ("Normal", "Time forfeit"). */
  term: string;
  eco: string | null;
  /** Space-separated UCI moves from the initial position. */
  uci: string;
  /** The mover's remaining clock after each ply, in milliseconds (the import mapper's per-ply rule). */
  clk: number[];
};

export type PersonaGamesFile = {
  v: 1;
  source: string;
  license: string;
  cells: Record<string, PersonaGame[]>;
};

/** SAN movetext with `{[%clk h:mm:ss]}` comments → UCI moves and per-ply clocks (empty when a ply has none). */
export function parseMovetext(movetext: string): { uci: string[]; clk: number[] } {
  const chess = new Chess();
  const uci: string[] = [];
  const clk: number[] = [];
  const re = /\{([^}]*)\}|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([^\s{}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(movetext))) {
    if (m[1] !== undefined) {
      const c = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(m[1]);
      if (c && clk.length < uci.length) clk.push(Math.round((Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3])) * 1000));
      continue;
    }
    if (m[2] || m[3]) continue;
    const mv = chess.move(m[4]!);
    uci.push(`${mv.from}${mv.to}${mv.promotion ?? ""}`);
  }
  return { uci, clk: clk.length === uci.length ? clk : [] };
}

export function buildPersonaGames(subset: Record<string, SourceGame[]>, source: string): PersonaGamesFile {
  const cells: Record<string, PersonaGame[]> = {};
  for (const [cell, want] of Object.entries(CELL_COUNTS)) {
    const out: PersonaGame[] = [];
    for (const g of subset[cell] ?? []) {
      if (out.length >= want) break;
      const res = g.headers.Result;
      if (res !== "1-0" && res !== "0-1" && res !== "1/2-1/2") continue;
      const { uci, clk } = parseMovetext(g.movetext);
      if (uci.length < MIN_PLIES || clk.length !== uci.length) continue;
      const oppElo = Number(g.color === "w" ? g.headers.BlackElo : g.headers.WhiteElo);
      out.push({
        k: `${cell}#${String(out.length + 1).padStart(2, "0")}`,
        tc: g.headers.TimeControl ?? g.tc,
        c: g.color,
        elo: g.elo,
        oppElo: Number.isFinite(oppElo) ? oppElo : g.elo,
        res,
        term: g.headers.Termination ?? "Normal",
        eco: g.headers.ECO && /^[A-E]\d\d$/.test(g.headers.ECO) ? g.headers.ECO : null,
        uci: uci.join(" "),
        clk,
      });
    }
    if (out.length < want) throw new Error(`${cell}: only ${out.length} of ${want} usable games in the subset`);
    cells[cell] = out;
  }
  return { v: 1, source, license: "CC0 1.0 (Lichess open database, https://database.lichess.org/)", cells };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const from = arg("--from");
  if (!from) throw new Error("usage: build-weakness-games.ts --from <subset.json> [--out <file>]");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = arg("--out") ?? path.resolve(here, "../../../../packages/chess-fixtures/weakness/persona-games.json");
  const subset = JSON.parse(readFileSync(from, "utf8")) as Record<string, SourceGame[]>;
  const file = buildPersonaGames(subset, "lichess_db_standard_rated_2026-10 (WP2 sample)");
  // One game per line: a diff of the committed file stays readable.
  const lines = Object.entries(file.cells).map(
    ([cell, games]) => `    ${JSON.stringify(cell)}: [\n${games.map((g) => `      ${JSON.stringify(g)}`).join(",\n")}\n    ]`,
  );
  writeFileSync(out, `{\n  "v": 1,\n  "source": ${JSON.stringify(file.source)},\n  "license": ${JSON.stringify(file.license)},\n  "cells": {\n${lines.join(",\n")}\n  }\n}\n`);
  const n = Object.values(file.cells).reduce((s, c) => s + c.length, 0);
  console.log(`persona games: ${n} games in ${Object.keys(file.cells).length} cells → ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
