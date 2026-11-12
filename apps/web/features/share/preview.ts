// The share preview card's model (phase-03 plan §4.3 preview card, §11.3 masking; board V3RvShare). Pure: no React,
// no zod. The share screen builds it from the review payload; the public page `/r/<code>` (WP-G) can build the same
// card from the frozen snapshot (`ShareSnapshotV1`: players, accuracy, moment{ply, playedSan, bestSan, judgement,
// caption, arrow}), because both follow the same rules:
// - names: with Show My Username the sharer's name and rating; without it "A Replay Chess player". The opponent's
//   name shows only for a bot, a legend or an external player; a member opponent is "Opponent (1203)" (§11.3);
// - the key moment: the moment with the largest Win% loss (the worst one), or the best decision of a clean game;
// - the caption: the moment's first "why" sentence (engine facts only, never invented).

import type { MomentDTO, PlayerCard, ReviewDTO } from "@repo/contracts/http/review";
import type { JudgementKey } from "@repo/chess-analysis/codec";

export const ANON_PLAYER = "A Replay Chess player";

export interface SharePreviewModel {
  /** "knightowl_88 vs tal_fan_77" with §11.3 masking applied. */
  title: string;
  /** "Rapid 10+0 · 0–1". */
  meta: string;
  accuracy: number | null;
  /** "Key moment: 19.Qd2. Rxf5 wins the bishop on f5." / "Best decision: 16.Qb8+, …". */
  caption: string | null;
  /** The board: the position after the key move, its from/to, the best move's arrow and the badge. */
  board: {
    ply: number;
    lastMove: [string, string] | null;
    arrow: [string, string] | null;
    badge: { sq: string; kind: JudgementKey } | null;
  } | null;
  /** The board's accessible name: "Key moment: 19.Qd2, marked Miss. Arrow shows Rxf5." */
  boardLabel: string;
}

/** The sharer's shown name (§11.3). */
export function sharerName(card: Pick<PlayerCard, "name" | "rating">, showUsername: boolean): string {
  if (!showUsername) return ANON_PLAYER;
  return card.name;
}

/** The opponent's shown name (§11.3): bots, legends and external players by name; members as "Opponent (1203)". */
export function opponentName(card: Pick<PlayerCard, "name" | "rating" | "kind">): string {
  if (card.kind === "member") return card.rating !== null ? `Opponent (${card.rating})` : "Opponent";
  return card.name;
}

/** "0–1" from a PGN result (en dash, ½ for draws). */
export function resultLabel(result: ReviewDTO["game"]["result"]): string {
  switch (result) {
    case "1-0":
      return "1–0";
    case "0-1":
      return "0–1";
    case "1/2-1/2":
      return "½–½";
    default:
      return "*";
  }
}

/** The card's key moment: the largest Win% loss, the earliest on a tie. */
export function shareMomentOf(moments: readonly MomentDTO[]): MomentDTO | null {
  let best: MomentDTO | null = null;
  for (const m of moments) {
    if (!best || m.winBefore - m.winAfter > best.winBefore - best.winAfter) best = m;
  }
  return best;
}

const LABEL: Record<JudgementKey, string> = {
  brilliant: "Brilliant",
  great: "Great",
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  book: "Book",
  forced: "Forced",
  interesting: "Interesting",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  miss: "Miss",
  blunder: "Blunder",
};

/** The preview card of a review payload. `moves` (UCI) and `bestPlyMove` come from the replayed game. */
export function sharePreviewFromReview(
  dto: Pick<ReviewDTO, "you" | "players" | "game" | "analysis" | "review" | "moves">,
  showUsername: boolean,
): SharePreviewModel {
  const me = dto.players[dto.you];
  const them = dto.players[dto.you === "w" ? "b" : "w"];
  const meta = [dto.game.tc.label, resultLabel(dto.game.result)].filter(Boolean).join(" · ");
  const title = `${sharerName(me, showUsername)} vs ${opponentName(them)}`;
  const accuracy = dto.analysis?.accuracy[dto.you] ?? null;
  const uci = dto.moves.trim() === "" ? [] : dto.moves.trim().split(/\s+/);
  const pair = (u: string | undefined): [string, string] | null => (u && u.length >= 4 ? [u.slice(0, 2), u.slice(2, 4)] : null);

  const moment = dto.review ? shareMomentOf(dto.review.moments) : null;
  if (moment) {
    const lead = `Key moment: ${moment.moveLabel}${moment.playedSan}.`;
    const why = moment.why[0]?.t ?? null;
    return {
      title,
      meta,
      accuracy,
      caption: why ? `${lead} ${why}` : lead,
      board: {
        ply: moment.ply,
        lastMove: pair(moment.playedUci),
        arrow: pair(moment.bestUci),
        badge: { sq: moment.playedUci.slice(2, 4), kind: moment.judgement },
      },
      boardLabel: `Key moment: ${moment.moveLabel}${moment.playedSan}, marked ${LABEL[moment.judgement]}. Arrow shows ${moment.bestSan}.`,
    };
  }
  const bestPly = dto.review?.bestPly ?? null;
  if (dto.review?.isClean && bestPly !== null && uci[bestPly]) {
    const j = dto.analysis?.j.charAt(bestPly) ?? "";
    const kind: JudgementKey = j === "B" ? "brilliant" : j === "G" ? "great" : "best";
    return {
      title,
      meta,
      accuracy,
      caption: dto.review.bestDecision,
      board: { ply: bestPly, lastMove: pair(uci[bestPly]), arrow: null, badge: { sq: uci[bestPly]!.slice(2, 4), kind } },
      boardLabel: `Best decision. ${dto.review.bestDecision ?? ""}`.trim(),
    };
  }
  return { title, meta, accuracy, caption: null, board: null, boardLabel: "Final position" };
}
