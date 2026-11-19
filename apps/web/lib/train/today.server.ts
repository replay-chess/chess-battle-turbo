// R1 `GET /api/train/today` and the `/train` RSC seed (phase-05 plan §7.3 R1, §8.5, §8.9, §8.10, §5.2 S2).
//
// One parallel batch: the training state (profile, today's and this week's rows, the due summary: day.server.ts),
// the due preview (statement (c), ≤ 4 cards) and theme mastery (statement (d)). On the first read of a local day the
// plan is built (one more read: the ≤ 50 due cards, plus the newest analysed game for an empty bank and today's
// attempts) and frozen with ONE write batch: the plan upsert (`COALESCE` keeps the first plan when two tabs race) and
// the lazy profile row with the puzzle-rating seed. Those two statements are R1's registered GET side effect
// (`sideEffects: ["daily_plan"]`); a second read of the day writes nothing.
//
// P6 lights up (phase-06 plan §7.1.5, §1.1; WP7). With the viewer's `weakness` flag on, the batch also reads Q-W1 (the
// latest snapshot, PK) ‖ Q-W2 (bank cards per theme). When that snapshot is READY: `allTraining.weakness` (the hub's
// "Weakness drills · Missed forks · 12 in your bank" row, linking the top pattern's drill) and, for a plan built today,
// `basis: "games20"` ("Built from your last 20 games.") with step 2's focus on the first matchable row's Lichess theme.
// Flag off, or no READY snapshot: the P5 statements and the P5 payload, byte for byte (no key added).
import { Prisma } from "@repo/db";
import { buildDailyPlan as validatePlan, parseDailyPlan, parseWeaknessMetrics, type DailyPlanV1 } from "@repo/db/json";
import type { DuePreview, PlanStep, TrainToday } from "@repo/contracts/http/train";
import { waitingLine } from "@repo/chess-training/caps";
import { weekdayLabel } from "@repo/chess-training/labels";
import { formatYmd, localDate } from "@repo/chess-training/tz";
import { themePct } from "@repo/chess-training/mastery";
import {
  buildDailyPlan,
  keepGoingLabel,
  planCta,
  liveEmptySteps,
  planDoneBits,
  reviewStepRef,
  planDoneCount,
  planFootnote,
  planMinutes,
  planStepStatuses,
  puzzlesHref,
  livePuzzleStep,
  liveBankStep,
  type PlanBankCard,
} from "@repo/chess-training/plan";
import { orderDueQueue } from "@repo/chess-training/session";
import { displayedStreak, streakAria, streakWeek } from "@repo/chess-training/streak";
import { PICKER_THEMES, themeLabel, themePluralLabel, weaknessLabel } from "@repo/chess-training/themes";
import { weaknessMatchTheme } from "@repo/chess-training/weakness/drill";
import { patternSlug } from "@repo/chess-training/weakness/slug";
import { weaknessVoice, type WeaknessVoice } from "@repo/chess-training/weakness/voice";
import type { Viewer } from "@/lib/auth/viewer";
import { capOf } from "./badges.server";
import {
  bankCardIn,
  batchesOf,
  dueCardsSql,
  lastGameSql,
  nextBatchOf,
  planThemesOf,
  themeMasterySql,
  type DueCardRow,
  type LastGameRow,
  type ThemeMasteryRow,
} from "./bank.server";
import { isTrainedDay, loadTrainState, type TrainState } from "./day.server";
import { asDate, at, dayParam, NOW_UTC, num, trainDeps, type TrainDeps } from "./db.server";
import { lastMoveOf, positionAfter } from "./dto.server";
import { insertProfileSql, ratingView } from "./profile.server";
import { puzzlesEnabled } from "./puzzles.server";
import { bankThemeCountsSql, latestSnapshotSql, weaknessEnabled } from "./weakness.server";

// ── P6: the READY profile's top weakness (Q-W1 ‖ Q-W2) ───────────────────────────────────────────────────────────
/** What the lit slots read from a READY weakness profile. */
export type TopWeakness = {
  /** The top row's pattern key ("fork", "rc:timePressure"). */
  pattern: string;
  /** "Missed forks" (≤ 40). */
  label: string;
  /** Live BANK cards carrying the pattern (Q-W2, hidden mistakes excluded): "12 in your bank". */
  inBank: number;
  /** `/train/weakness/fork?from=hub`: the top row's drill. */
  href: string;
  /** The first matchable row's Lichess theme (the plan's focus, rct-b §3.5 rule 1), or null. */
  focusTheme: string | null;
  /**
   * FIX-4 (D-P6-FIX4-1, `weakness/voice.ts`): how Home and the hub name the top row: "top weakness" only in a band
   * comparison (`vs_band`), else the member's "most common mistake".
   */
  voice: WeaknessVoice;
  /** The same rule for the focus theme: the top row's match or a lower row's (FIX-2 D-P6-FIX2-10, FIX-4). */
  focusVoice: WeaknessVoice;
};

