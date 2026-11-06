// DB record → wire GameState / GameSnapshot (plan 5.1, 7.1.2). Plain types, no Prisma: WEB's getGameSnapshot and
// the socket's loadLiveGame map their row (BigInt-free, dates as epoch ms) to `GameRecord` and call `snapshotOf`.
// Spectators get the projection of plan 8.10: moves cut one ply short while playing, no offers.

import { INITIAL_FEN } from "./constants";
import type {
  EndMethod,
  GameMode,
  GameState,
  Phase,
  PlayerView,
  PositionCard,
  Side,
  WireTimeClass,
} from "./machine/types";
import { headerRight, initialsOf } from "./rules/describe";
import { replay, sideToMove, splitMoves, startPlyOf } from "./rules/chess";
import { tcLabel, timeClassOf, wireTimeClass, type TimeClass } from "./rules/timeClass";
import type { AbortedBy } from "./machine/types";

export type DbGameStatus = "WAITING_FOR_OPPONENT" | "IN_PROGRESS" | "COMPLETED" | "ABORTED" | "CANCELLED" | "EXPIRED";
export type DbLivePhase = "WAITING" | "STUDY" | "FIRST_MOVE" | "PLAYING" | "ENDED";
export type DbEndMethod =
  | "CHECKMATE"
  | "RESIGNATION"
  | "TIMEOUT"
  | "TIMEOUT_VS_INSUFFICIENT"
  | "STALEMATE"
  | "THREEFOLD"
  | "FIFTY_MOVE"
  | "INSUFFICIENT_MATERIAL"
  | "AGREEMENT"
  | "ABANDONED"
  | "ABORTED"
  | "OTHER";
export type DbOutcome = "WHITE" | "BLACK" | "DRAW" | "NONE";
export type DbGameMode = GameMode | "LEGEND_BOT" | "IMPORTED";

export interface PlayerRecord {
  ref: string;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
}

/** Plain view of the `games` row (+ the two players) that the snapshot needs. Times are epoch ms. */
export interface GameRecord {
  referenceId: string;
  status: DbGameStatus;
  mode: DbGameMode | null;
  rated: boolean;
  timeClass: TimeClass | null;
  startingFen: string | null;
  startPly?: number | null;
  studySeconds: number;
  moves: string;
  moveClocksMs: number[];
  fen: string | null;
  initialTimeSeconds: number | null;
  incrementSeconds: number | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockRunning: string | null;
  phase: DbLivePhase | null;
  phaseEndsAt: number | null;
  lastMoveAt: number | null;
  endMethod: DbEndMethod | null;
  outcome: DbOutcome | null;
  completedAt: number | null;
  updatedAt: number;
  botElo: number | null;
  rematchOfRef?: string | null;
  meta: {
    header?: string;
    prefixSan?: string[];
    prefixStartMoveNo?: number;
    position?: Omit<PositionCard, "sideToMove"> | null;
    rev?: number;
    drawOffers?: { w: number; b: number };
    abortedBy?: AbortedBy | null;
  } | null;
  /** Joined users (null for the bot side or a side nobody joined). */
  white: PlayerRecord | null;
  black: PlayerRecord | null;
  /** Display snapshot columns (fallback for legacy rows and deleted users). */
  whiteName?: string | null;
  blackName?: string | null;
  whiteRating?: number | null;
  blackRating?: number | null;
}

export interface Viewer {
  role: "player" | "spectator";
  color?: Side;
}

export type GameSnapshot = GameState & {
  status: DbGameStatus;
  watchable: boolean;
  updatedAt: number;
  rev: number;
};

const END_FROM_DB: Record<DbEndMethod, EndMethod | null> = {
  CHECKMATE: "checkmate",
  RESIGNATION: "resignation",
  TIMEOUT: "timeout",
  TIMEOUT_VS_INSUFFICIENT: "timeout_vs_insufficient",
  STALEMATE: "stalemate",
  THREEFOLD: "threefold",
  FIFTY_MOVE: "fifty_move",
  INSUFFICIENT_MATERIAL: "insufficient_material",
  AGREEMENT: "agreement",
  ABANDONED: "abandoned",
  ABORTED: "aborted",
  OTHER: null,
};

export function endMethodFromDb(m: DbEndMethod | null): EndMethod | null {
  return m ? END_FROM_DB[m] : null;
}

/** "fifty_move" → "FIFTY_MOVE" (the GameEndMethod enum). */
export function endMethodToDb(m: EndMethod): DbEndMethod {
  return m.toUpperCase() as DbEndMethod;
}

export function outcomeToDb(winner: Side | null, method: EndMethod): DbOutcome {
  if (method === "aborted") return "NONE";
  return winner === "w" ? "WHITE" : winner === "b" ? "BLACK" : "DRAW";
}

export function winnerFromOutcome(o: DbOutcome | null): Side | null {
  return o === "WHITE" ? "w" : o === "BLACK" ? "b" : null;
}

const PHASE_FROM_DB: Record<DbLivePhase, Phase> = {
  WAITING: "waiting",
  STUDY: "study",
  FIRST_MOVE: "first_move",
  PLAYING: "playing",
  ENDED: "ended",
};

export function phaseToDb(p: Phase): DbLivePhase {
  return p.toUpperCase() as DbLivePhase;
}

/** Live modes are watchable by members (owner Q3); bot games are private to their player. */
export function isWatchable(mode: DbGameMode | null): boolean {
  return mode === "FRIEND" || mode === "ONLINE" || mode === "TOURNAMENT";
}

function wireMode(mode: DbGameMode | null): GameMode {
  if (mode === "LEGEND_BOT" || mode === "BOT") return "BOT";
  if (mode === "ONLINE" || mode === "TOURNAMENT") return mode;
  return "FRIEND";
}

