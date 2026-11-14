// The trainer's per-item phase machine (phase-05 plan §4.4 diagram; board logic `_rv0` / `_sc0` of
// V3BankSession and V3Puzzle*). Pure: `step(prepared, run, event)` returns the next state, `viewOf(...)` what the
// board, the status line, the coach line and the grade bar show. Timers (setup 400 ms, reply 450 ms, solution 600 ms
// per ply) live in the runner store; the suggested grade, the note and the objective score come from
// `@repo/chess-training/grade`, the same rules the server applies.
//
//   setup ──400 ms──► solve ──move = expected, plies remain──► reply ──450 ms──► solve ("Keep going: …")
//                       │   └──move = expected (or accepted), last ply──► graded
//                       ├──other legal move──► wrong ──Try Again──► solve
//                       │                         └──Solution──► sol ──600 ms per ply──► graded (shown)
//                       ├──Hint──► hint 1 (ring) ──Hint──► hint 2 (arrow)   [stays in solve]
//                       └──Show Solution──► sol
import type { Grade, TrainItem } from "@repo/contracts/http/train";
import { gradeOutcome, type SolveFlags } from "@repo/chess-training/grade";
import type { Square } from "chess.js";
import { fenBefore, judgeMove, lastMoveBefore, playUci, type PlyMove, type PreparedItem, type Side } from "./validate";

export const SETUP_MS = 400;
export const REPLY_MS = 450;
export const SOLUTION_STEP_MS = 600;
/** AttemptIn.wrongMovesUci holds at most this many. */
export const MAX_WRONG_MOVES = 10;

export type Phase = "setup" | "solve" | "reply" | "wrong" | "sol" | "graded";

export type WrongMove = PlyMove & { isGameMove: boolean };

export type ItemRun = {
  phase: Phase;
  /** Solution plies on the board. */
  ply: number;
  hints: 0 | 1 | 2;
  wrongs: number;
  wrongMoves: string[];
  /** The wrong move on the board (phase `wrong`). */
  wrong: WrongMove | null;
  /** The solution was shown. */
  shown: boolean;
  solvedBy: "best" | "accept" | null;
  /** The accepted alternative that solved a review position. */
  accepted: PlyMove | null;
  /** The move the member played in the game (bank items), so repeating it gets the game-move coach line. */
  gameMove: string | null;
};

export type RunEvent =
  | { type: "setup_done" }
  | { type: "move"; uci: string }
  | { type: "reply_done" }
  | { type: "hint" }
  | { type: "retry" }
  | { type: "show_solution" }
  | { type: "sol_step" };

export function initialRun(p: PreparedItem, gameMove: string | null = null): ItemRun {
  return {
    phase: p.setup ? "setup" : "solve",
    ply: 0,
    hints: 0,
    wrongs: 0,
    wrongMoves: [],
    wrong: null,
    shown: false,
    solvedBy: null,
    accepted: null,
    gameMove: gameMove ? gameMove.toLowerCase() : null,
  };
}

/** The member's turn (a move input is open). */
export function isUserTurn(run: ItemRun): boolean {
  return run.phase === "solve" && run.ply % 2 === 0;
}

