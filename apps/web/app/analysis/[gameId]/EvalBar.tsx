"use client";

interface EvalBarProps {
  score: number;       // centipawns, positive = White advantage
  description: string;
  flipped?: boolean;   // true when viewing from Black's perspective
}

export default function EvalBar({ score, description, flipped = false }: EvalBarProps) {
  // Clamp score to [-1000, 1000] for display, convert to percentage
  const clamped = Math.max(-1000, Math.min(1000, score));
  // White percentage: score 0 = 50%, +1000 = 100%, -1000 = 0%
  const whitePct = 50 + (clamped / 1000) * 50;
  // If flipped (Black POV), white fills from top; otherwise from bottom
  const fillPct = flipped ? 100 - whitePct : whitePct;

  // Display value: pawns (divide by 100) or just the description
  const displayValue = Math.abs(score) >= 1000
    ? (score > 0 ? "+M" : "-M")
    : (score >= 0 ? "+" : "") + (score / 100).toFixed(1);

  return (
    <div className="flex flex-col items-center w-5 sm:w-6 shrink-0 self-stretch">
      {/* The bar */}
      <div
        className="relative w-full flex-1 rounded-sm overflow-hidden border border-cb-border"
        title={description}
      >
        {/* Black portion (top) */}
        <div
          className="absolute inset-x-0 top-0 bg-cb-surface transition-all duration-500 ease-out"
          style={{ height: `${100 - fillPct}%` }}
        />
        {/* White portion (bottom) */}
        <div
          className="absolute inset-x-0 bottom-0 bg-neutral-100 transition-all duration-500 ease-out"
          style={{ height: `${fillPct}%` }}
        />
      </div>
      {/* Score label */}
      <div
        className="mt-1 text-[8px] sm:text-[9px] text-cb-text-secondary font-medium leading-none text-center whitespace-nowrap"
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        {displayValue}
      </div>
    </div>
  );
}