type SnapshotHead = { status: string; metrics: unknown };

/** The top weakness from the latest snapshot and the bank counts, or null unless the snapshot is READY with rows. */
export function topWeaknessOf(snapshot: SnapshotHead | undefined, bank: readonly { theme: string; n: number }[]): TopWeakness | null {
  if (!snapshot || snapshot.status !== "READY") return null;
  // A document an older or newer build wrote reads as "no profile" (the page's own reader does the same).
  const rows = parseWeaknessMetrics(snapshot.metrics)?.rows ?? [];
  const top = rows[0];
  if (!top) return null;
  const inBank = num(bank.find((b) => b.theme === top.pattern)?.n ?? 0);
  const focusTheme = rows.map((r) => weaknessMatchTheme(r.pattern)).find((t): t is string => t !== null) ?? null;
  const listMode = parseWeaknessMetrics(snapshot.metrics)?.listMode ?? null;
  // Only a band comparison (`vs_band`) makes the top row a "top weakness": an `own_only` list (no band) ranks the
  // member's own losses and a `most_frequent` list says nothing stands out (FIX-3 review item 7, FIX-4 item 1).
  const focusIsTopRow = focusTheme !== null && weaknessMatchTheme(top.pattern) === focusTheme;
  return {
    pattern: top.pattern,
    // The taxonomy's label at read, as TR-5's rows (FIX-4, D-P6-FIX4-9).
    label: (weaknessLabel(top.pattern) || top.label).slice(0, 40),
    inBank: Math.max(0, inBank),
    href: `/train/weakness/${patternSlug(top.pattern)}?from=hub`,
    focusTheme,
    voice: weaknessVoice(listMode, true),
    focusVoice: weaknessVoice(listMode, focusIsTopRow),
  };
}

/** Q-W1 ‖ Q-W2 for the lit slots (`weakness_snapshots_pkey` backward, `training_cards_userId_deck_due_idx` prefix). */
export async function readTopWeakness(db: TrainDeps["db"], userId: bigint, now: Date): Promise<TopWeakness | null> {
  const [snapshots, bank] = await Promise.all([
    db.$queryRaw<SnapshotHead[]>(latestSnapshotSql(userId)),
    db.$queryRaw<{ theme: string; n: number }[]>(bankThemeCountsSql(userId, now)),
  ]);
  return topWeaknessOf(snapshots[0], bank);
}

/**
 * The lit-slot read for a viewer: null with the `weakness` flag off (no statement runs, so the P5 batch is unchanged).
 * `weakness` overrides the flag (tests and callers that already evaluated it).
 */
export async function topWeaknessFor(db: TrainDeps["db"], viewer: Viewer, now: Date, weakness?: boolean): Promise<TopWeakness | null> {
  const on = weakness ?? (await weaknessEnabled(viewer));
  return on ? readTopWeakness(db, viewer.id, now) : null;
}

/** Options of the lit reads: `weakness` = the viewer's flag when the caller already knows it (else it is evaluated). */
export type LightsUpOptions = { weakness?: boolean };

// ── Statement (c): the due preview ──────────────────────────────────────────────────────────────────────────────
export function duePreviewSql(userId: bigint, now: Date, limit = 4): Prisma.Sql {
  return Prisma.sql`SELECT c."itemKey", c.theme, m.fen, m."setupUci", m.color, m."lastOpponentName", m."moveNumber"
    FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
    WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND c.due <= ${at(now)}
      AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${at(now)}) AND m."hiddenAt" IS NULL
    ORDER BY c.due, c.id LIMIT ${limit}`;
}

export type PreviewRow = {
  itemKey: string;
  theme: string;
  fen: string;
  setupUci: string | null;
  color: string;
  lastOpponentName: string;
  moveNumber: number;
};

/** A due thumbnail: the position the member moves in, its accessible name "Due: loose piece vs tal_fan_77, move 19". */
export function duePreviewOf(r: PreviewRow): DuePreview {
  const label = themeLabel(r.theme);
  const opponent = (r.lastOpponentName ?? "").slice(0, 40);
  const moveNo = Math.max(1, num(r.moveNumber));
  return {
    cardRef: r.itemKey,
    fen: positionAfter(r.fen, r.setupUci),
    orient: r.color === "b" ? "b" : "w",
    lastMove: lastMoveOf(r.setupUci),
    themeLabel: label.slice(0, 40),
    opponent,
    moveNo,
    label: `Due: ${label.toLowerCase()} vs ${opponent}, move ${moveNo}`.slice(0, 120),
  };
}