export function step(p: PreparedItem, run: ItemRun, ev: RunEvent): ItemRun {
  switch (ev.type) {
    case "setup_done":
      return run.phase === "setup" ? { ...run, phase: "solve" } : run;
    case "move": {
      if (!isUserTurn(run)) return run;
      const verdict = judgeMove(p, run.ply, ev.uci);
      if (verdict === "best") {
        const ply = run.ply + 1;
        if (ply >= p.line.length) return { ...run, ply, phase: "graded", solvedBy: "best" };
        return { ...run, ply, phase: "reply" };
      }
      if (verdict === "accept") {
        // An accepted alternative ends the item where it was played (the first move, or a mate at a later ply).
        const accepted = playUci(fenBefore(p, run.ply), ev.uci);
        return { ...run, phase: "graded", solvedBy: "accept", accepted, ply: run.ply + 1 };
      }
      const played = playUci(fenBefore(p, run.ply), ev.uci);
      if (!played) return run;
      const isGameMove = run.ply === 0 && run.gameMove !== null && played.uci === run.gameMove;
      return {
        ...run,
        phase: "wrong",
        wrongs: run.wrongs + 1,
        wrongMoves: run.wrongMoves.length < MAX_WRONG_MOVES ? [...run.wrongMoves, played.uci] : run.wrongMoves,
        wrong: { ...played, isGameMove },
      };
    }
    case "reply_done": {
      if (run.phase !== "reply") return run;
      const ply = run.ply + 1;
      return ply >= p.line.length ? { ...run, ply, phase: "graded", solvedBy: "best" } : { ...run, ply, phase: "solve" };
    }
    case "hint":
      if (run.phase !== "solve" || run.hints >= 2) return run;
      return { ...run, hints: (run.hints + 1) as 1 | 2 };
    case "retry":
      return run.phase === "wrong" ? { ...run, phase: "solve", wrong: null } : run;
    case "show_solution":
      if (run.phase !== "solve" && run.phase !== "wrong" && run.phase !== "reply") return run;
      return { ...run, phase: "sol", shown: true, wrong: null };
    case "sol_step": {
      if (run.phase !== "sol") return run;
      const ply = run.ply + 1;
      return ply >= p.line.length ? { ...run, ply: p.line.length, phase: "graded" } : { ...run, ply };
    }
  }
}

/** The flags the grade rules read. */
export function flagsOf(run: ItemRun, item: Pick<TrainItem, "kind">): SolveFlags {
  return {
    shown: run.shown,
    wrongs: run.wrongs,
    hints: run.hints,
    acceptedNonBest: run.solvedBy === "accept" && item.kind === "review_position",
  };
}

/** The timer the current phase needs, if any (the store schedules it). */
export function timerFor(run: ItemRun): { event: RunEvent; ms: number } | null {
  if (run.phase === "setup") return { event: { type: "setup_done" }, ms: SETUP_MS };
  if (run.phase === "reply") return { event: { type: "reply_done" }, ms: REPLY_MS };
  if (run.phase === "sol") return { event: { type: "sol_step" }, ms: SOLUTION_STEP_MS };
  return null;
}

// ── What the screen shows ────────────────────────────────────────────────────────────────────────────────────────
export const COLOUR = { w: "White", b: "Black" } as const;
const other = (s: Side): Side => (s === "w" ? "b" : "w");

/** Board marks (V3BankSession `_rv0`). */
export const MARK = {
  wrongFrom: "rgba(210,120,110,0.45)",
  wrongTo: "rgba(210,120,110,0.55)",
  hintRing: "rgba(3,105,161,0.9)",
  hintArrow: "#0369a1",
  solved: "rgba(110,187,140,0.5)",
  shown: "rgba(120,160,210,0.45)",
} as const;

export type CoachTone = "idle" | "good" | "bad";

export type RunView = {
  fen: string;
  lastMove: [Square, Square] | null;
  check: Square | null;
  highlights: Partial<Record<Square, string>>;
  rings: Partial<Record<Square, string>>;
  arrows: { from: Square; to: Square; color: string }[];
  badge: { sq: Square; kind: "best" | "good" } | null;
  /** The side that may move now, else null. */
  mover: Side | null;
  status: string;
  coach: { text: string; tone: CoachTone; verified: boolean } | null;
  hintNote: string | null;
  solving: boolean;
  wrong: boolean;
  graded: boolean;
  /** The hint button's label and state (Hint → Show Arrow → Hint Used). */
  hint: { label: "Hint" | "Show Arrow" | "Hint Used"; disabled: boolean; step: 0 | 1 | 2 };
  suggested: Grade | null;
  gradeNote: string | null;
  firstTry: boolean;
  score: 0 | 0.5 | 1;
  /** "· streak reset" after a wrong move or a shown solution. */
  streakReset: boolean;
};

