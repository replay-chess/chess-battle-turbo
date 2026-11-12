// /dev/ui/compare (phase-03 plan §4.10): the compare screen in every state of DR/V3LegendCompare (default, loading,
// no_explanation, audio_failed) and the variants of §4.6 (error, followed, opponent_left, pending_evals), on the
// contract fixture (the Opera Game, Morphy, 12.Ba4 vs 12.O-O-O). The followed and opponent-left payloads are built
// with the same grading-library functions the server uses (`compareWithLegend`, `lineRows`, the copy templates),
// so the demo says what the real page would.
import { legendCompareFixture, OPERA } from "@repo/contracts/http/fixtures/review";
import type { LegendCompareDTO, StaticExplanation } from "@repo/contracts/http/legend";
import type { PlayerCard } from "@repo/contracts/http/review";
import { compareWithLegend } from "@repo/chess-analysis/legend/compare";
import { comparisonParagraph, lineRows, outcomeLine, summaryLine } from "@repo/chess-analysis/legend/summary";
import { lineFrames, moveLabelAt } from "../model";

export const COMPARE_DEMO_STATES = [
  "default",
  "loading",
  "no_explanation",
  "audio_failed",
  "error",
  "followed",
  "opponent_left",
  "pending_evals",
] as const;
export type CompareDemoState = (typeof COMPARE_DEMO_STATES)[number];

export function isCompareDemoState(v: unknown): v is CompareDemoState {
  return typeof v === "string" && (COMPARE_DEMO_STATES as readonly string[]).includes(v);
}

const LEGEND = OPERA.legendUci.split(" ");

/** The game's moves of the opponent-left variant: the engine (Black) leaves Morphy's line with 11…Nfd7. */
export const OPPONENT_LEFT_UCI = ["c3b5", "c6b5", "c4b5", "f6d7", "e1c1", "f7f6", "g5e3"];

function variant(base: LegendCompareDTO, moves: readonly string[], userResult: LegendCompareDTO["userResult"], opponent: PlayerCard): LegendCompareDTO {
  const facts = compareWithLegend({
    startFen: OPERA.startFen,
    startPly: OPERA.startPly,
    moves,
    member: "w",
    legendUci: LEGEND,
    historicalName: base.legend.name,
    legendResult: base.legendResult,
    legendTotalMoves: base.legendTotalMoves,
  });
  const ctx = { startFen: OPERA.startFen, facts };
  const yours = lineFrames(OPERA.startFen, facts.userLineUci, OPERA.startPly);
  const d = facts.divergencePly;
  const practicePly = d ?? Math.max(0, yours.length - 2);
  return {
    ...base,
    status: "ready",
    players: { ...base.players, b: opponent },
    matched: facts.matchedPlies,
    compared: facts.comparedPlies,
    divergence:
      d === null || !facts.userUci || !facts.userSan || !facts.legendUci || !facts.legendSan || !facts.divergenceBy
        ? null
        : {
            ply: d,
            moveLabel: moveLabelAt(d, OPERA.startPly),
            by: facts.divergenceBy,
            userUci: facts.userUci,
            userSan: facts.userSan,
            legendUci: facts.legendUci,
            legendSan: facts.legendSan,
            fenBefore: yours[d]!.fen,
          },
    evalAtDivergence: null,
    userResult,
    summaryLine: summaryLine(facts),
    paragraph: comparisonParagraph(facts, {
      opponentLabel: opponent.kind === "bot" ? "The engine" : "Your opponent",
      opponentHistoricalName: "Isouard",
    }),
    outcomeLine: outcomeLine(facts, userResult),
    yourLine: { uci: facts.userLineUci, rows: lineRows(ctx, "yours") },
    legendLine: { uci: facts.legendLineUci, rows: lineRows(ctx, "legend") },
    practice: { ply: practicePly, href: `/practice?game=${base.ref}&ply=${practicePly}`, botElo: base.practice.botElo },
  };
}

const ENGINE: PlayerCard = { name: "Engine 1400", rating: 1400, initials: "E", kind: "bot", isYou: false };

/** The demo payload of a state (`stress`: 20-character names and the longest legend title). */
export function compareDemoDto(state: CompareDemoState, stress = false): LegendCompareDTO {
  let dto: LegendCompareDTO;
  switch (state) {
    case "no_explanation":
      dto = legendCompareFixture({ status: "ready", hasExplanation: false });
      break;
    case "error":
      dto = { ...legendCompareFixture({ status: "failed" }), attempts: 1 };
      break;
    case "pending_evals":
      dto = legendCompareFixture({ status: "facts_ready" });
      break;
    case "followed":
      dto = variant(legendCompareFixture({ status: "ready" }), LEGEND, "win", legendCompareFixture().players.b);
      break;
    case "opponent_left":
      dto = variant(legendCompareFixture({ status: "ready" }), OPPONENT_LEFT_UCI, "win", ENGINE);
      break;
    default:
      dto = legendCompareFixture({ status: "ready" });
  }
  if (!stress) return dto;
  return {
    ...dto,
    players: {
      w: { ...dto.players.w, name: "Maximilian_Oberhaus2", initials: "MA" },
      b: { ...dto.players.b, name: dto.players.b.kind === "bot" ? dto.players.b.name : "Alexandra_Kowalczyk9", initials: "AL" },
    },
    legend: { ...dto.legend, title: "Morphy vs the Duke of Brunswick and Count Isouard, the Opera Game, Paris Opera House, 1858" },
  };
}

/** The fixture's five-segment explanation (the board's narration), for the demo's explanation query. */
export function compareDemoExplanation(): StaticExplanation {
  const e = legendCompareFixture({ status: "ready", withExplanation: true }).explanation;
  if (!e) throw new Error("the legend fixture has no explanation");
  return e;
}

/**
 * A silent mono 8-bit WAV of `seconds` (the demo's narration audio, so Play, the progress bar and the segment cues run
 * with no server). 8 kHz (Chrome's decoders refuse rates under 3 kHz) keeps 130 s at about 1 MB, in memory only.
 */
export function silentWav(seconds: number, sampleRate = 8000): Uint8Array<ArrayBuffer> {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const buf = new Uint8Array(new ArrayBuffer(44 + samples));
  const view = new DataView(buf.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  buf.fill(128, 44);
  return buf;
}
