// R1 `GET /api/train/today` and the `/train` RSC seed (phase-05 plan §7.3 R1, §8.5, §8.9, §8.10, §5.2 S2).
//
// One parallel batch: the training state (profile, today's and this week's rows, the due summary: day.server.ts),
// the due preview (statement (c), ≤ 4 cards) and theme mastery (statement (d)). On the first read of a local day the
// plan is built (one more read: the ≤ 50 due cards, plus the newest analysed game for an empty bank and today's
// attempts) and frozen with ONE write batch: the plan upsert (`COALESCE` keeps the first plan when two tabs race) and
// the lazy profile row with the puzzle-rating seed. Those two statements are R1's registered GET side effect
// (`sideEffects: ["daily_plan"]`); a second read of the day writes nothing.
import { Prisma } from "@repo/db";
import { buildDailyPlan as validatePlan, parseDailyPlan, type DailyPlanV1 } from "@repo/db/json";
import type { DuePreview, PlanStep, TrainToday } from "@repo/contracts/http/train";
import { waitingLine } from "@repo/chess-training/caps";
import { weekdayLabel } from "@repo/chess-training/labels";
import { themePct } from "@repo/chess-training/mastery";
import {
  buildDailyPlan,
  keepGoingLabel,
  planCta,
  planDoneBits,
  planDoneCount,
  planFootnote,
  planMinutes,
  planStepStatuses,
  puzzlesHref,
  type PlanBankCard,
} from "@repo/chess-training/plan";
import { orderDueQueue } from "@repo/chess-training/session";
import { displayedStreak, streakAria, streakWeek } from "@repo/chess-training/streak";
import { PICKER_THEMES, themeLabel, themePluralLabel } from "@repo/chess-training/themes";
import type { Viewer } from "@/lib/auth/viewer";
import { capOf } from "./badges.server";
import {
  bankCardIn,
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
export async function getTrainToday(viewer: Viewer, now: Date, deps: TrainDeps = trainDeps()): Promise<TrainToday> {
  const { db } = deps;
  const [state, previews, themes] = await Promise.all([
    loadTrainState(db, viewer, now),
    db.$queryRaw<PreviewRow[]>(duePreviewSql(viewer.id, now)),
    db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)),
  ]);
  const { clock, profile, due } = state;
  const stored = parseDailyPlan(state.today?.plan);
  const { plan, planDone } = stored ? { plan: stored, planDone: state.counters.planDone } : await freezePlan(deps, viewer, state, themes);

  const cap = capOf(due, profile, state.counters);
  const statuses = planStepStatuses(plan.steps.length, planDone);
  const steps: PlanStep[] = plan.steps.map((s, i) => ({
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
    weekdayLabel: weekdayLabel(clock.today),
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
    nextBatch: nextBatchOf(due, clock.timeZone, clock.now),
    allTraining: { bank: { due: cap.dueShown, total: due.total }, puzzles: { themes: trainedPickerThemes(themes) } },
    mastery: masteryBars(themes),
    keepGoing: allDone ? { href: keepGoingHref, label: keepGoingLabel(plan.focusTheme) } : null,
    puzzleRating: ratingView(profile),
    prefs: { timeZone: clock.timeZone, dayStartHour: profile.dayStartHour, releaseHour: profile.releaseHour },
  };
}
