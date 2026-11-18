// The theme tagger (phase-05 plan §8.11; research R-THM-01…08). Keys are the Lichess puzzle theme keys verbatim, so a
// bank card tagged `fork` matches CC0 `fork` puzzles; own-mistake patterns without a Lichess key use the `rc:` prefix
// (review.ts). Display labels live in @repo/chess-training/themes only, never here.
//
// Every detector is a clean-room implementation of the published theme description (lichess.org/training/themes) or
// of the plan's rule; CLEANROOM.md "P5" lists the sources. Quality bar (§8.11, §12.1): recall ≥ 85 % per Tier-1 theme
// on the committed CC0 fixtures (`@repo/chess-fixtures/puzzles/<theme>.json`, themes.recall.test.ts).
//
// Primary theme priority: mates > fork > pin > skewer > discoveredAttack > doubleCheck > hangingPiece > trappedPiece >
// capturingDefender > other tactics > rc:* > endgame signatures > phase. Meta tags (length, eval) are never primary;
// every position has a phase tag, so there is always a primary theme.
import { backRankThemes } from "./backRank";
import { ERROR_THEMES_MAX, evalFor, isMateEval, mateMoves } from "../codec";
import { WIN_CP_CLAMP } from "../winpct";
import { buildContext, type ThemeInput } from "./context";
import { discoveredThemes } from "./discovered";
import { endgameThemes } from "./endgame";
import { isFork } from "./fork";
import { hangingThemes } from "./hanging";
import { kingThemes } from "./king";
import { mateThemes } from "./mate";
import { metaThemes } from "./meta";
import { isPin } from "./pin";
import { pawnThemes } from "./promotion";
import { reviewThemes } from "./review";
import { isSacrifice } from "./sacrifice";
import { isSkewer } from "./skewer";
import { isTrappedPiece } from "./trapped";

export type { ThemeInput } from "./context";
export { phaseOf } from "./endgame";

/**
 * The primary-theme order (index 0 wins): the same order as @repo/chess-training/themes `primaryTheme` (the display
 * side), restricted to the keys this tagger emits; the worker's tests check the two agree.
 */
export const PRIMARY_ORDER: readonly string[] = [
  "smotheredMate",
  "backRankMate",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mateIn4",
  "mateIn5",
  "mate",
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "hangingPiece",
  "trappedPiece",
  "capturingDefender",
  "sacrifice",
  "exposedKing",
  "kingsideAttack",
  "queensideAttack",
  "promotion",
  "underPromotion",
  "advancedPawn",
  "enPassant",
  "castling",
  "rc:recapture",
  "rc:defendedTarget",
  "rc:missedThreat",
  "rc:kingSafety",
  "rc:pawnStructure",
  "rc:development",
  "rookEndgame",
  "pawnEndgame",
  "bishopEndgame",
  "knightEndgame",
  "queenEndgame",
  "queenRookEndgame",
  "endgame",
  "opening",
  "middlegame",
];

/** Tags that are never primary. */
export const META_THEMES: readonly string[] = ["oneMove", "short", "long", "veryLong", "crushing", "advantage", "equality"];

/**
 * Tier-1 detectors gated on recall (≥ 85 % on the committed fixtures). The eval tags (crushing, advantage, equality)
 * are Tier 1 too but need an engine eval the CC0 dump does not carry: they are unit-tested on constructed evals.
 */
export const TIER1_THEMES: readonly string[] = [
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mate",
  "backRankMate",
  "smotheredMate",
  "fork",
  "pin",
  "skewer",
  "hangingPiece",
  "discoveredAttack",
  "doubleCheck",
  "trappedPiece",
  "promotion",
  "sacrifice",
  "exposedKing",
  "kingsideAttack",
  "queensideAttack",
  "advancedPawn",
  "enPassant",
  "castling",
  "rookEndgame",
  "pawnEndgame",
  "queenEndgame",
  "bishopEndgame",
  "knightEndgame",
  "queenRookEndgame",
  "oneMove",
  "short",
  "long",
  "veryLong",
];

export const RC_THEMES = [
  "rc:recapture",
  "rc:defendedTarget",
  "rc:pawnStructure",
  "rc:kingSafety",
  "rc:development",
  "rc:missedThreat",
] as const;

export interface Tagged {
  /** Every detected key, in PRIMARY_ORDER, then the meta tags. */
  themes: string[];
  primary: string;
}

