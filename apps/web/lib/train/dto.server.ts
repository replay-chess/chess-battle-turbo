// Row → DTO mappers of the Train services (phase-05 plan §7.1, §7.3, §8.12, §8.14). Pure: rows in (the column lists
// below), contract shapes out (@repo/contracts/http/train). Only refs and item keys leave the server; BigInt ids never
// do. Every label is formatted here in the viewer's zone (`@repo/chess-training/labels`), so SSR and hydration agree.
//
// Board conventions: a bank position is stored Lichess-style (`mistakes.fen` before the opponent's setup move, plus
// `setupUci`); the wire shows the position the member moves in (setup applied) with the setup as `lastMove`. A puzzle
// travels as the Lichess FEN with `setup: [opponentMove]` (the runner auto-plays it).
import { Prisma } from "@repo/db";
import type { PuzzleSnapshotV1 } from "@repo/db/json";
import type {
  BankRow,
  GradePreviews,
  ItemKind,
  JudgementW,
  LastMove,
  PhaseW,
  TrainItem,
} from "@repo/contracts/http/train";
import { explainItem, type ExplainKind } from "@repo/chess-training/explain";
import { newCardRow, previewAfterAgain, previewAll, type CardRow, type SchedulePrefs } from "@repo/chess-training/fsrs";
import { dayLabel, playedAtLabel } from "@repo/chess-training/labels";
import type { CardState } from "@repo/chess-training/mastery";
import { themeLabel } from "@repo/chess-training/themes";
import { Chess } from "chess.js";
import { LRUCache } from "lru-cache";
import { asDate, num } from "./db.server";

// ── Wire enums ──────────────────────────────────────────────────────────────────────────────────────────────────
export type JudgementDb = "INACCURACY" | "MISTAKE" | "MISS" | "BLUNDER";
export type PhaseDb = "OPENING" | "MIDDLEGAME" | "ENDGAME";
export type SourceDb = "OWN_ERROR" | "MISSED_PUNISH";
export type ItemKindDb = "MISTAKE" | "REVIEW_POSITION" | "LICHESS_PUZZLE" | "OPENING_LINE";
export type DeckDb = "BANK" | "PUZZLE" | "OPENING";
export type GradeDb = "AGAIN" | "HARD" | "GOOD" | "EASY";

export function judgementWire(j: string): JudgementW {
  switch (j) {
    case "INACCURACY":
      return "inaccuracy";
    case "MISS":
      return "miss";
    case "BLUNDER":
      return "blunder";
    default:
      return "mistake";
  }
}

export const phaseWire = (p: string | null | undefined): PhaseW =>
  p === "OPENING" ? "opening" : p === "ENDGAME" ? "endgame" : "middlegame";
export const phaseDb = (p: PhaseW): PhaseDb => (p === "opening" ? "OPENING" : p === "endgame" ? "ENDGAME" : "MIDDLEGAME");
export const sourceWire = (s: string): "own" | "missed" => (s === "MISSED_PUNISH" ? "missed" : "own");
export const sourceDb = (s: "own" | "missed"): SourceDb => (s === "missed" ? "MISSED_PUNISH" : "OWN_ERROR");

const KIND_WIRE: Record<ItemKindDb, ItemKind> = {
  MISTAKE: "mistake",
  REVIEW_POSITION: "review_position",
  LICHESS_PUZZLE: "puzzle",
  OPENING_LINE: "opening_line",
};
export const itemKindWire = (k: string): ItemKind => KIND_WIRE[k as ItemKindDb] ?? "mistake";
export const itemKindDb = (k: ItemKind): ItemKindDb =>
  k === "review_position" ? "REVIEW_POSITION" : k === "puzzle" ? "LICHESS_PUZZLE" : k === "opening_line" ? "OPENING_LINE" : "MISTAKE";
export const gradeDb = (g: "again" | "hard" | "good" | "easy"): GradeDb => g.toUpperCase() as GradeDb;
export const gradeWire = (g: string): "again" | "hard" | "good" | "easy" => g.toLowerCase() as "again" | "hard" | "good" | "easy";

