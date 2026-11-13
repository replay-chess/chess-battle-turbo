// Import card fixtures of the Activating and Done demos (V3OnbActivating "212 / 480", V3OnbDone). `stress` = five-digit
// counts.
import type { RunView } from "@repo/contracts/http/accounts";
import type { FirstReview } from "@repo/contracts/http/import";
import { importCardView, type ImportCardContext, type ImportCardView } from "@/lib/onboarding/import-card";

const AT = "2026-10-30T12:00:00.000Z";

export function demoRun(over: Partial<RunView>, stress: boolean): RunView {
  const total = stress ? 20_000 : 480;
  const imported = stress ? 12_480 : 212;
  return {
    ref: "run_demo",
    provider: "chesscom",
    trigger: "initial",
    status: "running",
    phase: "saving",
    seen: total,
    total,
    imported,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    error: null,
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
    ...over,
  };
}

export const FIRST_REVIEW: FirstReview = { gameRef: "game_demo", analysisStatus: "done", momentsCount: 3 };

export function demoCard(
  context: ImportCardContext,
  run: RunView | null,
  opts: { linked?: ("chesscom" | "lichess")[]; entitled?: boolean; firstReview?: FirstReview | null; etaSec?: number | null } = {},
): ImportCardView {
  return importCardView({
    context,
    run,
    firstReview: opts.firstReview ?? null,
    linked: opts.linked ?? ["chesscom"],
    entitled: opts.entitled ?? true,
    trial: true,
    etaSec: opts.etaSec ?? null,
  });
}
