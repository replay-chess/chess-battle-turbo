// The archive note per member game (phase-03 plan §8.7 "Headline", ≤ 80 characters; the row notes of
// `V3GamesArchive`: "Missed Rxf5 · move 19", "Dropped a bishop · move 16", "Clean game").
//
// First match:
//   clean, a legend game, every compared move matched      "Played like {legend}"
//   a legend game the member left, no moments              "Left {legend}’s path · move {n}"
//   clean                                                  "Clean game"
//   worst moment MISS                                      "Missed {bestSan} · move {n}"
//   worst BLUNDER that loses a piece for at most a pawn    "Dropped {a piece} · move {n}"
//   worst BLUNDER that loses material in a trade           "Lost {the queen for a knight} · move {n}"
//   worst BLUNDER                                          "Blunder · move {n}"
//   worst MISTAKE                                          "Mistake · move {n}"
//   only fill inaccuracies                                 "{k} inaccuracies" ("1 inaccuracy")
// The plan lists "Left {legend}’s path" last; it is checked before "Clean game" because a legend game without moments
// is always clean, so in last place it could never apply. "Dropped" names the piece the opponent's best reply wins
// (facts.ts replyLoss), and is not used when the move allowed a forced mate (the reply that "wins a pawn" may be the
// mate itself). A worst moment from the mate rules uses its label like any other.

import { J, moveNo, type JudgementCode } from "../codec";
import { APOS, article, PIECE_NAME, play, replyLoss, settleTrade, tradePhrase, value } from "./facts";

export const HEADLINE_MAX = 80;

export interface HeadlineInput {
  isClean: boolean;
  startPly: number;
  /** The worst moment (moments.ts worstMoment) with its position, or null. */
  worst: {
    ply: number;
    code: JudgementCode;
    fill: boolean;
    fenBefore: string;
    playedUci: string;
    bestUci: string | null;
    replyUci: string | null;
    /** The position after the move is a forced mate against the member (a "dropped piece" would understate it). */
    mateAgainst: boolean;
  } | null;
  /** Number of fill moments when every moment is a fill. */
  fillCount: number;
  /** A legend game: its short name, whether the member followed it, and where the member left it. */
  legend: { name: string; followed: boolean; userDivergencePly: number | null } | null;
}

function cap(s: string): string {
  return s.length <= HEADLINE_MAX ? s : `${s.slice(0, HEADLINE_MAX - 1)}…`;
}

export function headlineText(h: HeadlineInput): string {
  if (h.legend) {
    if (h.isClean && h.legend.followed) return cap(`Played like ${h.legend.name}`);
    if (h.isClean && h.legend.userDivergencePly !== null) {
      return cap(`Left ${h.legend.name}${APOS}s path · move ${moveNo(h.legend.userDivergencePly, h.startPly)}`);
    }
  }
  const w = h.worst;
  if (h.isClean || !w) return "Clean game";
  const n = moveNo(w.ply, h.startPly);
  if (w.fill) return h.fillCount === 1 ? "1 inaccuracy" : `${h.fillCount} inaccuracies`;
  const bestSan = w.bestUci ? (play(w.fenBefore, w.bestUci)?.move.san ?? null) : null;
  if (w.code === J.MISS) return bestSan ? cap(`Missed ${bestSan} · move ${n}`) : `Missed chance · move ${n}`;
  if (w.code === J.BLUNDER) {
    const r = replyLoss(w.fenBefore, w.playedUci, w.replyUci);
    if (!w.mateAgainst && r && r.net >= 1) {
      // "Dropped" for one piece given for at most a pawn (the archive's "Dropped a bishop"); a bigger trade names what
      // came back ("Lost the queen for a knight and a pawn"), from every piece both sides took (regression:
      // headline-ignores-recapture, FIX-2).
      const t = settleTrade(r.lostPieces, r.gainedPieces);
      const back = t.gained.reduce((sum, p) => sum + value(p), 0);
      if (t.lost.length === 1 && back <= 1) return `Dropped ${article(PIECE_NAME[t.lost[0]!])} · move ${n}`;
      const trade = tradePhrase(r.lostPieces, r.gainedPieces);
      if (trade) return cap(`Lost ${trade} · move ${n}`);
    }
    return `Blunder · move ${n}`;
  }
  if (w.code === J.MISTAKE) return `Mistake · move ${n}`;
  return `Inaccuracy · move ${n}`;
}
