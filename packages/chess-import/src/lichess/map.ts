// One Lichess export game (NDJSON line, `pgnInJson=false`) → `ImportedGame` (phase-04 plan §8.7 step 3, pure).
//
// Skips, in order: `aborted` / `noStart` → `aborted`; `created` / `started` → `unfinished`; a variant other than
// standard or `fromPosition` → `variant`; unrated → `unrated`; the member on neither side → `not_participant`; an
// unknown speed, a `fromPosition` game without `initialFen`, or an illegal SAN → `parse_error`; fewer than 2 plies →
// `too_short`.
//
// `draw` is labelled from the replayed final position (data-model B1): THREEFOLD or FIFTY_MOVE when the board proves
// it (and INSUFFICIENT_MATERIAL / STALEMATE likewise), else AGREEMENT.
import { boardDraw, INITIAL_FEN, lastClocks, moverOf, positionKey, replaySan } from "../replay";
import { lichessTimeClass } from "../time-class";
import {
  clip,
  NAME_MAX,
  OPENING_NAME_MAX,
  skip,
  TITLE_MAX,
  type EvalHint,
  type ImportEndMethod,
  type ImportOutcome,
  type MapResult,
} from "../types";
import { lichessSchemas, type LichessAnalysisEntry, type LichessGame, type LichessPlayer } from "./types";

export interface LichessMapContext {
  /** The linked account's Lichess id (lower-case username, `players.*.user.id`). */
  userId: string;
}

export const LICHESS_ORIGIN = "https://lichess.org";

/** P3's eval encoding (CA/src/codec.ts): |cp| ≤ 9999; mate in n for the sign's side = sign·(30000 − n). */
export const EVAL_CP_LIMIT = 9999;
export const EVAL_MATE_BASE = 30000;
/** `EvalHint.cp` holds at most this many plies (`EVAL_HINT_MAX_PLIES` in CT/internal/jobs.ts). */
export const EVAL_HINT_MAX_PLIES = 2000;

/** `status` → `GameEndMethod` for a finished game (`outoftime` and `draw` are refined in `mapLichessGame`). */
export const LICHESS_END_METHODS: Readonly<Record<string, ImportEndMethod>> = {
  mate: "CHECKMATE",
  resign: "RESIGNATION",
  stalemate: "STALEMATE",
  outoftime: "TIMEOUT",
  timeout: "ABANDONED",
  draw: "AGREEMENT",
  insufficientMaterialClaim: "INSUFFICIENT_MATERIAL",
  cheat: "OTHER",
  unknownFinish: "OTHER",
  variantEnd: "OTHER",
};

const SKIPPED_STATUSES: Readonly<Record<string, "aborted" | "unfinished">> = {
  aborted: "aborted",
  noStart: "aborted",
  created: "unfinished",
  started: "unfinished",
};

/**
 * Lichess `analysis` → the per-ply eval hint, or null (R-LI-08). Used only when there is one entry per ply; a game
 * that ends in mate may stop one entry short (the mated position has no eval), which is completed with the terminal
 * mate (n = 0, the mover's sign). Any other length mismatch, or an entry with neither `eval` nor `mate`, → null.
 */
export function evalHintOf(
  analysis: readonly LichessAnalysisEntry[] | undefined,
  plyCount: number,
  startPly: number,
  endsInMate: boolean,
): EvalHint | null {
  if (!analysis || plyCount === 0 || plyCount > EVAL_HINT_MAX_PLIES) return null;
  const complete = analysis.length === plyCount;
  const oneShortOfMate = endsInMate && analysis.length === plyCount - 1;
  if (!complete && !oneShortOfMate) return null;
  const cp: number[] = [];
  for (let i = 0; i < analysis.length; i++) {
    const a = analysis[i]!;
    if (a.mate !== undefined) {
      // mate 0 after ply i: the side to move is mated, so the mover of ply i is the winner.
      const sign = a.mate > 0 ? 1 : a.mate < 0 ? -1 : moverOf(startPly, i) === "w" ? 1 : -1;
      cp.push(sign * (EVAL_MATE_BASE - Math.abs(a.mate)));
    } else if (a.eval !== undefined) {
      cp.push(Math.max(-EVAL_CP_LIMIT, Math.min(EVAL_CP_LIMIT, a.eval)));
    } else {
      return null;
    }
  }
  if (oneShortOfMate) cp.push((moverOf(startPly, plyCount - 1) === "w" ? 1 : -1) * EVAL_MATE_BASE);
  return { source: "lichess", cp };
}

const nameOf = (p: LichessPlayer): string =>
  clip(p.user?.name ?? (p.aiLevel != null ? `Stockfish level ${p.aiLevel}` : (p.name ?? "Anonymous")), NAME_MAX);

