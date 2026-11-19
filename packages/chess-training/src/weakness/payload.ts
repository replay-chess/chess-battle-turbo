// buildPayload(snapshot, live) → the TR-5 payload (phase-06 plan §7.1.1 step 5, §7.2, §8.13–8.15, §8.19, §8.21).
// Pure: the web DAL (WP5) reads the latest snapshot (Q-W1), the live bank counts (Q-W2), the training profile (Q-W4)
// and the progress probe (Q-W3, Q-W3b), resolves the lesson slots (null until P8), and hands everything here. Live
// fields are never stored (§6.3): status, progress, updating, inBank, rating, weekPlan, matchable, slug, lesson,
// version, seenVersion. Every label is formatted here, in the member's zone.
import type { WeaknessLesson, WeaknessPayload, WeaknessRow, WeekPlanRow } from "@repo/contracts/http/weakness";
import { themeLabel, weaknessLabel, TIME_PRESSURE_THEME } from "../themes";
import { clockAriaLabel, clockSentence, phaseSentence } from "./breakdown";
import { ALGO_VERSION, GAMES_REQUIRED, PRELIMINARY_FROM, WEEK_PLAN_DRILL_SIZE, WEEK_PLAN_PUZZLES } from "./constants";
import { weaknessMatchTheme } from "./drill";
import { bandLabel, CLOCK_LABELS, lowerLabel, PHASE_LABELS, round1, scopeLabel, scopeLabelShort, trendLabel, whereLabel } from "./labels";
import { analysingTarget, computeProgress } from "./progress";
import { resolveScope, scopeSince } from "./scope";
import { patternSlug } from "./slug";
import { deriveStatus, type RecomputeState } from "./status";
import type { ClockBucketDoc, SnapshotStatus, WeaknessMetricsRow, WeaknessMetricsV1, WeaknessProfileRow } from "./types";

/** The latest snapshot row (Q-W1). */
export interface PayloadSnapshot {
  /** "YYYY-MM-DD". */
  weekStart: string;
  algoVersion: number;
  status: SnapshotStatus;
  gamesInScope: number;
  gamesAnalysed: number;
  metrics: WeaknessMetricsV1;
  computedAt: Date;
}

/** The training profile row (Q-W4); null when the member has none yet. */
export interface PayloadProfile extends WeaknessProfileRow {
  puzzleRating: number | null;
  weaknessVersion: number;
  lastWeaknessSeenVersion: number;
}

/** The progress probe (Q-W3 jobs part always; the games and import parts when not READY or while work is active). */
export interface PayloadProbe {
  recompute: RecomputeState;
  /** The last RECOMPUTE_WEAKNESS exhausted its attempts (FAILED). */
  lastJobFailed: boolean;
  /** FIX-1: the last RECOMPUTE_WEAKNESS was skipped by the worker's kill switch. */
  paused?: boolean;
  /** QUEUED + RUNNING ANALYZE_GAME jobs of the member. */
  activeAnalyzeJobs: number;
  /** In-window counts per time class (Q-W3 game_players part), or null when the probe skipped it. */
  games: Array<{ timeClass: string | null; n: number; analysed: number }> | null;
  /** The running import (Q-W3 linked_accounts part), or null when no import runs. */
  importRun: { done: number; total: number; ratePerSec: number | null } | null;
  /** Q-W3b. */
  lastAnalysedAt: Date | null;
}

export interface PayloadInput {
  now: Date;
  timeZone: string;
  snapshot: PayloadSnapshot | null;
  profile: PayloadProfile | null;
  /** Q-W2: BANK cards per theme (hidden mistakes excluded). */
  inBank: Readonly<Record<string, number>>;
  probe: PayloadProbe;
  isTrialing: boolean;
  /** Seconds per analysed game for the ETA (env ANALYSIS_SECONDS_PER_GAME). */
  secPerGame: number | null;
  /** Engine lanes (env ANALYSIS_LANES). */
  lanes: number;
  queueAheadSec?: number;
  /** `resolveLessonForPattern()` per row pattern (P8; all null in P6). */
  lessons?: Readonly<Record<string, WeaknessLesson | null>>;
}

/** `{weekStart}.{computedAt epoch ms in base36}` (the ETag part, the event dedupe key, `snapshotKey`). */
export function weaknessSnapshotKey(weekStart: string, computedAt: Date): string {
  return `${weekStart}.${computedAt.getTime().toString(36)}`;
}

function sameScope(m: WeaknessMetricsV1, tcs: readonly string[], months: number): boolean {
  return m.scope.months === months && m.scope.timeClasses.length === tcs.length && m.scope.timeClasses.every((tc) => tcs.includes(tc));
}