/** The highest-priority non-meta theme of a set. */
export function primaryOf(themes: readonly string[]): string {
  let best: string | null = null;
  let at = Infinity;
  for (const t of themes) {
    const i = PRIMARY_ORDER.indexOf(t);
    if (i >= 0 && i < at) {
      at = i;
      best = t;
    }
  }
  if (best === null) throw new RangeError("no primary theme: a phase tag is always present");
  return best;
}

/** Tags a position and its line (see the header). */
export function tagThemes(input: ThemeInput): Tagged {
  const ctx = buildContext(input);
  const found = new Set<string>([
    ...mateThemes(ctx),
    ...backRankThemes(ctx),
    ...(isFork(ctx) ? ["fork"] : []),
    ...(isPin(ctx) ? ["pin"] : []),
    ...(isSkewer(ctx) ? ["skewer"] : []),
    ...discoveredThemes(ctx),
    ...hangingThemes(ctx),
    ...(isTrappedPiece(ctx) ? ["trappedPiece"] : []),
    ...(isSacrifice(ctx) ? ["sacrifice"] : []),
    ...pawnThemes(ctx),
    ...kingThemes(ctx),
    ...endgameThemes(ctx),
    ...(input.review ? reviewThemes(ctx) : []),
    ...metaThemes(ctx),
  ]);
  const ordered = [
    ...PRIMARY_ORDER.filter((t) => found.has(t)),
    ...META_THEMES.filter((t) => found.has(t)),
  ];
  return { themes: ordered, primary: primaryOf(ordered) };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* One error ply of a member's game (phase-06 plan §8.3.2 step 3): the weakness profile's theme occurrences      */
/* ------------------------------------------------------------------------------------------------------------ */

// ERROR_THEMES_MAX (at most this many themes per error: game_players."errorThemeN" entries are 0…8) is a storage
// limit of the per-side inputs, so it lives with the codec; re-exported here for the tagger's callers.
export { ERROR_THEMES_MAX };

/**
 * Tags the weakness profile never counts: the meta tags (line length and eval band), the three phase tags (the phase
 * is ERROR_LOG_V1's own field) and the generic `mate` (the mateInN / named mates carry the pattern).
 */
export const ERROR_THEMES_DROPPED: ReadonlySet<string> = new Set([...META_THEMES, "opening", "middlegame", "endgame", "mate"]);

export interface ErrorPlyInput {
  /** Position before the member's move. */
  fenBefore: string;
  /** The best line from `fenBefore` (UCI, the member's best move first): the stored pass-2 PV, else the best move. */
  bestLine: readonly string[];
  /** The move the member played. */
  playedUci: string;
  /** The opponent's best reply to the played move (feeds rc:missedThreat), when known. */
  refuteUci?: string | null;
  /** Stored eval of `fenBefore` (White POV, codec.ts encoding): the best play's score. */
  evalBest?: number | null;
  phase: "OPENING" | "MIDDLEGAME" | "ENDGAME";
  /** The opponent's move into `fenBefore` and whether it captured (rc:recapture), when known. */
  setupUci?: string | null;
  setupCaptured?: boolean;
}

/**
 * The themes of one error ply, for `game_players."errorThemes"`: the P5 tagger run exactly as the Mistake Bank runs it
 * on a review position (TRN extract.ts: the same eval, mate and review inputs), so the profile's patterns and the bank
 * filters name the same thing. Returns the tags in PRIMARY_ORDER without ERROR_THEMES_DROPPED, at most
 * ERROR_THEMES_MAX. An error without a known best move has no line to tag and returns []. No detector changes: this
 * is a thin wrapper over tagThemes.
 */
export function tagErrorPly(input: ErrorPlyInput): string[] {
  const line = input.bestLine.filter((m) => m !== "");
  if (line.length === 0) return [];
  const solver = (input.fenBefore.trim().split(/\s+/)[1] === "b" ? "b" : "w") as "w" | "b";
  const e = typeof input.evalBest === "number" && Number.isFinite(input.evalBest) ? evalFor(input.evalBest, solver) : null;
  const mating = e !== null && isMateEval(e);
  const tagged = tagThemes({
    fen: input.fenBefore,
    line,
    setupUci: input.setupUci ?? null,
    setupCaptured: input.setupCaptured ?? false,
    cp: e === null || mating ? null : Math.max(-WIN_CP_CLAMP, Math.min(WIN_CP_CLAMP, e)),
    mateIn: mating && e > 0 ? mateMoves(e) : null,
    review: { playedUci: input.playedUci, refuteUci: input.refuteUci ?? null, pv: line, phase: input.phase },
  });
  return tagged.themes.filter((t) => !ERROR_THEMES_DROPPED.has(t)).slice(0, ERROR_THEMES_MAX);
}
