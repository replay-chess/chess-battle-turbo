// The frozen public payload of a review share (phase-03 plan §6.6 ShareSnapshotV1, §11.3 "Public share privacy").
// Pure: a done ReviewDTO in, the snapshot out. The public page `/r/<code>` and its image read nothing but this, so
// everything a stranger may see is decided here, once, at creation (and the sharer's name again on the username
// toggle, A11).
//
// Masking (§11.3):
// - the sharer: name and rating with Show My Username on; "A Replay Chess player" and no rating with it off;
// - the opponent: the name shows only for a bot, a legend or an external player of an imported game (public on
//   Chess.com / Lichess); a Replay Chess member shows as "Opponent" with their rating (until P10's visibility
//   setting), whatever the toggle says;
// - never: user refs, emails, clocks, the game ref, chessPositionId, ids of any kind.
import { moveLabel } from "@repo/chess-analysis/codec";
import { J_CHARS, type MomentDTO, type PlayerCard, type ReviewDTO } from "@repo/contracts/http/review";
import { buildShareSnapshot, type ShareSnapshotV1 } from "@repo/db/json";

export const ANONYMOUS_SHARER = "A Replay Chess player";
export const MASKED_OPPONENT = "Opponent";
/** ShareSnapshotV1 limits (DB/src/json/share.ts). */
const NAME_MAX = 40;
const CAPTION_MAX = 200;
const SUMMARY_MAX = 4;
const SENTENCE_MAX = 400;

export type SnapshotPlayer = ShareSnapshotV1["players"]["w"];

/** True when the opponent's own name may appear on a public page. */
export function opponentNameIsPublic(kind: PlayerCard["kind"]): boolean {
  return kind === "bot" || kind === "legend" || kind === "external";
}

/** The sharer's public entry. `isYou` stays true: the page says "you" only to the owner (it never knows who views). */
export function sharerEntry(card: Pick<PlayerCard, "name" | "rating">, showUsername: boolean): SnapshotPlayer {
  return showUsername
    ? { name: card.name.slice(0, NAME_MAX), rating: card.rating, isYou: true }
    : { name: ANONYMOUS_SHARER, rating: null, isYou: true };
}

/** The opponent's public entry: unaffected by the toggle (a member opponent is always masked). */
export function opponentEntry(card: Pick<PlayerCard, "name" | "rating" | "kind">): SnapshotPlayer {
  return opponentNameIsPublic(card.kind)
    ? { name: card.name.slice(0, NAME_MAX), rating: card.rating, isYou: false }
    : { name: MASKED_OPPONENT, rating: card.rating, isYou: false };
}

/** Both public entries by colour, from the review's player cards (`you` = the sharer's colour). */
export function snapshotPlayers(dto: Pick<ReviewDTO, "players" | "you">, showUsername: boolean): ShareSnapshotV1["players"] {
  const opp = dto.you === "w" ? "b" : "w";
  const you = sharerEntry(dto.players[dto.you], showUsername);
  const them = opponentEntry(dto.players[opp]);
  return dto.you === "w" ? { w: you, b: them } : { w: them, b: you };
}

/** Replaces only the sharer's entry of a stored snapshot (A11's username toggle; the rest stays frozen). */
export function withSharerName(
  snapshot: ShareSnapshotV1,
  color: "w" | "b",
  sharer: Pick<PlayerCard, "name" | "rating">,
  showUsername: boolean,
): ShareSnapshotV1 {
  return buildShareSnapshot({ ...snapshot, players: { ...snapshot.players, [color]: sharerEntry(sharer, showUsername) } });
}

const PGN_RESULT: Record<ReviewDTO["game"]["result"], string> = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½", "*": "*" };

/** The moment's arrow: the engine's move (a mistake moment) as two squares. */
function squaresOf(uci: string): [string, string] | null {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? [uci.slice(0, 2), uci.slice(2, 4)] : null;
}

function judgementCodeOf(j: string, ply: number): number {
  const code = J_CHARS.indexOf(j.charAt(ply));
  return code >= 1 ? code : 0;
}

/** "19.Qd2: Rxf5 was the engine's move." when the moment has no reason sentence. */
function fallbackCaption(m: MomentDTO): string {
  return `${m.moveLabel}${m.playedSan}: ${m.bestSan} was the engine’s move.`;
}