function rowOf(r: WeaknessMetricsRow, i: number, input: PayloadInput, listMode: WeaknessMetricsV1["listMode"]): WeaknessRow {
  const tp = r.pattern === TIME_PRESSURE_THEME;
  return {
    rank: i + 1,
    pattern: r.pattern,
    slug: patternSlug(r.pattern),
    // The taxonomy's label at read (as the preliminary rows already do), so a label fix reaches stored snapshots
    // (FIX-4, D-P6-FIX4-9); the stored label is the same function's output at compute time.
    label: weaknessLabel(r.pattern) || r.label,
    unit: r.unit,
    you: Math.min(100, round1(r.you)),
    band: listMode === "most_frequent" || r.band === null ? null : Math.min(100, round1(r.band)),
    trend: r.trend,
    trendLabel: trendLabel(r.trend),
    events: r.events,
    where: whereLabel({ timePressure: tp, phaseMode: r.phaseMode, gamesWithLast20: r.gamesWithLast20, lastN: r.lastN }),
    example: r.example,
    inBank: Math.max(0, input.inBank[r.pattern] ?? 0),
    matchable: weaknessMatchTheme(r.pattern) !== null,
    lesson: input.lessons?.[r.pattern] ?? null,
  };
}

/** The week plan (§8.15): the top row's drill, the first matchable row's puzzles, and (from P8) the lesson. */
export function weekPlanOf(rows: readonly WeaknessRow[], rating: number | null): WeekPlanRow[] {
  const top = rows[0];
  if (!top) return [];
  const plan: WeekPlanRow[] = [];
  const own = Math.min(Math.round(WEEK_PLAN_DRILL_SIZE * 0.6), top.inBank);
  plan.push({
    kind: "drill",
    label: `Drill ${lowerLabel(top.label)}`.slice(0, 60),
    sub: top.matchable
      ? `${WEEK_PLAN_DRILL_SIZE} positions · ${own} from your games + ${WEEK_PLAN_DRILL_SIZE - own} matched puzzles`
      : `${WEEK_PLAN_DRILL_SIZE} positions from your games`,
    href: `/train/weakness/${top.slug}`,
  });
  const matchable = rows.find((r) => r.matchable);
  const theme = matchable ? weaknessMatchTheme(matchable.pattern) : null;
  if (theme) {
    plan.push({
      kind: "puzzles",
      label: `${themeLabel(theme)} puzzles ${rating === null ? "at your level" : `at ${rating}`}`.slice(0, 60),
      sub: `${WEEK_PLAN_PUZZLES} drills a session, under a minute each`,
      href: `/train/puzzles?theme=${encodeURIComponent(theme)}&n=${WEEK_PLAN_PUZZLES}`,
    });
  }
  if (top.lesson) {
    plan.push({
      kind: "lesson",
      label: `Legend lesson: ${top.lesson.title}`.slice(0, 60),
      sub: top.lesson.sub,
      href: `/learn/lessons/${top.lesson.slug}?from=weakness`,
    });
  }
  return plan;
}

/** The clock sentence of stored buckets (each holds its moves and blunders); the stored text when they do not. */
function storedClockSentence(clock: { buckets: readonly ClockBucketDoc[]; sentence: string }): string {
  const b = clock.buckets;
  const ok = b.length === 4 && b.every((x) => Number.isFinite(x.moves) && Number.isFinite(x.blunders));
  if (!ok) return clock.sentence;
  return clockSentence({
    clockMoves: [b[0]!.moves, b[1]!.moves, b[2]!.moves, b[3]!.moves],
    clockBlunders: [b[0]!.blunders, b[1]!.blunders, b[2]!.blunders, b[3]!.blunders],
  });
}