// ── The plan (built once per local day) ─────────────────────────────────────────────────────────────────────────
/** Today's graded attempts (the plan-step progress when a plan is built after some training today). */
export function todaysAttemptsSql(userId: bigint, from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`SELECT a.deck::text AS deck, a.theme, c."itemKey"
    FROM training_attempts a LEFT JOIN training_cards c ON c.id = a."cardId"
    WHERE a."userId" = ${userId} AND a."reviewedAt" >= ${at(from)} AND a."reviewedAt" < ${at(to)} AND a.grade IS NOT NULL`;
}

/** The plan write (`COALESCE` keeps a concurrent first plan; its done bits are only seeded when this plan wins). */
export function upsertPlanSql(
  userId: bigint,
  day: string,
  plan: DailyPlanV1,
  planDone: number,
  zone: { timeZone: string; dayStartHour: number } = { timeZone: "UTC", dayStartHour: 4 },
): Prisma.Sql {
  // A new row records the zone its day was opened in (m5b, FIX-1 tz-pin); an existing row keeps its own.
  return Prisma.sql`INSERT INTO training_days ("userId", day, plan, "planDone", "timeZone", "dayStartHour", "updatedAt")
    VALUES (${userId}, ${dayParam(day)}, ${JSON.stringify(plan)}::jsonb, ${planDone}::smallint, ${zone.timeZone}, ${zone.dayStartHour}::smallint, ${NOW_UTC})
    ON CONFLICT ("userId", day) DO UPDATE SET plan = COALESCE(training_days.plan, EXCLUDED.plan),
      "planDone" = CASE WHEN training_days.plan IS NULL THEN training_days."planDone" | EXCLUDED."planDone" ELSE training_days."planDone" END,
      "updatedAt" = ${NOW_UTC}
    RETURNING plan, "planDone"`;
}

async function freezePlan(
  deps: TrainDeps,
  viewer: Pick<Viewer, "id">,
  state: TrainState,
  themes: readonly ThemeMasteryRow[],
  weakness: TopWeakness | null,
): Promise<{ plan: DailyPlanV1; planDone: number }> {
  const { db } = deps;
  const { clock, due, profile } = state;
  const [dueRows, lastGames, attempts] = await Promise.all([
    db.$queryRaw<DueCardRow[]>(dueCardsSql(viewer.id, clock.now)),
    due.total === 0 ? db.$queryRaw<LastGameRow[]>(lastGameSql(viewer.id)) : Promise.resolve([] as LastGameRow[]),
    db.$queryRaw<{ deck: string; theme: string; itemKey: string | null }[]>(todaysAttemptsSql(viewer.id, clock.dayStartUtc, clock.dayEndUtc)),
  ]);
  const byKey = new Map(dueRows.map((r) => [r.itemKey, r]));
  const queue: PlanBankCard[] = orderDueQueue(dueRows.map(bankCardIn), clock.now).map((c) => {
    const r = byKey.get(c.key)!;
    return {
      key: c.key,
      game: r.lastGameId === null ? `m:${c.key}` : String(r.lastGameId),
      playedAt: asDate(r.lastPlayedAt) ?? clock.now,
      opponent: (r.lastOpponentName ?? "").slice(0, 40),
    };
  });
  const cap = capOf(due, profile, state.counters);
  const lg = lastGames[0];
  const built = buildDailyPlan({
    now: clock.now,
    timeZone: clock.timeZone,
    dueShown: cap.dueShown,
    bankQueue: queue,
    bankTotal: due.total,
    lastGame: lg ? { ref: lg.ref, opponent: (lg.opponent ?? "").slice(0, 40), reviewed: Boolean(lg.reviewed), moments: num(lg.moments) } : null,
    themes: planThemesOf(themes),
    puzzleRating: profile.puzzleRating,
    // P6: a READY profile focuses step 2 on its first matchable row and says the plan is built from the games.
    ...(weakness ? { weaknessTheme: weakness.focusTheme, weaknessVoice: weakness.focusVoice, basis: "games20" as const } : {}),
  });
  // The puzzle kill switch (PUZZLES_ENABLED=off) omits the step before the plan is frozen (step indices are bits).
  const plan = validatePlan(puzzlesEnabled() ? built : { ...built, steps: built.steps.filter((s) => s.kind !== "puzzles") });
  const gradedKeys = new Set(attempts.flatMap((a) => (a.itemKey ? [a.itemKey] : [])));
  const puzzlesByTheme = new Map<string, number>();
  for (const a of attempts) if (a.deck === "PUZZLE") puzzlesByTheme.set(a.theme, (puzzlesByTheme.get(a.theme) ?? 0) + 1);
  const bits = planDoneBits(plan, { gradedKeys, puzzlesByTheme });

  const written = await deps.tx(async (tx) => {
    const rows = await tx.$queryRaw<{ plan: unknown; planDone: number }[]>(upsertPlanSql(viewer.id, clock.today, plan, bits, { timeZone: clock.timeZone, dayStartHour: clock.dayStartHour }));
    if (!profile.exists) await tx.$executeRaw(insertProfileSql(viewer.id, profile));
    return rows[0];
  });
  return { plan: parseDailyPlan(written?.plan) ?? plan, planDone: num(written?.planDone ?? bits) };
}