export function snapshotOf(r: GameRecord, viewer: Viewer, now: number): GameSnapshot {
  const spectator = viewer.role === "spectator";
  const mode = wireMode(r.mode);
  const startFen = r.startingFen || INITIAL_FEN;
  const tcSeconds =
    r.initialTimeSeconds != null && r.timeClass !== "UNTIMED"
      ? { initialSeconds: r.initialTimeSeconds, incrementSeconds: r.incrementSeconds ?? 0 }
      : null;
  const tc = tcSeconds
    ? {
        initialMs: tcSeconds.initialSeconds * 1000,
        incrementMs: tcSeconds.incrementSeconds * 1000,
        label: tcLabel(tcSeconds),
      }
    : null;
  const timeClass: WireTimeClass = wireTimeClass(r.timeClass ?? timeClassOf(tcSeconds));

  const ended =
    r.status === "COMPLETED" || r.status === "ABORTED" || r.status === "CANCELLED" || r.status === "EXPIRED";
  let phase: Phase = ended
    ? "ended"
    : r.phase
      ? PHASE_FROM_DB[r.phase]
      : r.status === "WAITING_FOR_OPPONENT"
        ? "waiting"
        : "playing";
  if (mode === "BOT" && !ended) phase = "playing";

  let moves = splitMoves(r.moves);
  let clocksMs = [...r.moveClocksMs];
  if (spectator && phase !== "ended" && moves.length > 0) {
    moves = moves.slice(0, -1); // one-ply delay (plan 8.10)
    clocksMs = clocksMs.slice(0, Math.min(clocksMs.length, moves.length));
  }
  const rep = replay(startFen, moves);
  const chess = rep.ok ? rep.chess : null;
  const fen = chess ? chess.fen() : (r.fen ?? startFen);
  const turn = chess ? chess.turn() : sideToMove(fen);

  const initialMs = tc?.initialMs ?? 0;
  const clocks = {
    w: r.whiteTimeMs ?? initialMs,
    b: r.blackTimeMs ?? initialMs,
    run: !ended && tc && (r.clockRunning === "w" || r.clockRunning === "b") ? (r.clockRunning as Side) : null,
    at: r.lastMoveAt ?? now,
  };

  const botSide: Side | null = mode === "BOT" ? (r.white ? "b" : "w") : null;
  const player = (side: Side): PlayerView => {
    const rec = side === "w" ? r.white : r.black;
    const fallbackName = (side === "w" ? r.whiteName : r.blackName) ?? "";
    const isBot = botSide === side;
    const name = isBot ? `Engine ${r.botElo ?? ""}`.trim() : (rec?.name ?? fallbackName);
    return {
      ref: isBot ? null : (rec?.ref ?? null),
      displayName: name,
      initials: isBot ? "EN" : initialsOf(name || "?"),
      avatarUrl: isBot ? null : (rec?.avatarUrl ?? null),
      rating: isBot ? r.botElo : (rec?.rating ?? (side === "w" ? r.whiteRating : r.blackRating) ?? null),
      isBot,
      online: isBot,
      graceEndsAt: null,
    };
  };

  const method = endMethodFromDb(r.endMethod);
  const meta = r.meta ?? {};
  const prefixSan = meta.prefixSan ?? [];
  const startPly = r.startPly ?? startPlyOf(startFen);
  const result =
    ended && method
      ? {
          winner: winnerFromOutcome(r.outcome),
          method,
          ply: startPly + splitMoves(r.moves).length, // absolute, as on the wire
          endedAt: r.completedAt ?? r.updatedAt,
          ...(method === "aborted" && meta.abortedBy ? { abortedBy: meta.abortedBy } : {}),
        }
      : null;

  const state: GameSnapshot = {
    v: 2,
    ref: r.referenceId,
    seq: 0,
    serverNow: now,
    mode,
    rated: r.rated,
    timeClass,
    tc,
    header: {
      left: meta.header ?? "",
      right: headerRight({ mode, tc: tcSeconds, role: viewer.role, rematch: !!r.rematchOfRef, botElo: r.botElo }),
    },
    position: meta.position ? { ...meta.position, sideToMove: sideToMove(startFen) } : null,
    startFen,
    startPly,
    prefix: {
      sans: prefixSan.join(" "),
      startMoveNo: meta.prefixStartMoveNo ?? 1,
      startsBlack: prefixSan.length > 0 && (startPly - prefixSan.length) % 2 === 1,
    },
    moves: moves.join(" "),
    clocksMs: tc ? clocksMs : [],
    fen,
    turn,
    inCheck: chess ? chess.inCheck() : false,
    phase,
    study:
      phase === "study" && r.phaseEndsAt !== null ? { endsAt: r.phaseEndsAt, ready: { w: false, b: false } } : null,
    firstMove: phase === "first_move" && r.phaseEndsAt !== null ? { side: turn, deadlineAt: r.phaseEndsAt } : null,
    clocks,
    frozen: null,
    players: { w: player("w"), b: player("b") },
    you: spectator ? { role: "spectator" } : { role: "player", ...(viewer.color ? { color: viewer.color } : {}) },
    drawOffer: null,
    canOfferAtPly: { w: 0, b: 0 },
    rematch: null,
    spectators: 0,
    result,
    status: r.status,
    watchable: isWatchable(r.mode),
    updatedAt: r.updatedAt,
    rev: meta.rev ?? 0,
  };
  if (mode === "BOT" && r.botElo != null) state.bot = { elo: r.botElo, name: `Engine ${r.botElo}` };
  if (r.rematchOfRef) state.rematchOf = r.rematchOfRef;
  return state;
}