export function mapLichessGame(raw: unknown, ctx: LichessMapContext): MapResult {
  const parsed = lichessSchemas("lenient").game.safeParse(raw);
  if (!parsed.success) return skip("parse_error", "export game does not match the schema");
  const g: LichessGame = parsed.data;

  const skipped = SKIPPED_STATUSES[g.status];
  if (skipped) return skip(skipped, `status ${g.status}`);
  if (g.variant !== "standard" && g.variant !== "fromPosition") return skip("variant", `variant ${g.variant}`);
  if (g.rated !== true) return skip("unrated", "unrated game");

  const me = ctx.userId.toLowerCase();
  const color = g.players.white.user?.id === me ? "w" : g.players.black.user?.id === me ? "b" : null;
  if (!color) return skip("not_participant", "the account plays neither side");

  const timeClass = lichessTimeClass(g.speed);
  if (!timeClass) return skip("parse_error", `speed ${g.speed}`);

  let startingFen = INITIAL_FEN;
  if (g.variant === "fromPosition") {
    if (!g.initialFen) return skip("parse_error", "fromPosition without initialFen");
    startingFen = positionKey(g.initialFen) === positionKey(INITIAL_FEN) ? INITIAL_FEN : g.initialFen.trim();
  }
  const sans = g.moves.trim() ? g.moves.trim().split(/\s+/) : [];
  const rep = replaySan(startingFen, sans);
  if (!rep.ok) return skip("parse_error", rep.detail);
  const game = rep.game;
  if (game.plyCount < 2) return skip("too_short", `${game.plyCount} plies`);

  const outcome: ImportOutcome = g.winner === "white" ? "WHITE" : g.winner === "black" ? "BLACK" : "DRAW";
  let endMethod: ImportEndMethod = LICHESS_END_METHODS[g.status] ?? "OTHER";
  if (g.status === "outoftime" && !g.winner) endMethod = "TIMEOUT_VS_INSUFFICIENT";
  if (g.status === "draw") endMethod = boardDraw(game.chess) ?? "AGREEMENT";

  let initialTimeSeconds = 0;
  let incrementSeconds = 0;
  if (g.clock) {
    initialTimeSeconds = g.clock.initial;
    incrementSeconds = g.clock.increment;
  } else if (g.daysPerTurn != null) {
    initialTimeSeconds = g.daysPerTurn * 86_400;
  }
  // `clocks` (centiseconds) has one entry per ply, plus the clock of the side to move when a game is resigned.
  const moveClocksMs =
    g.clocks && g.clocks.length >= game.plyCount ? g.clocks.slice(0, game.plyCount).map((cs) => cs * 10) : [];
  const last = lastClocks(game.startPly, moveClocksMs);

  const mine = color === "w" ? g.players.white : g.players.black;
  const theirs = color === "w" ? g.players.black : g.players.white;
  const memberWon = (outcome === "WHITE" && color === "w") || (outcome === "BLACK" && color === "b");
  const result = outcome === "DRAW" ? "DRAW" : memberWon ? "WIN" : "LOSS";
  const eco = g.opening?.eco?.trim();
  const titleOf = (p: LichessPlayer) => (p.user?.title ? clip(p.user.title, TITLE_MAX) : null);

  return {
    ok: true,
    game: {
      source: "LICHESS",
      externalId: g.id,
      externalUrl: `${LICHESS_ORIGIN}/${g.id}`,
      timeClass,
      rated: true,
      endedAt: new Date(g.lastMoveAt),
      createdAtMs: g.createdAt,
      whiteName: nameOf(g.players.white),
      blackName: nameOf(g.players.black),
      whiteRating: g.players.white.rating ?? null,
      blackRating: g.players.black.rating ?? null,
      whiteTitle: titleOf(g.players.white),
      blackTitle: titleOf(g.players.black),
      outcome,
      endMethod,
      legacyResult: result === "WIN" ? "CREATOR_WON" : result === "LOSS" ? "OPPONENT_WON" : "DRAW",
      ecoCode: eco && /^[A-E]\d\d$/.test(eco) ? eco : null,
      openingName: g.opening?.name ? clip(g.opening.name.trim(), OPENING_NAME_MAX).trimEnd() : null,
      moves: game.uci.join(" "),
      moveClocksMs,
      plyCount: game.plyCount,
      startPly: game.startPly,
      startingFen: game.startingFen,
      fen: game.fen,
      initialTimeSeconds,
      incrementSeconds,
      creatorTimeRemaining: Math.floor((last[color] ?? 0) / 1000),
      opponentTimeRemaining: Math.floor((last[color === "w" ? "b" : "w"] ?? 0) / 1000),
      memberWon,
      color,
      result,
      ratingBefore: mine.rating ?? null,
      ratingDelta: mine.ratingDiff ?? null,
      opponentName: nameOf(theirs),
      opponentRating: theirs.rating ?? null,
      evalHint: evalHintOf(g.analysis, game.plyCount, game.startPly, game.chess.isCheckmate()),
    },
  };
}