export function buildPayload(input: PayloadInput): WeaknessPayload {
  const { now, timeZone, snapshot, profile, probe } = input;
  const scope = resolveScope(profile);
  const windowSince = scopeSince(now, timeZone, scope.months);
  const counts = probe.games
    ? probe.games.filter((g) => g.timeClass !== null && (scope.timeClasses as string[]).includes(g.timeClass))
    : null;
  const inScope = counts ? counts.reduce((s, g) => s + g.n, 0) : (snapshot?.gamesInScope ?? 0);
  const analysed = counts ? counts.reduce((s, g) => s + g.analysed, 0) : (snapshot?.gamesAnalysed ?? 0);
  const bulletGames = probe.games ? probe.games.filter((g) => g.timeClass === "BULLET").reduce((s, g) => s + g.n, 0) : 0;

  const derived = deriveStatus({
    snapshot: snapshot ? { status: snapshot.status, gamesAnalysed: snapshot.gamesAnalysed } : null,
    recompute: probe.recompute,
    lastJobFailed: probe.lastJobFailed,
    importRunning: probe.importRun !== null,
    activeAnalyzeJobs: probe.activeAnalyzeJobs,
    paused: probe.paused === true,
    analysedInScope: analysed,
    inScope,
    bulletGames,
    scopeHasBullet: scope.timeClasses.includes("BULLET"),
  });
  const ready = derived.status === "ready" && snapshot !== null;
  const m = snapshot?.metrics ?? null;
  const shown = ready ? m! : null;
  const rating = profile?.puzzleRating === null || profile?.puzzleRating === undefined ? null : Math.round(profile.puzzleRating);

  // Scope: the READY profile's own scope; otherwise the live scope (the stored one's "since" when it is the same scope).
  const scopeOut = shown
    ? { timeClasses: shown.scope.timeClasses, since: shown.scope.since, months: shown.scope.months, maxGames: 300 as const }
    : {
        timeClasses: scope.timeClasses,
        since: (m && sameScope(m, scope.timeClasses, scope.months) ? m.scope.since : windowSince.toISOString()),
        months: scope.months,
        maxGames: 300 as const,
      };
  const since = new Date(scopeOut.since);
  const gamesForLabel = ready ? snapshot.gamesInScope : inScope;

  const bandDoc = shown?.band ?? m?.band ?? null;
  const rows = shown ? shown.rows.map((r, i) => rowOf(r, i, input, shown.listMode)) : [];
  const target = analysingTarget(inScope, input.isTrialing).n;
  const progress =
    derived.status === "computing" || (derived.status === "insufficient" && derived.orphaned)
      ? {
          ...computeProgress(
            {
              analysedInScope: analysed,
              inScope,
              isTrialing: input.isTrialing,
              importRunning: probe.importRun !== null,
              importDone: probe.importRun?.done ?? 0,
              importTotal: probe.importRun?.total ?? 0,
              importRatePerSec: probe.importRun?.ratePerSec ?? null,
              recompute: probe.recompute,
              hasReady: false,
              snapshot: snapshot !== null,
              activeAnalyzeJobs: probe.activeAnalyzeJobs,
              lastAnalysedAt: probe.lastAnalysedAt,
              secPerGame: input.secPerGame,
              lanes: input.lanes,
              queueAheadSec: input.queueAheadSec ?? 0,
              bandLabel: bandDoc ? bandLabel(bandDoc.min, bandDoc.max) : null,
            },
            now,
          ),
          orphaned: derived.orphaned,
        }
      : null;

  const breakdown = shown?.breakdown
    ? {
        phase: {
          // FIX-4 (items 6, 13; D-P6-FIX4-5): both sentences are the engine's functions over the stored rows, so a
          // snapshot written before a copy fix reads the fixed copy (the worker writes the same text for new ones).
          sentence: phaseSentence(shown.breakdown.phase),
          rows: shown.breakdown.phase.map((p) => ({ phase: p.phase, label: PHASE_LABELS[p.phase], you: p.you, band: p.band })),
        },
        clock: shown.breakdown.clock
          ? {
              sentence: storedClockSentence(shown.breakdown.clock),
              ariaLabel: clockAriaLabel(shown.breakdown.clock.buckets),
              buckets: shown.breakdown.clock.buckets.map((b) => ({ key: b.key, label: CLOCK_LABELS[b.key], per100: b.per100, moves: b.moves })),
            }
          : null,
        openings: shown.breakdown.openings.map((o) => ({ family: o.family, ecoRange: o.ecoRange, games: o.games, scorePct: o.scorePct, note: o.note })),
        strengths: shown.breakdown.strengths,
      }
    : null;

  const preliminary =
    derived.status === "insufficient" && m && snapshot?.status === "INSUFFICIENT" && analysed >= PRELIMINARY_FROM && analysed < GAMES_REQUIRED
      ? m.preliminary.map((p) => ({ ...p, label: weaknessLabel(p.pattern) }))
      : [];

  return {
    v: 1,
    status: derived.status,
    scope: scopeOut,
    scopeLabel: scopeLabel({ ready, gamesInScope: gamesForLabel, timeClasses: scopeOut.timeClasses, since, timeZone }),
    scopeLabelShort: scopeLabelShort({ gamesInScope: gamesForLabel, since, timeZone }),
    games: {
      analysed,
      inScope,
      // FIX-4 (item 10): `target` is at least 1 (a progress denominator); with no game in scope nothing is pending.
      pending: Math.max(0, Math.min(target, inScope) - analysed),
      required: GAMES_REQUIRED,
      preliminaryFrom: PRELIMINARY_FROM,
    },
    progress,
    updating: derived.updating,
    band: bandDoc ? { min: bandDoc.min, max: bandDoc.max, label: bandLabel(bandDoc.min, bandDoc.max), source: bandDoc.source } : null,
    rating,
    headline: shown?.headline ? { text: shown.headline.text, short: shown.headline.short, verified: true } : null,
    listMode: shown?.listMode ?? (bandDoc ? "vs_band" : "own_only"),
    top: rows.slice(0, 3),
    more: rows.slice(3, 5),
    preliminary,
    weekPlan: ready ? weekPlanOf(rows, rating) : [],
    breakdown,
    offers: { includeBullet: derived.offerBullet ? { bulletGames } : null },
    failure:
      derived.status !== "failed"
        ? null
        : derived.paused
          ? { code: "updates_paused", retryable: false }
          : { code: (m?.failure?.code ?? "recompute_failed").slice(0, 40), retryable: true },
    version: profile?.weaknessVersion ?? 0,
    seenVersion: profile?.lastWeaknessSeenVersion ?? 0,
    algoVersion: snapshot?.algoVersion ?? ALGO_VERSION,
    computedAt: snapshot ? snapshot.computedAt.toISOString() : null,
    snapshotKey: snapshot ? weaknessSnapshotKey(snapshot.weekStart, snapshot.computedAt) : null,
  };
}
