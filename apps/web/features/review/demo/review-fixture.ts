// The ReviewDTO behind each /dev/ui/review state (phase-03 plan §4.10), from the contract fixtures (the design's GAME
// and CLEAN games). Each state is one consistent game (round 2 of the UI review, FIX-2): the summary, the counts, the
// badges and the accuracy bar say what is true of the board on screen. Pure: tested in review-fixture.test.ts.
import { GAME, reviewFixture, type ReviewFixtureState } from "@repo/contracts/http/fixtures/review";
import { J_CHARS, JUDGEMENT_CODE_COUNT, type ReviewDTO } from "@repo/contracts/http/review";
import type { ReviewDemoState } from "./states";
import { stressReview } from "./stress";

const BASE: Partial<Record<ReviewDemoState, ReviewFixtureState>> = {
  analysing: "running",
  writing: "running",
  summary: "done",
  moves: "done",
  no_moments: "done",
  moment: "done",
  clean_loss: "clean",
};

/** The plan's sentences (CA/src/text): the same strings the worker writes. */
const NOTHING_TO_FIX = "Nothing big to fix in this one.";
const CLEAN_LOSS_LINE = "You kept the balance; the result came from elsewhere.";
const sentence = (t: string) => ({ t, v: false });
/** Black's 16…Nxb8 of the Opera Game: the losing side's best decision in the clean demo. */
const CLEAN_LOSS_BEST_PLY = 31;

/** A game too short to review (fewer than ANALYSIS_MIN_PLIES): 1.e4 e5 2.Nf3 Nc6, then White resigned. */
function skippedGame(dto: ReviewDTO): Pick<ReviewDTO, "moves" | "san" | "clocks" | "game"> {
  const plies = 4;
  return {
    moves: dto.moves.split(" ").filter(Boolean).slice(0, plies).join(" "),
    san: dto.san.split(" ").slice(0, plies).join(" "),
    clocks: dto.clocks.slice(0, plies),
    game: { ...dto.game, result: "0-1", endLabel: "0–1 resigned" },
  };
}

/** The side to move at ply i of a game from the initial position (the fixtures' games). */
const sideAt = (i: number): "w" | "b" => (i % 2 === 0 ? "w" : "b");

/** The viewer's mistake (M), miss (S) and blunder (X) grades as good (g); every other grade is kept. */
function noMomentJudgements(j: string, you: "w" | "b"): string {
  return [...j].map((ch, i) => (sideAt(i) === you && "MSX".includes(ch) ? "g" : ch)).join("");
}

/** `analysis.counts` of one side from the `j` string (index = J_CHARS position; `.` = ungraded). */
function countsOfSide(j: string, side: "w" | "b"): number[] {
  const out = new Array<number>(JUDGEMENT_CODE_COUNT).fill(0);
  [...j].forEach((ch, i) => {
    if (sideAt(i) === side) out[Math.max(0, J_CHARS.indexOf(ch))]! += 1;
  });
  return out;
}

export function reviewDemoFixture(state: ReviewDemoState, stress: boolean, side: "w" | "b"): ReviewDTO {
  if (stress && (state === "done" || state === "summary" || state === "moves" || state === "moment")) return stressReview(side);
  const base: ReviewFixtureState = BASE[state] ?? (state as ReviewFixtureState);
  const dto = reviewFixture(base);
  if (state === "writing" && dto.analysis) {
    dto.analysis = { ...dto.analysis, gradedPlies: GAME.plies, evals: [...GAME.evals], best: GAME.best, j: GAME.j };
  }
  // Each demo state is one consistent game (round 2 of the UI review, FIX-2): what the summary, the counts and the
  // accuracy bar say must be true of the board on screen.
  if (state === "skipped") Object.assign(dto, skippedGame(dto));
  if (state === "no_moments" && dto.review && dto.analysis) {
    // No moments and not clean: the viewer's mistakes, misses and blunders become good moves, so only the two
    // inaccuracies are left (badges, counts and summary agree), nothing worth a second look.
    const j = noMomentJudgements(dto.analysis.j, dto.you);
    dto.analysis = { ...dto.analysis, j, counts: { ...dto.analysis.counts, [dto.you]: countsOfSide(j, dto.you) } };
    const acc = dto.analysis.accuracy;
    dto.review = {
      ...dto.review,
      moments: [],
      isClean: false,
      headline: "2 inaccuracies",
      summary: [
        sentence(`You played at ${acc[dto.you]} accuracy; your opponent at ${acc[dto.you === "w" ? "b" : "w"]}.`),
        sentence(NOTHING_TO_FIX),
      ],
      coachLine: sentence(NOTHING_TO_FIX),
    };
  }
  if (state === "clean_loss" && dto.review && dto.analysis) {
    // The clean game seen from the side that lost (Black in the Opera Game): its own accuracy and best decision.
    dto.you = "b";
    dto.players = { w: { ...dto.players.b, isYou: false }, b: { ...dto.players.w, isYou: true } };
    const acc = dto.analysis.accuracy;
    dto.review = {
      ...dto.review,
      summary: [sentence(`You played at ${acc.b} accuracy; your opponent at ${acc.w}.`), sentence(CLEAN_LOSS_LINE)],
      coachLine: sentence(CLEAN_LOSS_LINE),
      bestPly: CLEAN_LOSS_BEST_PLY,
      bestDecision: `Your best decision: 16…${dto.san.split(" ")[CLEAN_LOSS_BEST_PLY]}.`,
    };
  }
  if (stress) {
    // The analysing / failed / clean states keep their fixture data with the stress names and the longest opening.
    dto.players = {
      w: { ...dto.players.w, name: "Maximilian_Oberhaus2", initials: "MA" },
      b: { ...dto.players.b, name: "Alexandra_Kowalczyk9", initials: "AL" },
    };
    dto.game = {
      ...dto.game,
      tc: { ...dto.game.tc, label: "Classical 90+30" },
      opening: { eco: "D37", name: "Queen's Gambit Declined: Harrwitz Attack, Main Line, Fianchetto Defence, Karpov–Kasparov" },
    };
  }
  return dto;
}

/** The view store's moment sub-state for `?phase=` (a wrong try is Nd5-like: the first legal move not in `accept`). */