/** `["e2","e4"]` from a UCI move; null for a missing or malformed one. */
export function lastMoveOf(uci: string | null | undefined): LastMove | null {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

const splitUci = (line: string | null | undefined): string[] => (line ?? "").trim().split(/\s+/).filter(Boolean);

// ── Positions ───────────────────────────────────────────────────────────────────────────────────────────────────
const afterSetupMemo = new LRUCache<string, string>({ max: 2_000 });

/** The position after `uci` is played from `fen` (the bank's "position the member moves in"); `fen` when no setup. */
export function positionAfter(fen: string, uci: string | null | undefined): string {
  if (!uci) return fen;
  const key = `${fen}|${uci}`;
  const hit = afterSetupMemo.get(key);
  if (hit) return hit;
  const chess = new Chess(fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  const out = chess.fen();
  afterSetupMemo.set(key, out);
  return out;
}

/** SAN of one move from a position (`playedSan`); the UCI itself when chess.js rejects it. */
export function sanOf(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined }).san;
  } catch {
    return uci;
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The card columns every card read selects (alias `c`). */
export const CARD_COLUMNS = Prisma.sql`
  c.id AS "cardId", c."itemKey", c.deck::text AS deck, c.kind::text AS kind, c."mistakeId", c."puzzleId",
  c.fen AS "cardFen", c.solution AS "cardSolution", c.orient AS "cardOrient", c."puzzleRating", c.theme,
  c.phase::text AS "cardPhase", c.due, c.stability, c.difficulty, c."elapsedDays", c."scheduledDays",
  c."learningSteps", c.reps, c.lapses, c.state::text AS state, c."lastReview", c.mastery, c."suspendedUntil"`;

/** The mistake columns (alias `m`, games alias `g` for the last game's ref); every one is null for a puzzle card. */
export const MISTAKE_COLUMNS = Prisma.sql`
  m."referenceId" AS "mistakeRef", m.color, m.fen, m."setupUci", m.solution, m.accept, m."playedUci", m."refuteUci",
  m.judgement::text AS judgement, m.source::text AS source, m."isPuzzle", m."primaryTheme", m.phase::text AS phase,
  m."cpBest", m."mateBest", m."moveNumber", m.occurrences, m."lastPly", m."lastPlayedAt", m."lastOpponentName",
  m."hiddenAt", g."referenceId" AS "gameRef"`;

export type CardCols = {
  cardId: bigint;
  itemKey: string;
  deck: DeckDb;
  kind: ItemKindDb;
  mistakeId: bigint | null;
  puzzleId: string | null;
  cardFen: string | null;
  cardSolution: string | null;
  cardOrient: string | null;
  puzzleRating: number | null;
  theme: string;
  cardPhase: PhaseDb | null;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: Date | null;
  mastery: number;
  suspendedUntil: Date | null;
};

export type MistakeCols = {
  mistakeRef: string | null;
  color: string | null;
  fen: string | null;
  setupUci: string | null;
  solution: string | null;
  accept: string | null;
  playedUci: string | null;
  refuteUci: string | null;
  judgement: string | null;
  source: string | null;
  isPuzzle: boolean | null;
  primaryTheme: string | null;
  phase: string | null;
  cpBest: number | null;
  mateBest: number | null;
  moveNumber: number | null;
  occurrences: number | null;
  lastPly: number | null;
  lastPlayedAt: Date | null;
  lastOpponentName: string | null;
  hiddenAt: Date | null;
  gameRef: string | null;
};

export type CardRowDb = CardCols & MistakeCols;

/** The FSRS columns of a card row (driver values normalised). */
export function cardRowOf(
  r: Pick<CardCols, "due" | "stability" | "difficulty" | "elapsedDays" | "scheduledDays" | "learningSteps" | "reps" | "lapses" | "state" | "lastReview"> &
    Partial<Pick<CardCols, "itemKey">>,
): CardRow {
  return {
    // The card's identity seeds the FSRS fuzz: the buttons built here and the W1 grade agree (FIX-1 fuzz).
    ...(r.itemKey ? { fuzzKey: r.itemKey } : {}),
    due: asDate(r.due)!,
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    elapsedDays: num(r.elapsedDays),
    scheduledDays: num(r.scheduledDays),
    learningSteps: num(r.learningSteps),
    reps: num(r.reps),
    lapses: num(r.lapses),
    state: r.state,
    lastReview: asDate(r.lastReview),
  };
}

/** A card's due counts only when it is not skipped for today. */
export function isSkipped(r: Pick<CardCols, "suspendedUntil">, now: Date): boolean {
  const s = asDate(r.suspendedUntil);
  return s !== null && s.getTime() > now.getTime();
}

export function isDueNow(r: Pick<CardCols, "due" | "suspendedUntil">, now: Date): boolean {
  return asDate(r.due)!.getTime() <= now.getTime() && !isSkipped(r, now);
}

/** "today", "yesterday", "Oct 27" for a mistake's last occurrence. */
export function playedWhen(r: Pick<MistakeCols, "lastPlayedAt">, now: Date, timeZone: string): string {
  const at = asDate(r.lastPlayedAt);
  return at ? playedAtLabel(at, now, timeZone) : "today";
}

/** One Mistake Bank row (strict: no solution, no best move). Null for a row whose last game is gone. */
export function bankRowOf(r: CardRowDb, now: Date, timeZone: string): BankRow | null {
  if (!r.mistakeRef || !r.fen || !r.playedUci || !r.gameRef) return null;
  const fen = positionAfter(r.fen, r.setupUci);
  const due = asDate(r.due)!;
  const skipped = isSkipped(r, now);
  const isDue = due.getTime() <= now.getTime() && !skipped;
  const nextAt = skipped ? new Date(Math.max(due.getTime(), asDate(r.suspendedUntil)!.getTime())) : due;
  return {
    cardRef: r.itemKey,
    fen,
    orient: r.color === "b" ? "b" : "w",
    lastMove: lastMoveOf(r.setupUci),
    theme: { key: r.theme, label: themeLabel(r.theme) },
    judgement: judgementWire(r.judgement ?? "MISTAKE"),
    playedSan: sanOf(fen, r.playedUci).slice(0, 10),
    moveNo: Math.max(1, num(r.moveNumber)),
    opponent: (r.lastOpponentName ?? "").slice(0, 40),
    playedAtLabel: playedWhen(r, now, timeZone),
    phase: phaseWire(r.cardPhase ?? r.phase),
    source: sourceWire(r.source ?? "OWN_ERROR"),
    mastery: Math.min(5, Math.max(0, num(r.mastery))),
    isDue,
    nextLabel: isDue ? null : dayLabel(nextAt, now, timeZone),
    skippedToday: skipped,
    occurrences: Math.max(1, num(r.occurrences)),
    gameRef: r.gameRef,
    gamePly: r.lastPly === null || r.lastPly === undefined ? null : num(r.lastPly),
  };
}

// ── Session items ──────────────────────────────────────────────────────────────────────────────────────────────
/** What a session item's board needs, whatever its source (a bank card, a puzzle card, or a shard snapshot). */
export type ItemSource =
  | { kind: "bank"; card: CardRowDb }
  | { kind: "puzzle"; card: CardRowDb | null; snapshot: PuzzleSnapshotV1 };

export type ItemBuild = {
  itemId: string;
  pass: 1 | 2;
  /** False for a practice item (no previews, no FSRS effect). */
  scheduled: boolean;
  source: ItemSource;
};

const PUZZLE_SOURCE_LABEL = "Lichess puzzle · matched to your rating";

/** The Lichess puzzle's solver: the side NOT to move in the Lichess FEN (the setup move is the opponent's). */
function solverOf(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "w" ? "b" : "w";
}

function previewsFor(card: CardRow, pass: 1 | 2, scheduled: boolean, now: Date, prefs: SchedulePrefs): { preview: GradePreviews | null; afterAgain: GradePreviews | null } {
  if (!scheduled) return { preview: null, afterAgain: null };
  return { preview: previewAll(card, now, prefs), afterAgain: pass === 1 ? previewAfterAgain(card, now, prefs) : null };
}

/**
 * A runner item (§7.1 TrainItem): board, solution, coach texts (§8.12, computed at read time) and the four real FSRS
 * intervals (and the after-Again ones, so ts-fsrs never ships to the client). Throws for a corrupt row (the caller
 * drops the item).
 */
export function trainItemOf(b: ItemBuild, now: Date, timeZone: string, prefs: SchedulePrefs): TrainItem {
  if (b.source.kind === "bank") {
    const r = b.source.card;
    if (!r.fen || !r.solution || !r.playedUci) throw new Error(`train item ${r.itemKey}: the mistake row is missing`);
    const fen = positionAfter(r.fen, r.setupUci);
    const solution = splitUci(r.solution);
    const kind = r.kind === "REVIEW_POSITION" ? "review_position" : "mistake";
    const texts = explainItem({
      fen,
      solution,
      playedUci: r.playedUci,
      refuteUci: r.refuteUci,
      cpBest: r.cpBest,
      mateBest: r.mateBest,
      theme: r.theme,
      kind: kind as ExplainKind,
    });
    const card = cardRowOf(r);
    const { preview, afterAgain } = previewsFor(card, b.pass, b.scheduled, now, prefs);
    const opponent = (r.lastOpponentName ?? "").slice(0, 40);
    const when = playedWhen(r, now, timeZone);
    const moveNo = Math.max(1, num(r.moveNumber));
    const playedSan = sanOf(fen, r.playedUci).slice(0, 10);
    return {
      itemId: b.itemId,
      kind,
      pass: b.pass,
      cardRef: r.itemKey,
      puzzleId: null,
      fen,
      setup: [],
      lastMove: lastMoveOf(r.setupUci),
      solution: solution.slice(0, 15),
      accept: splitUci(r.accept).slice(0, 6),
      orient: r.color === "b" ? "b" : "w",
      theme: { key: r.theme, label: themeLabel(r.theme) },
      rating: null,
      sourceLabel: `vs ${opponent} · ${when} · move ${moveNo}`.slice(0, 80),
      context: r.gameRef
        ? {
            gameRef: r.gameRef,
            gamePly: r.lastPly === null || r.lastPly === undefined ? null : num(r.lastPly),
            gameLabel: `Your game vs ${opponent} · ${when} · move ${moveNo}`.slice(0, 120),
            playedUci: r.playedUci,
            playedSan,
            judgement: judgementWire(r.judgement ?? "MISTAKE"),
            costText: (texts.costText ?? `${playedSan} let the advantage go.`).slice(0, 300),
          }
        : null,
      text: {
        hint: texts.hint.slice(0, 300),
        look: null,
        correct: texts.correct.slice(0, 400),
        wrongGameMove: texts.wrongGameMove ? texts.wrongGameMove.slice(0, 400) : null,
        verified: texts.verified,
      },
      preview,
      previewAfterAgain: afterAgain,
      cardReps: num(r.reps),
      mastery: Math.min(5, Math.max(0, num(r.mastery))),
    };
  }
  const { snapshot, card } = b.source;
  const [puzzleId, lichessFen, moves, rating, theme] = snapshot;
  const tokens = splitUci(moves);
  const setup = tokens[0]!;
  const solution = tokens.slice(1);
  const texts = explainItem({ fen: positionAfter(lichessFen, setup), solution, theme, kind: "puzzle" });
  const fsrsCard = card ? cardRowOf(card) : { ...newCardRow(now), fuzzKey: `p_${puzzleId}` };
  const { preview, afterAgain } = previewsFor(fsrsCard, b.pass, b.scheduled, now, prefs);
  return {
    itemId: b.itemId,
    kind: "puzzle",
    pass: b.pass,
    cardRef: card ? card.itemKey : null,
    puzzleId,
    fen: lichessFen,
    setup: [setup],
    lastMove: null,
    solution: solution.slice(0, 15),
    accept: [],
    orient: solverOf(lichessFen),
    theme: { key: theme, label: themeLabel(theme) },
    rating: Math.round(rating),
    sourceLabel: PUZZLE_SOURCE_LABEL,
    context: null,
    text: {
      hint: texts.hint.slice(0, 300),
      look: texts.look ? texts.look.slice(0, 300) : null,
      correct: texts.correct.slice(0, 400),
      wrongGameMove: null,
      verified: texts.verified,
    },
    preview,
    previewAfterAgain: afterAgain,
    cardReps: card ? num(card.reps) : null,
    mastery: card ? Math.min(5, Math.max(0, num(card.mastery))) : null,
  };
}

/** A PUZZLE card's snapshot (fen, "setup best …", rating, theme) as the session JSON stores it. */
export function snapshotOfCard(r: CardRowDb): PuzzleSnapshotV1 | null {
  if (!r.puzzleId || !r.cardFen || !r.cardSolution) return null;
  return [r.puzzleId, r.cardFen, r.cardSolution, num(r.puzzleRating ?? 1500), r.theme];
}