// ── The empty-bank steps, live (browser pass D3) ───────────────────────────────────────────────────────────────
/**
 * One statement, read only when the frozen plan has a "Review your last game" or "Import games" step: the frozen
 * game's review state, the newest analysed game (lastGameSql's pick) and whether an account is linked.
 */
export function emptyStepsLiveSql(userId: bigint, frozenRef: string | null): Prisma.Sql {
  return Prisma.sql`SELECT
      EXISTS (SELECT 1 FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${userId}
                JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
               WHERE g."referenceId" = ${frozenRef ?? ""} AND pr."completedAt" IS NOT NULL) AS "frozenReviewed",
      (SELECT row_to_json(l) FROM (${lastGameSql(userId)}) l) AS "lastGame",
      EXISTS (SELECT 1 FROM linked_accounts la WHERE la."userId" = ${userId}) AS "importConnected"`;
}

type EmptyStepsRow = { frozenReviewed: boolean; lastGame: unknown; importConnected: boolean };

/** Today's plan with its empty-bank steps read live: the review step's target and done bit, the import step's bit. */
async function withLiveEmptySteps(
  db: TrainDeps["db"],
  userId: bigint,
  frozen: { plan: DailyPlanV1; planDone: number },
): Promise<{ plan: DailyPlanV1; planDone: number }> {
  if (!frozen.plan.steps.some((s) => s.kind === "review" || s.kind === "import")) return frozen;
  const frozenRef = frozen.plan.steps.map(reviewStepRef).find((r) => r !== null) ?? null;
  const row = (await db.$queryRaw<EmptyStepsRow[]>(emptyStepsLiveSql(userId, frozenRef)))[0];
  const raw = (typeof row?.lastGame === "string" ? JSON.parse(row.lastGame) : row?.lastGame) as LastGameRow | null | undefined;
  const lastGame = raw ? { ref: raw.ref, opponent: (raw.opponent ?? "").slice(0, 40), reviewed: Boolean(raw.reviewed), moments: num(raw.moments) } : null;
  const live = liveEmptySteps(frozen.plan, { frozenReviewed: Boolean(row?.frozenReviewed), lastGame, importConnected: Boolean(row?.importConnected) });
  return { plan: { ...frozen.plan, steps: live.steps }, planDone: frozen.planDone | live.bits };
}

// ── R1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The picker themes the member has trained, in picker order (≤ 3: the hub's "Puzzles by theme" row). */
function trainedPickerThemes(themes: readonly ThemeMasteryRow[]): TrainToday["allTraining"]["puzzles"]["themes"] {
  const byKey = new Map(themes.map((t) => [t.theme, t]));
  return PICKER_THEMES.flatMap((key) => {
    const t = byKey.get(key);
    if (!t || num(t.attempts) === 0) return [];
    return [{ key, label: themePluralLabel(key), pct: themePct({ attempts: num(t.attempts), ewma: num(t.ewma) }) }];
  }).slice(0, 3);
}

/** Theme mastery bars: themes with a percentage (≥ 5 attempts), best first (≤ 4). */
function masteryBars(themes: readonly ThemeMasteryRow[]): TrainToday["mastery"] {
  return themes
    .flatMap((t) => {
      const pct = themePct({ attempts: num(t.attempts), ewma: num(t.ewma) });
      return pct === null ? [] : [{ key: t.theme, label: themePluralLabel(t.theme), pct }];
    })
    .sort((a, b) => b.pct - a.pct || (a.key < b.key ? -1 : 1))
    .slice(0, 4);
}

