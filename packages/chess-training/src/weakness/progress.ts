// Progress and ETA of a first build (phase-06 plan §8.13; rct-b Q3: a real ETA, never the board's fixed "about a
// minute"). The same function feeds TR-5 (server) and the `weakness:progress` patch on the client, so the two never
// disagree. Browser-safe.
import type { WeaknessProgress } from "@repo/contracts/http/weakness";
import type { WeaknessProgressEvent } from "@repo/contracts/socket/user";
import { ANALYSE_CAP, ANALYSE_CAP_TRIAL, DEFAULT_SECONDS_PER_GAME, ETA_OVERHEAD_SEC, GAMES_REQUIRED, PRELIMINARY_FROM, PROGRESS_WEIGHTS, STALLED_MS } from "./constants";
import type { RecomputeState } from "./status";

export type ProgressStep = WeaknessProgress["steps"][number];
const STEP_KEYS = ["import", "grade", "patterns", "compare"] as const;

export interface ProgressInput {
  analysedInScope: number;
  inScope: number;
  isTrialing: boolean;
  importRunning: boolean;
  importDone: number;
  importTotal: number;
  /** Games imported per second (the run's own rate), or null when unknown. */
  importRatePerSec: number | null;
  recompute: RecomputeState;
  hasReady: boolean;
  /** A snapshot row exists (any status). */
  snapshot: boolean;
  activeAnalyzeJobs: number;
  /** max(game_analyses."completedAt") of the member's in-scope games (Q-W3b). */
  lastAnalysedAt: Date | null;
  /** The worker's rolling median of ANALYZE_GAME durations, or env ANALYSIS_SECONDS_PER_GAME; null → 45 s. */
  secPerGame: number | null;
  /** Engine lanes (env ANALYSIS_LANES). */
  lanes: number;
  /** Seconds of other members' work ahead of this member's jobs. */
  queueAheadSec: number;
  /** "1100–1300", or null while the band is unknown. */
  bandLabel: string | null;
}

/** N for "Analysing {N} games": the in-scope games the build will analyse (100 member / 20 trialist). */
export function analysingTarget(inScope: number, isTrialing: boolean): { n: number; capped: boolean } {
  const cap = isTrialing ? ANALYSE_CAP_TRIAL : ANALYSE_CAP;
  return { n: Math.max(1, Math.min(Math.max(0, inScope), cap)), capped: inScope > cap };
}

/** "about 13 minutes left" (< 90 s: "about a minute left"; ≥ 90 min: "about {h} hours left"; null: "Working…"). */
export function etaText(etaSec: number | null): string {
  if (etaSec === null) return "Working…";
  if (etaSec < 90) return "about a minute left";
  if (etaSec < 90 * 60) return `about ${Math.round(etaSec / 60)} minutes left`;
  return `about ${Math.round(etaSec / 3600)} hours left`;
}

/** The four step labels. */
export function stepLabels(o: { importCount: number; bandLabel: string | null }): Record<(typeof STEP_KEYS)[number], string> {
  return {
    import: `Import ${o.importCount} ${o.importCount === 1 ? "game" : "games"}`,
    grade: "Grade every move with Stockfish",
    patterns: "Find patterns across games",
    compare: o.bandLabel ? `Compare with players rated ${o.bandLabel}` : "Compare with players at your level",
  };
}

const clampPct = (x: number) => Math.max(0, Math.min(100, Math.floor(x)));

function stepsOf(pcts: Record<(typeof STEP_KEYS)[number], number>, labels: Record<(typeof STEP_KEYS)[number], string>): ProgressStep[] {
  const current = STEP_KEYS.find((k) => pcts[k] < 100);
  return STEP_KEYS.map((key) => ({
    key,
    label: labels[key],
    pct: pcts[key],
    state: pcts[key] >= 100 ? "done" : key === current ? "run" : "wait",
  }));
}

function weighted(p: Record<(typeof STEP_KEYS)[number], number>): number {
  return Math.round(PROGRESS_WEIGHTS.import * p.import + PROGRESS_WEIGHTS.grade * p.grade + PROGRESS_WEIGHTS.patterns * p.patterns + PROGRESS_WEIGHTS.compare * p.compare);
}

/** The progress block (§8.13). */
export function computeProgress(i: ProgressInput, now: Date): WeaknessProgress {
  const analysed = Math.max(0, i.analysedInScope);
  const pcts = {
    import: i.importRunning ? clampPct((100 * i.importDone) / Math.max(1, i.importTotal)) : 100,
    grade: clampPct((100 * Math.min(analysed, GAMES_REQUIRED)) / GAMES_REQUIRED),
    patterns: analysed < GAMES_REQUIRED ? 0 : i.recompute === "running" ? 50 : i.recompute === "queued" ? 10 : i.hasReady ? 100 : 10,
    compare: i.hasReady ? 100 : 0,
  };
  const lanes = Math.max(1, i.lanes);
  const sec = i.secPerGame ?? DEFAULT_SECONDS_PER_GAME;
  let etaSec: number | null =
    (Math.max(0, GAMES_REQUIRED - analysed) * sec) / lanes + Math.max(0, i.queueAheadSec) + ETA_OVERHEAD_SEC;
  if (i.importRunning) {
    if (i.importRatePerSec && i.importRatePerSec > 0) etaSec += Math.max(0, i.importTotal - i.importDone) / i.importRatePerSec;
    else etaSec = null;
  }
  const stalled = i.activeAnalyzeJobs > 0 && i.lastAnalysedAt !== null && now.getTime() - i.lastAnalysedAt.getTime() > STALLED_MS;
  const target = analysingTarget(i.inScope, i.isTrialing).n;
  return {
    pct: weighted(pcts),
    etaSec: etaSec === null ? null : Math.min(86_400, Math.max(0, Math.ceil(etaSec))),
    stalled,
    orphaned: analysed >= PRELIMINARY_FROM && !i.snapshot && i.recompute === "none",
    analysed,
    target,
    steps: stepsOf(pcts, stepLabels({ importCount: i.importRunning ? i.importTotal : i.inScope, bandLabel: i.bandLabel })),
  };
}

/** The client's patch for a `weakness:progress` event (the cached payload's labels are kept). */
export function progressFromEvent(e: WeaknessProgressEvent, prev: WeaknessProgress | null): WeaknessProgress {
  const importing = e.importDone !== null && e.importTotal !== null && e.importDone < e.importTotal;
  const pcts = {
    import: importing ? clampPct((100 * e.importDone!) / Math.max(1, e.importTotal!)) : 100,
    grade: clampPct((100 * Math.min(e.analysed, GAMES_REQUIRED)) / GAMES_REQUIRED),
    patterns: e.step === "compare" ? 100 : e.step === "patterns" ? Math.max(10, prev?.steps[2]?.pct ?? 10) : 0,
    compare: 0,
  };
  const fallback = stepLabels({ importCount: e.importTotal ?? e.target, bandLabel: null });
  const labels = {
    import: e.importTotal !== null ? fallback.import : (prev?.steps[0]?.label ?? fallback.import),
    grade: fallback.grade,
    patterns: fallback.patterns,
    compare: prev?.steps[3]?.label ?? fallback.compare,
  };
  return {
    pct: Math.max(0, Math.min(100, e.pct)),
    etaSec: e.etaSec,
    stalled: e.stalled,
    orphaned: false,
    analysed: e.analysed,
    target: Math.max(1, Math.min(300, e.target)),
    steps: stepsOf(pcts, labels),
  };
}