/** The worst moment: the largest Win% drop, the earlier one on a tie. */
export function worstMoment(moments: readonly MomentDTO[]): MomentDTO | null {
  let worst: MomentDTO | null = null;
  for (const m of moments) {
    if (!worst || m.winBefore - m.winAfter > worst.winBefore - worst.winAfter) worst = m;
  }
  return worst;
}

export class UnknownMomentError extends Error {
  constructor(readonly ply: number) {
    super(`ply ${ply} is not a key moment or the best decision of this review`);
    this.name = "UnknownMomentError";
  }
}

/** The plies a share card may show: the key moments, or a clean game's best decision. */
export function shareablePlies(dto: Pick<ReviewDTO, "review">): number[] {
  const review = dto.review;
  if (!review) return [];
  const plies = review.moments.map((m) => m.ply);
  if (review.isClean && review.bestPly !== null) plies.push(review.bestPly);
  return plies;
}

/** The card's moment: `momentPly` when given (it must be shareable), else the worst moment, else the best decision. */
export function snapshotMoment(dto: ReviewDTO, momentPly: number | undefined): ShareSnapshotV1["moment"] {
  const review = dto.review;
  const analysis = dto.analysis;
  if (!review || !analysis) return null;
  const sans = dto.san === "" ? [] : dto.san.split(" ");
  const ucis = dto.moves === "" ? [] : dto.moves.split(" ");
  if (momentPly !== undefined && !shareablePlies(dto).includes(momentPly)) throw new UnknownMomentError(momentPly);
  const chosen = momentPly !== undefined ? review.moments.find((m) => m.ply === momentPly) : worstMoment(review.moments);
  if (chosen) {
    const arrow = squaresOf(chosen.bestUci);
    const judgement = judgementCodeOf(analysis.j, chosen.ply);
    if (!arrow || judgement === 0) return null;
    return {
      ply: chosen.ply,
      playedSan: chosen.playedSan.slice(0, 10),
      bestSan: chosen.bestSan.slice(0, 10),
      judgement,
      caption: (chosen.why[0]?.t ?? fallbackCaption(chosen)).slice(0, CAPTION_MAX),
      arrow,
    };
  }
  const best = review.isClean ? review.bestPly : null;
  if (best === null || (momentPly !== undefined && momentPly !== best)) return null;
  const san = sans[best];
  const arrow = squaresOf(ucis[best] ?? "");
  const judgement = judgementCodeOf(analysis.j, best);
  if (!san || !arrow || judgement === 0) return null;
  return {
    ply: best,
    playedSan: san.slice(0, 10),
    bestSan: san.slice(0, 10),
    judgement,
    caption: (review.bestDecision ?? `${moveLabel(best, dto.game.startPly)}${san} was your best decision.`).slice(0, CAPTION_MAX),
    arrow,
  };
}

/**
 * Builds and validates the snapshot of a done review. Throws UnknownMomentError for a `momentPly` that is not
 * shareable, and an Error for a review that is not done (the service checks that first: 409 analysis_not_done).
 */
export function buildReviewSnapshot(dto: ReviewDTO, opts: { showUsername: boolean; momentPly?: number }): ShareSnapshotV1 {
  const analysis = dto.analysis;
  const review = dto.review;
  if (dto.status !== "done" || !analysis || !review) throw new Error("buildReviewSnapshot: the review is not done");
  const opp = dto.you === "w" ? "b" : "w";
  return buildShareSnapshot({
    v: 1,
    kind: "review",
    players: snapshotPlayers(dto, opts.showUsername),
    result: PGN_RESULT[dto.game.result],
    endLabel: dto.game.endLabel.slice(0, 40),
    tcLabel: dto.game.tc.label.slice(0, 24),
    playedOn: dto.game.playedAt.slice(0, 10),
    startFen: dto.game.startFen,
    moves: dto.moves,
    san: dto.san,
    j: analysis.j,
    evals: analysis.evals,
    accuracy: { you: analysis.accuracy[dto.you], opp: analysis.accuracy[opp] },
    moment: snapshotMoment(dto, opts.momentPly),
    summary: review.summary.slice(0, SUMMARY_MAX).map((s) => s.t.slice(0, SENTENCE_MAX)),
    gradingVersion: analysis.version,
  });
}
