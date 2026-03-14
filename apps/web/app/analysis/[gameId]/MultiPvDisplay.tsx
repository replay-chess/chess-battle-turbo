"use client";

import type { MultiPvLine } from "@/lib/hooks/useStockfish";
import type { Color } from "chess.js";

const PV_COLORS = ["#6ebb8c", "#78a0d2", "#dcaa64", "#aa82c8", "#d2786e"];

interface MultiPvDisplayProps {
  lines: MultiPvLine[];
  currentDepth: number;
  playerColor: Color;
}

function formatScore(line: MultiPvLine, playerColor: Color): string {
  // Flip score if player is black (engine scores are from white's perspective)
  const flip = playerColor === "b" ? -1 : 1;

  if (line.scoreMate !== null) {
    const mate = line.scoreMate * flip;
    return mate > 0 ? `M${mate}` : `M${mate}`;
  }
  if (line.scoreCp !== null) {
    const cp = (line.scoreCp * flip) / 100;
    return cp >= 0 ? `+${cp.toFixed(2)}` : cp.toFixed(2);
  }
  return "–";
}

function formatPv(pv: string[], maxMoves: number = 4): string {
  return pv.slice(0, maxMoves).join(" ");
}

export default function MultiPvDisplay({ lines, currentDepth, playerColor }: MultiPvDisplayProps) {
  if (lines.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1.5">
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
        >
          Engine Lines
        </p>
        <span
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[10px] text-cb-text-muted font-mono"
        >
          d{currentDepth}
        </span>
      </div>
      {lines.map((line, i) => (
        <div key={line.multipv} className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: PV_COLORS[i] ?? "#fbbf24" }}
          />
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text/80 font-mono w-14 text-right flex-shrink-0"
          >
            {formatScore(line, playerColor)}
          </span>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted font-mono truncate"
          >
            {formatPv(line.pv)}
          </span>
        </div>
      ))}
    </div>
  );
}
