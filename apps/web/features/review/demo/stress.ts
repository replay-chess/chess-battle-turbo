// The review demo's `stress=1` payload (phase-03 plan §4.10, testing X9): 20-character usernames, a 120-ply game whose
// move numbers reach three digits, the longest opening name, either colour for the viewer, and three key moments with
// the longest copy the schemas allow in practice. Built deterministically from the game demo's seeded quiet walk, so
// the server render and the client render agree. Every move, best move and line replays with chess.js; the grades
// and evals are synthetic (a demo of layout, not of grading).
import { Chess } from "chess.js";
import type { MomentDTO, ReviewCompleteView, ReviewDTO } from "@repo/contracts/http/review";
import { JUDGEMENT_CHARS } from "@repo/chess-analysis/codec";
import { quietWalk, STRESS_NAMES } from "@/features/game/demo/fixtures";

export const STRESS_REVIEW_REF = "cstressreview0000000000001";
export const STRESS_REVIEW_PLIES = 120;
/** The longest ECO family name in the openings table, with its variation (≤ 120 chars, the contract's cap). */
export const STRESS_OPENING = {
  eco: "D37",
  name: "Queen's Gambit Declined: Harrwitz Attack, Main Line, Fianchetto Defence, Karpov–Kasparov",
} as const;

/** One judgement char per ply: mostly good moves, with an error every few plies (the viewer's moments among them). */
const PATTERN = "kkkkbEbgbEbIgbbNbEbbgXbbEbMbgbbE";

interface Walked {
  startFen: string;
  startPly: number;
  uci: string[];
  san: string[];
  fens: string[];
  /** Another legal move in each position (the "best" of an error ply). */
  alt: string[];
}

let walked: Walked | null = null;

function walk(): Walked {
  if (walked) return walked;
  const opening = quietWalk(new Chess().fen(), 30, 1_202_611);
  const f = opening.fen.split(" ");
  f[5] = "45"; // move numbers reach 104 by the end
  const startFen = f.join(" ");
  const { uci } = quietWalk(startFen, STRESS_REVIEW_PLIES, 1_202_612);
  const chess = new Chess(startFen);
  const out: Walked = { startFen, startPly: (45 - 1) * 2 + (chess.turn() === "b" ? 1 : 0), uci, san: [], fens: [startFen], alt: [] };
  for (const u of uci) {
    const legal = chess.moves({ verbose: true });
    const other = legal.find((m) => m.from + m.to + (m.promotion ?? "") !== u) ?? legal[0]!;
    out.alt.push(other.from + other.to + (other.promotion ?? ""));
    const mv = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    out.san.push(mv.san);
    out.fens.push(mv.after);
  }
  walked = out;
  return out;
}

function lineFrom(fen: string, first: string, plies: number): { uci: string[]; san: string[] } {
  const chess = new Chess(fen);
  const uci: string[] = [];
  const san: string[] = [];
  let next: string | undefined = first;
  for (let i = 0; i < plies && next; i++) {
    const mv = chess.move({ from: next.slice(0, 2), to: next.slice(2, 4), promotion: next.length > 4 ? next[4] : undefined });
    uci.push(next);
    san.push(mv.san);
    const reply = chess.moves({ verbose: true })[0];
    next = reply ? reply.from + reply.to + (reply.promotion ?? "") : undefined;
  }
  return { uci, san };
}

const LONG_WHY = [
  "After the move you played, the knight on the long diagonal gets a second route into your position and keeps the pressure on both weak pawns at once.",
  "The engine’s move keeps the rook on the open file and the queen ready to recapture, so neither of the weak squares can be taken for free.",
  "You lose about 23 win% points, so this is the move that decided the game.",
];