/** R1 (and the hub's first paint): today's frozen plan, streak, due counts and mastery at `now`. */
export async function getTrainToday(viewer: Viewer, now: Date, deps: TrainDeps = trainDeps(), opts: LightsUpOptions = {}): Promise<TrainToday> {
  const { db } = deps;
  const [state, previews, themes, weakness] = await Promise.all([
    loadTrainState(db, viewer, now),
    db.$queryRaw<PreviewRow[]>(duePreviewSql(viewer.id, now)),
    db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)),
    topWeaknessFor(db, viewer, now, opts.weakness),
  ]);
  const { clock, profile, due } = state;
  const stored = parseDailyPlan(state.today?.plan);
  const frozen = stored ? { plan: stored, planDone: state.counters.planDone } : await freezePlan(deps, viewer, state, themes, weakness);
  const live = await withLiveEmptySteps(db, viewer.id, frozen);

  const cap = capOf(due, profile, state.counters);
  // FIX-6 (item 1, D-P6-FIX6-1): the bank step says what is left to review today (the head's count, the size of the
  // session its link opens) and is done when nothing is left; the plan's other steps keep their frozen form.
  let planDone = live.planDone;
  const plan = {
    ...live.plan,
    steps: live.plan.steps.map((frozenStep, i) => {
      const b = liveBankStep(frozenStep, cap.dueShown);
      if (b.done !== null) planDone = b.done ? planDone | (1 << i) : planDone & ~(1 << i);
      return b.step;
    }),
  };
  const statuses = planStepStatuses(plan.steps.length, planDone);
  // FIX-4 item 8: the frozen puzzle step reads the live rating and the live profile's voice (`livePuzzleStep`).
  const liveReason = weakness?.focusTheme ? { theme: weakness.focusTheme, source: weakness.focusVoice } : null;
  const steps: PlanStep[] = plan.steps.map((frozenStep) => livePuzzleStep(frozenStep, { rating: profile.puzzleRating, reason: liveReason, themes: planThemesOf(themes) })).map((s, i) => ({
    kind: s.kind,
    title: s.title,
    subtitle: s.subtitle,
    estMin: Math.max(1, s.estMin),
    status: statuses[i]!,
    href: s.href,
  }));
  const done = planDoneCount(planDone, plan.steps.length);
  const total = plan.steps.length;
  const allDone = total > 0 && done >= total;
  const cta = planCta(plan, planDone);
  const keepGoingHref = puzzlesHref(plan.focusTheme, { source: "hub" });
  const week = streakWeek(state.week.filter(isTrainedDay).map((r) => r.day), clock.today);
  const current = displayedStreak(profile, clock.today);

  return {
    dayKey: clock.today,
    // FIX-5 (item B, D-P6-FIX5-2): the header names the training day (plan §8.10); between local midnight and the
    // rollover (or while a zone change pins the day) that day is no longer today's date, so it reads "Wednesday's
    // plan" and never contradicts a batch "today at 09:30" on the same screen.
    weekdayLabel: clock.today === formatYmd(localDate(clock.now, clock.timeZone)) ? weekdayLabel(clock.today) : `${weekdayLabel(clock.today)}'s plan`,
    plannedMinutes: planMinutes(plan),
    state: allDone || (due.total > 0 && cap.dueShown === 0) ? "nothingdue" : "default",
    streak: { current, best: Math.max(profile.dayStreakBest, current), week, aria: streakAria(current, week) },
    plan: {
      steps,
      done,
      total,
      basis: plan.basis,
      cta: { kind: cta.kind, label: cta.label, href: cta.kind === "keep_going" ? keepGoingHref : null },
      footnote: planFootnote(plan.basis, profile.bankDailyCap),
    },
    due: {
      shown: cap.dueShown,
      raw: cap.dueRaw,
      capRemaining: cap.capRemaining,
      cap: profile.bankDailyCap,
      waitingLine: waitingLine(cap, profile.bankDailyCap),
      preview: previews.slice(0, Math.min(4, cap.dueShown)).map(duePreviewOf),
    },
    nextBatch: nextBatchOf(batchesOf(due, profile, state.counters, clock), clock),
    allTraining: {
      bank: { due: cap.dueShown, total: due.total },
      puzzles: { themes: trainedPickerThemes(themes) },
      // P6: only with a READY profile (flag on); absent otherwise, so the P5 body is unchanged.
      ...(weakness ? { weakness: { label: weakness.label, inBank: weakness.inBank, href: weakness.href } } : {}),
    },
    mastery: masteryBars(themes),
    keepGoing: allDone ? { href: keepGoingHref, label: keepGoingLabel(plan.focusTheme) } : null,
    puzzleRating: ratingView(profile),
    prefs: { timeZone: clock.timeZone, dayStartHour: profile.dayStartHour, releaseHour: profile.releaseHour },
  };
}