export function viewOf(item: TrainItem, p: PreparedItem, run: ItemRun): RunView {
  const highlights: RunView["highlights"] = {};
  const rings: RunView["rings"] = {};
  const arrows: RunView["arrows"] = [];
  let badge: RunView["badge"] = null;
  let fen: string;
  let last: PlyMove | null;
  let lastPair: [Square, Square] | null = null;
  let check: Square | null = null;

  const flags = flagsOf(run, item);
  const outcome = gradeOutcome(flags, { bestSan: p.line[0]?.san });
  const graded = run.phase === "graded";

  if (run.phase === "setup") {
    fen = p.startFen;
    lastPair = item.lastMove ? [item.lastMove[0] as Square, item.lastMove[1] as Square] : null;
  } else if (run.phase === "wrong" && run.wrong) {
    fen = run.wrong.fen;
    lastPair = [run.wrong.from, run.wrong.to];
    check = run.wrong.check;
    highlights[run.wrong.from] = MARK.wrongFrom;
    highlights[run.wrong.to] = MARK.wrongTo;
  } else if (graded && run.accepted) {
    fen = run.accepted.fen;
    lastPair = [run.accepted.from, run.accepted.to];
    check = run.accepted.check;
    highlights[run.accepted.to] = MARK.solved;
    badge = { sq: run.accepted.to, kind: "good" };
  } else {
    fen = fenBefore(p, run.ply);
    last = lastMoveBefore(p, run.ply);
    if (last) {
      lastPair = [last.from, last.to];
      check = last.check;
    } else if (item.lastMove) {
      lastPair = [item.lastMove[0] as Square, item.lastMove[1] as Square];
    }
    if (graded && last) {
      highlights[last.to] = run.shown ? MARK.shown : MARK.solved;
      if (!run.shown) badge = { sq: last.to, kind: "best" };
    }
    const exp = p.line[run.ply];
    if (run.phase === "solve" && exp && run.hints >= 1) rings[exp.from] = MARK.hintRing;
    if (run.phase === "solve" && exp && run.hints >= 2) arrows.push({ from: exp.from, to: exp.to, color: MARK.hintArrow });
  }

  const userName = COLOUR[p.userSide];
  const oppName = COLOUR[other(p.userSide)];
  let status: string;
  let coach: RunView["coach"] = null;
  const verified = item.text.verified;
  switch (run.phase) {
    case "setup":
      status = "Watch the last move…";
      break;
    case "reply":
      status = `Good. ${oppName} replies…`;
      break;
    case "sol":
      status = "Here is the solution";
      coach = { text: item.text.correct, tone: "idle", verified };
      break;
    case "wrong":
      status = "Not quite.";
      coach =
        run.wrong?.isGameMove && item.text.wrongGameMove
          ? { text: item.text.wrongGameMove, tone: "bad", verified }
          : { text: `Not the move. ${item.text.hint}`, tone: "bad", verified: false };
      break;
    case "graded":
      status = run.shown ? "Solution shown" : "Correct.";
      coach = { text: item.text.correct, tone: run.shown ? "idle" : "good", verified };
      break;
    case "solve":
      status = `${run.ply > 0 ? "Keep going: " : ""}${userName} to move`;
      if (run.hints >= 1) coach = { text: run.hints >= 2 ? `${item.text.hint} The arrow shows the move.` : item.text.hint, tone: "idle", verified };
      break;
  }

  return {
    fen,
    lastMove: lastPair,
    check,
    highlights,
    rings,
    arrows,
    badge,
    mover: isUserTurn(run) ? p.userSide : null,
    status,
    coach,
    hintNote: run.hints > 0 ? "Hint used · counts as Hard" : null,
    solving: run.phase === "solve" || run.phase === "setup" || run.phase === "reply" || run.phase === "sol",
    wrong: run.phase === "wrong",
    graded,
    hint: {
      label: run.hints === 0 ? "Hint" : run.hints === 1 ? "Show Arrow" : "Hint Used",
      disabled: run.hints >= 2 || run.phase !== "solve" || !isUserTurn(run),
      step: run.hints,
    },
    suggested: graded ? outcome.suggested : null,
    gradeNote: graded ? outcome.note : null,
    firstTry: outcome.firstTry,
    score: outcome.score,
    streakReset: run.phase === "wrong" || (graded && outcome.streakReset),
  };
}
