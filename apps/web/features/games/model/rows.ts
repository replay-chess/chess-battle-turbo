// What an archive row and the aside say (phase-03 plan §4.9 "States", P3-Q14). Pure, client-safe, type-only imports.
import type { GameRowDTO } from "@repo/contracts/http/games";

export type { GameRowDTO };

export type ResultTone = "good" | "bad" | "neutral";

const RESULT_WORD: Record<GameRowDTO["result"], string> = { win: "WIN", loss: "LOSS", draw: "DRAW" };
const RESULT_TONE: Record<GameRowDTO["result"], ResultTone> = { win: "good", loss: "bad", draw: "neutral" };
const RESULT_VERB: Record<GameRowDTO["result"], string> = { win: "won", loss: "lost", draw: "drawn" };

/** The result word in the row's first column (word and colour, never colour alone). */
export function resultWord(result: GameRowDTO["result"]): string {
  return RESULT_WORD[result];
}
export function resultTone(result: GameRowDTO["result"]): ResultTone {
  return RESULT_TONE[result];
}

export type RowNote = {
  text: string;
  /** "Analysing" shows a spinner next to the text. */
  busy: boolean;
  kind: "headline" | "reviewed" | "not_reviewed" | "analysing" | "paused" | "too_short";
};

/**
 * The note line under the opponent:
 * - done: the review headline ("Missed Rxf5 · move 19"), or the accuracy when the review wrote none;
 * - queued / running: "Analysing" with a spinner;
 * - failed: "Analysis paused" (the review offers Retry);
 * - none (a game finished before Phase 3, P3-Q14): "Not reviewed yet" (opening the review queues it);
 * - skipped (fewer than 6 plies, or aborted): "Too short to review" (the review's skipped copy).
 */
export function rowNote(row: Pick<GameRowDTO, "analysisStatus" | "headline" | "accuracy">): RowNote {
  switch (row.analysisStatus) {
    case "done":
      if (row.headline) return { text: row.headline, busy: false, kind: "headline" };
      return {
        text: row.accuracy != null ? `Reviewed · accuracy ${row.accuracy}` : "Reviewed",
        busy: false,
        kind: "reviewed",
      };
    case "queued":
    case "running":
      return { text: "Analysing", busy: true, kind: "analysing" };
    case "failed":
      return { text: "Analysis paused", busy: false, kind: "paused" };
    case "skipped":
      return { text: "Too short to review", busy: false, kind: "too_short" };
    case "none":
      return { text: "Not reviewed yet", busy: false, kind: "not_reviewed" };
  }
}

/** The opening ("Two Knights Defense: Main Line · C59") or the start position's title; null when neither is known. */
export function openingLabel(row: Pick<GameRowDTO, "opening" | "positionTitle">): string | null {
  if (row.positionTitle) return row.positionTitle;
  if (row.opening) return `${row.opening.name} · ${row.opening.eco}`;
  return null;
}

/** The third column: opening or position, then the time control. */
export function contextLine(row: Pick<GameRowDTO, "opening" | "positionTitle" | "tc">): string {
  const opening = openingLabel(row);
  return opening ? `${opening} · ${row.tc.label}` : row.tc.label;
}

const SOURCE_LABEL: Record<GameRowDTO["source"], string> = {
  replay: "Replay Chess",
  chesscom: "Chess.com",
  lichess: "Lichess",
};

export function sourceLabel(source: GameRowDTO["source"]): string {
  return SOURCE_LABEL[source];
}

/** The rating delta column: "—" until P9 fills it; a real minus sign for losses. */
export function ratingDeltaLabel(delta: number | null): string {
  if (delta == null) return "—";
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "0";
}

/** "vs tal_fan_77 · lost" (the aside heading). */
export function asideHeading(row: Pick<GameRowDTO, "opponent" | "result">): string {
  return `vs ${row.opponent.name} · ${RESULT_VERB[row.result]}`;
}

/** "Replay Chess · Rapid 10+0" (the aside overline). */
export function asideOverline(row: Pick<GameRowDTO, "source" | "tc">): string {
  return `${sourceLabel(row.source)} · ${row.tc.label}`;
}

/** The aside's note: the row note, then the opening or position. */
export function asideNote(row: GameRowDTO): string {
  const opening = openingLabel(row);
  const note = rowNote(row).text;
  return opening ? `${note} · ${opening}` : note;
}

/** The aside board's accessible name. */
export function finalPositionLabel(row: Pick<GameRowDTO, "opponent">): string {
  return `Final position vs ${row.opponent.name}`;
}

/** Whether the game has a review to open or queue (`skipped` opens the review's "too short" state, still a page). */
export function isAnalysed(row: Pick<GameRowDTO, "analysisStatus">): boolean {
  return row.analysisStatus === "done";
}

/** Live patches from `analysis:progress` / `analysis:done` (plan §5.1 "Realtime updater"). */
export type RowPatch = Partial<Pick<GameRowDTO, "analysisStatus" | "accuracy" | "headline" | "momentsCount">>;

export function patchRow(row: GameRowDTO, patch: RowPatch): GameRowDTO {
  const next = { ...row, ...patch };
  return next.analysisStatus === row.analysisStatus &&
    next.accuracy === row.accuracy &&
    next.headline === row.headline &&
    next.momentsCount === row.momentsCount
    ? row
    : next;
}