/** The stress ReviewDTO (done) with the viewer as `you`. */
export function stressReview(you: "w" | "b" = "w"): ReviewDTO {
  const g = walk();
  const n = g.uci.length;
  const j = Array.from({ length: n }, (_, i) => PATTERN.charAt(i % PATTERN.length)).join("");
  const errors = new Set(["N", "I", "M", "S", "X"]);
  const best = g.uci.map((u, i) => (errors.has(j.charAt(i)) ? g.alt[i]! : u));
  const evals = Array.from({ length: n + 1 }, (_, k) => Math.round(Math.sin(k / 9) * 180 + (k > 90 ? (k - 90) * 6 : 0)));
  const counts = { w: Array(13).fill(0) as number[], b: Array(13).fill(0) as number[] };
  const startWhite = g.startPly % 2 === 0;
  for (let i = 0; i < n; i++) {
    const side = (i % 2 === 0) === startWhite ? "w" : "b";
    counts[side][JUDGEMENT_CHARS.indexOf(j.charAt(i))]! += 1;
  }
  const mine = (i: number) => ((i % 2 === 0) === startWhite ? "w" : "b") === you;
  const candidates = [...Array(n).keys()].filter((i) => mine(i) && errors.has(j.charAt(i)) && i > 4 && i < n - 4);
  // Three moments spread over the game: the first, the middle and the last candidate.
  const picks = [...new Set([0, Math.floor(candidates.length / 2), candidates.length - 1])].map((k) => candidates[k]!).filter((p) => p !== undefined);
  const moments: MomentDTO[] = picks.slice(0, 3).map((ply, idx) => {
    const fen = g.fens[ply]!;
    const line = lineFrom(fen, best[ply]!, 8);
    const label = `${Math.floor((g.startPly + ply) / 2) + 1}${(g.startPly + ply) % 2 === 0 ? "." : "…"}`;
    const bestSan = line.san[0]!;
    return {
      ply,
      moveLabel: label,
      judgement: (["mistake", "miss", "blunder"] as const)[idx % 3]!,
      playedUci: g.uci[ply]!,
      playedSan: g.san[ply]!,
      bestUci: best[ply]!,
      bestSan,
      accept: [best[ply]!],
      line: line.uci.join(" "),
      lineSan: line.san.join(" "),
      winBefore: 52.4,
      winAfter: 29.6,
      intent: "defend",
      ask: `Move ${label.replace(/[.…]$/, "")}. Your opponent’s knight on the long diagonal is eyeing your bishop, and both of your weak pawns are under fire. What would you play?`,
      why: LONG_WHY.map((t) => ({ t, v: false })),
      plan: {
        attack: `You were thinking: attack. The engine’s idea here was to defend: ${bestSan} keeps both weak squares covered.`,
        defend: `Right instinct. ${LONG_WHY[0]}`,
        trade: `You were thinking: trade. The engine’s idea here was to defend: ${bestSan} keeps both weak squares covered.`,
        improve: `You were thinking: improve. The engine’s idea here was to defend: ${bestSan} keeps both weak squares covered.`,
        unsure: `The engine’s idea here was to defend: ${bestSan}.`,
      },
      inBank: true,
      result: null,
      attempts: 0,
    };
  });
  const card = (side: "w" | "b") => ({
    name: STRESS_NAMES[side],
    rating: side === "w" ? 2851 : 1184,
    initials: STRESS_NAMES[side].slice(0, 2).toUpperCase(),
    kind: "member" as const,
    isYou: side === you,
  });
  return {
    v: 1,
    ref: STRESS_REVIEW_REF,
    status: "done",
    game: {
      mode: "online",
      source: "replay",
      startFen: g.startFen,
      startPly: g.startPly,
      tc: { label: "Classical 90+30", timeClass: "classical", initialSec: 5_400, incSec: 30 },
      result: "1/2-1/2",
      endLabel: "½–½ agreed after a long defence",
      playedAt: "2026-11-09T18:42:10.000Z",
      playedAtLabel: "Nov 9",
      opening: { ...STRESS_OPENING },
      legend: null,
    },
    players: { w: card("w"), b: card("b") },
    you,
    moves: g.uci.join(" "),
    san: g.san.join(" "),
    clocks: [],
    analysis: {
      version: 1,
      engineLabel: "Stockfish 18",
      depthLabel: "depth 18",
      gradedPlies: n,
      totalPlies: n,
      evals,
      best: best.join(" "),
      j,
      accuracy: { w: 100, b: 100 },
      phaseAccuracy: { w: [100, 88, 71], b: [96, 84, 69] },
      phases: { middlegamePly: 10, endgamePly: 80 },
      counts,
      failure: null,
      queue: null,
    },
    review: {
      textStatus: "template",
      summary: [
        { t: "You played at 100 accuracy; your opponent at 100. Your opening was the strongest part (100).", v: false },
        { t: `The game turned on move ${moments[0]?.moveLabel.replace(/[.…]$/, "") ?? "1"}, when ${moments[0]?.playedSan ?? "e4"} missed ${moments[0]?.bestSan ?? "e4"}.`, v: false },
        { t: `${moments.length} moments are worth a second look.`, v: false },
      ],
      coachLine: { t: "The game turned on a quiet move in the middlegame.", v: false },
      phaseLine: "Opening solid · middlegame lost the thread · endgame slipped",
      headline: "Mistake · move 104",
      isClean: false,
      bestPly: 2,
      bestDecision: null,
      moments,
      progress: { momentIndex: 0, startedAt: null, completedAt: null },
    },
    share: null,
  };
}

/** The complete page's stress view: the stress game's moments with the longest captions. */
export function stressComplete(): ReviewCompleteView {
  const dto = stressReview("w");
  const g = walk();
  const moments = dto.review!.moments.map((m, i) => ({
    ply: m.ply,
    moveLabel: m.moveLabel,
    fenAfter: g.fens[m.ply + 1]!,
    playedSan: m.playedSan,
    bestSan: m.bestSan,
    judgement: m.judgement,
    why0: m.why[0]!.t,
    result: (["found", "found_retry", "revealed"] as const)[i % 3]!,
  }));
  return {
    v: 1,
    ref: STRESS_REVIEW_REF,
    header: { eyebrow: `Review · vs ${STRESS_NAMES.b} · ½–½`, opponentName: STRESS_NAMES.b, resultLabel: "½–½" },
    accuracy: 100,
    moments,
    found: moments.filter((m) => m.result === "found" || m.result === "found_retry").length,
    reviewed: moments.length,
    isClean: false,
    bestDecision: null,
    brilliant: 0,
    standouts: [],
    bestThisMonth: true,
    partial: false,
    shareEnabled: true,
  };
}
