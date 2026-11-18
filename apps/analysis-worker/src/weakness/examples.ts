// RECOMPUTE_WEAKNESS step 7 (phase-06 plan §7.4.2, §8.19, Q-W6): one example position per profile row, the newest
// visible bank mistake tagged with the row's pattern (puzzles first). `rc:timePressure` rows use the same theme tag
// (§8.12). The stored `mistakes.fen` is the position BEFORE the opponent's setup move, so the example applies
// `setupUci` with chess.js: the board shows the member to move, oriented to the member's colour.
import { Chess } from "chess.js";
import type { WeaknessExampleDoc } from "@repo/chess-training/weakness/types";
import { stmt, type Db, type Row, type Statement } from "../db/client";

export function examplesStatement(userId: string, patterns: readonly string[]): Statement {
  return stmt(
    `SELECT DISTINCT ON (t) t AS pattern, m."referenceId" AS ref, m.fen, m."setupUci", m.color
   FROM mistakes m CROSS JOIN LATERAL unnest(m.themes) t
  WHERE m."userId" = $1::bigint AND m."hiddenAt" IS NULL AND t = ANY($2::text[])
  ORDER BY t, m."isPuzzle" DESC, m."lastPlayedAt" DESC, m.id DESC`,
    [userId, [...patterns]],
  );
}

/** The FEN with the member to move: the stored FEN after `setupUci`, or the stored FEN when there is no setup move. */
export function exampleFen(fen: string, setupUci: string | null): string | null {
  if (!setupUci) return fen;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: setupUci.slice(0, 2),
      to: setupUci.slice(2, 4),
      ...(setupUci.length > 4 ? { promotion: setupUci.slice(4, 5) } : {}),
    });
    return move ? chess.fen() : null;
  } catch {
    return null;
  }
}

export function toExamples(rows: readonly Row[]): Map<string, WeaknessExampleDoc> {
  const out = new Map<string, WeaknessExampleDoc>();
  for (const r of rows) {
    if (typeof r.pattern !== "string" || typeof r.fen !== "string" || typeof r.ref !== "string") continue;
    const color = r.color === "w" || r.color === "b" ? r.color : null;
    const fen = exampleFen(r.fen, typeof r.setupUci === "string" ? r.setupUci : null);
    if (!color || !fen) continue;
    out.set(r.pattern, { fen, orient: color, mistakeRef: r.ref });
  }
  return out;
}

/** The examples of `patterns` (no round trip when there is no row to illustrate). */
export async function loadExamples(db: Db, userId: string, patterns: readonly string[]): Promise<Map<string, WeaknessExampleDoc>> {
  if (patterns.length === 0) return new Map();
  return toExamples(await db.query(examplesStatement(userId, patterns)));
}
