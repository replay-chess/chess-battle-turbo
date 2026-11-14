// W1 `POST /api/train/attempts` (phase-05 plan §7.3 W1, §5.4, §8.2–§8.10, §11 rating integrity): the outbox flush.
//
// One interactive transaction (`TRAIN_TX_OPTIONS`; tx-scoped client only) of four statements (§9.1; FIX-1, FIX-2):
// first the member's attempts lock (`LOCK_TRAIN_ATTEMPTS`, its own statement, so the member's batches apply one at a
// time and the next statement's snapshot is taken AFTER the wait: it sees every attempt the lock holder committed),
// then ONE read that locks, in one fixed order, the member's profile row, the cards by id, the sessions, the member's
// theme rows; in the same statement the duplicate check (an attempt replayed by a concurrent flush is a duplicate,
// never applied twice), the sessions' graded items and the day rows. The write checks that every attempt row it
// applies effects for was inserted (a lost race would roll the whole batch back, never apply it twice). Then, in TS and in
// `reviewedAt` order (each attempt graded with `now = reviewedAt`, arch §2.3.5): the once-a-day rule (§8.5), FSRS +
// release snapping (§8.2, §8.4), mastery (§8.8), the cap counters, the Again re-queue (§8.6), Glicko for puzzles
// (§8.7, the objective score, never the chosen grade), the theme EWMA and milestone, the day streak (§8.9) and the
// plan-step bits (§8.10). The writes are ONE set-based statement (data-modifying CTEs over `jsonb_to_recordset`), then
// the due read. Days are the member's training days with the day in progress pinned across a zone change (FIX-1).
//
// Results per attempt: `ok`, `duplicate` (already applied), `conflict` (the card moved on since the payload was
// built: `cardReps` differs; the session item was already graded; a sessionless grade that would not reschedule; no
// write), `rejected` (`too_old`, `not_found`, `bad_item`). A 402 (membership) rejects
// the whole batch before this runs (route()).
import { Prisma } from "@repo/db";
import { buildSessionItems, parseDailyPlan, type DailyPlanV1, type PuzzleSnapshotV1 } from "@repo/db/json";
import type { AttemptIn, AttemptOut, AttemptsResult, PuzzleRatingState } from "@repo/contracts/http/train";
import { capIncrements, isScheduled } from "@repo/chess-training/caps";
import { addDaysToKey, dayAnchorOf, dayKey, trainingDayAt, type DayWindow } from "@repo/chess-training/day";
import { newCardRow, scheduleCard, type CardRow, type Scheduled } from "@repo/chess-training/fsrs";
import { objectiveScore, requeueAfterAgain, solveStreakAfter, type GradeKey, type SolveFlags } from "@repo/chess-training/grade";
import { dayLabel } from "@repo/chess-training/labels";
import { applyThemeAttempt, masteryOf, themePct, type ThemeMasteryState } from "@repo/chess-training/mastery";
import { planDoneBits } from "@repo/chess-training/plan";
import { isProvisional, ratePuzzle } from "@repo/chess-training/rating";
import { givesMate } from "@repo/chess-training/mates";
import { applyStreak, type StreakState } from "@repo/chess-training/streak";
import { getRouteDeps } from "@/lib/api/context";
import type { Viewer } from "@/lib/auth/viewer";
import { capOf, readDueSummary, ZERO_DAY } from "./badges.server";
import { timeZoneOf, trainClock } from "./day.server";
import { asDate, dayParam, LOCK_TRAIN_ATTEMPTS, memberLockSql, NOW_UTC, num, trainDeps, type TrainDb, type TrainDeps } from "./db.server";
import { CARD_COLUMNS, MISTAKE_COLUMNS, cardRowOf, gradeDb, itemKindDb, positionAfter, type CardRowDb } from "./dto.server";
import { defaultProfile, insertProfileSql, profileOfRow, ratingsSql, seedOf, type RatingSource, type TrainingProfile } from "./profile.server";
import { storedItemsOf, type SessionRow, type StoredItem } from "./sessions.server";

const DAY_MS = 86_400_000;
/** Accepted client clock: [now − 7 d, now + 5 min] (§11). */
export const REVIEWED_AT_PAST_MS = 7 * DAY_MS;
export const REVIEWED_AT_FUTURE_MS = 5 * 60_000;
/** Older than this on the device → rejected/too_old (the outbox flags them `stale`). */
export const TOO_OLD_MS = 14 * DAY_MS;

export type ApplyOutcome = {
  result: AttemptsResult;
  /** Counts for `train_attempts_applied`. */
  stats: {
    n: number;
    ok: number;
    duplicates: number;
    conflicts: number;
    rejected: number;
  };
  /** The batch graded at least one BANK card. */
  touchedBank: boolean;
  /** A session of the batch has every item graded now. */
  sessionFinished: boolean;
  due: {
    bankDue: number;
    dueRaw: number;
    total: number;
    nextAt: string | null;
  };
};

/** `reviewedAt` clamped to the accepted window. */
export function clampReviewedAt(reviewedAt: string, now: Date): Date {
  const t = Date.parse(reviewedAt);
  const lo = now.getTime() - REVIEWED_AT_PAST_MS;
  const hi = now.getTime() + REVIEWED_AT_FUTURE_MS;
  return new Date(Math.min(hi, Math.max(lo, Number.isFinite(t) ? t : now.getTime())));
}

/** The outbox marks items older than 14 days `stale`; the server also refuses what is older than that by its clock. */
export function isTooOld(a: Pick<AttemptIn, "reviewedAt" | "stale">, now: Date): boolean {
  return a.stale === true || Date.parse(a.reviewedAt) < now.getTime() - TOO_OLD_MS;
}

const flagsOf = (a: AttemptIn): SolveFlags => ({
  shown: a.solutionShown,
  wrongs: a.wrongMovesUci.length,
  hints: a.hintsUsed,
});
const splitUci = (line: string | null | undefined) => (line ?? "").trim().split(/\s+/).filter(Boolean);

/**
 * Rating integrity (§11): the first wrong move may not be a move that solves the position: the stored move, an
 * accepted one, or (when the stored move mates, `baseFen` given) any other mate (plan §8.1 step 2, FIX-1 alt-mate).
 */
export function isBadItem(a: Pick<AttemptIn, "wrongMovesUci">, solution: readonly string[], accept: readonly string[], baseFen: string | null = null): boolean {
  const first = a.wrongMovesUci[0];
  if (!first) return false;
  if (first === solution[0] || accept.includes(first)) return true;
  return baseFen !== null && solution[0] !== undefined && givesMate(baseFen, solution[0]) && givesMate(baseFen, first);
}

// ── Statements (inside the transaction; FIX-1 statement budget: plan §9.1 "≈ 7 round trips") ─────────────────────
// W1 runs 4 statements in its transaction (5 when a touched day's plan is still open; +3 once, for a member's very
// first write, when the profile row does not exist yet): the member lock, the locked read, the batch write, the due read.

/** The profile columns of the locked read (the same as profileSql). */
const PROFILE_COLS = Prisma.sql`"puzzleRating", "puzzleRd", "puzzleVol", "puzzleAttempts", "ratingSeeded", "solveStreak",
      "solveStreakBest", "dayStreak", "dayStreakBest", to_char("lastActiveDay", 'YYYY-MM-DD') AS "lastActiveDay",
      "dayStartHour", "releaseHour", "bankDailyCap", "newPerDay", "autoGrade"`;

/**
 * The W1 read, one statement. Locks in one fixed order (profile → cards by id → sessions by id → the member's theme
 * rows), the same order J1 takes cards then theme rows, so two flushes never deadlock and never lose an EWMA update;
 * then the duplicate check, the locked sessions' graded items, and the member's day rows around the batch (the cap
 * counters, the frozen plans and the zone each day was opened in). Ids leave as text (json numbers lose int64 digits).
 */
export function w1ReadSql(
  userId: bigint,
  a: {
    keys: readonly string[];
    refs: readonly string[];
    ids: readonly string[];
    dayFrom: string;
    dayTo: string;
  },
): Prisma.Sql {
  return Prisma.sql`WITH p AS (
      SELECT ${PROFILE_COLS} FROM training_profiles WHERE "userId" = ${userId} FOR UPDATE
    ), c AS (
      SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS}
        FROM training_cards c LEFT JOIN mistakes m ON m.id = c."mistakeId" LEFT JOIN games g ON g.id = m."lastGameId"
       WHERE c."userId" = ${userId} AND c."itemKey" = ANY(${a.keys as string[]}::text[]) ORDER BY c.id FOR UPDATE OF c
    ), s AS (
      SELECT id, "referenceId", kind::text AS kind, status::text AS status, source, "filterKey", theme, size, mix,
             "countsTowardCap", items, to_char(day, 'YYYY-MM-DD') AS day, "startedAt", "endedAt"
        FROM training_sessions WHERE "userId" = ${userId} AND "referenceId" = ANY(${a.refs as string[]}::text[]) ORDER BY id FOR UPDATE
    ), t AS (
      SELECT theme, attempts, "firstTry", ewma, "milestonePct" FROM theme_mastery WHERE "userId" = ${userId} ORDER BY theme FOR UPDATE
    )
    SELECT (SELECT row_to_json(p) FROM p) AS profile,
      (SELECT COALESCE(json_agg(to_jsonb(c) || jsonb_build_object('cardId', c."cardId"::text, 'mistakeId', c."mistakeId"::text)), '[]'::json) FROM c) AS cards,
      (SELECT COALESCE(json_agg(to_jsonb(s) || jsonb_build_object('id', s.id::text)), '[]'::json) FROM s) AS sessions,
      (SELECT COALESCE(json_agg(t), '[]'::json) FROM t) AS themes,
      (SELECT COALESCE(json_agg("clientAttemptId"::text), '[]'::json) FROM training_attempts
        WHERE "clientAttemptId" = ANY(${a.ids as string[]}::uuid[])) AS dups,
      (SELECT COALESCE(json_agg(json_build_object('s', x."sessionId"::text, 'i', x."itemId")), '[]'::json) FROM training_attempts x
        WHERE x."userId" = ${userId} AND x."reviewedAt" >= (SELECT min("startedAt") FROM s) - interval '7 days'
          AND x."sessionId" IN (SELECT id FROM s)) AS graded,
      (SELECT COALESCE(json_agg(d ORDER BY d.day), '[]'::json) FROM (
        SELECT to_char(day, 'YYYY-MM-DD') AS day, plan, "planDone", "bankReviewed", "newIntroduced", "timeZone", "dayStartHour"
          FROM training_days WHERE "userId" = ${userId} AND day >= ${dayParam(a.dayFrom)} AND day <= ${dayParam(a.dayTo)}) d) AS days`;
}

/** The profile row alone, locked (after a member's first write created it). */
export const lockProfileSql = (userId: bigint) => Prisma.sql`SELECT ${PROFILE_COLS} FROM training_profiles WHERE "userId" = ${userId} FOR UPDATE`;

/** Earlier graded attempts of the days whose plan is still open (one statement for every such day; plan bits). */
export function dayAttemptsSql(userId: bigint, windows: readonly { day: string; from: Date; to: Date }[]): Prisma.Sql {
  const json = windows.map((w) => ({
    day: w.day,
    from: w.from.toISOString(),
    to: w.to.toISOString(),
  }));
  return Prisma.sql`SELECT d.day, a.deck::text AS deck, a.theme, c."itemKey"
    FROM jsonb_to_recordset(${JSON.stringify(json)}::jsonb) AS d(day text, "from" text, "to" text)
    JOIN training_attempts a ON a."userId" = ${userId} AND a."reviewedAt" >= (d."from"::timestamptz AT TIME ZONE 'UTC')
      AND a."reviewedAt" < (d."to"::timestamptz AT TIME ZONE 'UTC') AND a.grade IS NOT NULL
    LEFT JOIN training_cards c ON c.id = a."cardId"`;
}

/** The batch's writes, one statement (data-modifying CTEs; each one is skipped by an empty input). */
export function w1WriteSql(
  userId: bigint,
  w: {
    cards: readonly object[];
    newCards: readonly object[];
    attempts: readonly object[];
    days: readonly object[];
    themes: readonly object[];
    sessions: readonly object[];
    profile: {
      r: number;
      rd: number;
      vol: number;
      n: number;
      ss: number;
      ds: number;
      dsb: number;
      lad: string | null;
    } | null;
  },
): Prisma.Sql {
  const pr = w.profile;
  return Prisma.sql`WITH cu AS (
      UPDATE training_cards c SET due = (x.due::timestamptz AT TIME ZONE 'UTC'), stability = x.s, difficulty = x.d,
          "elapsedDays" = x.ed, "scheduledDays" = x.sd, "learningSteps" = x.ls, reps = x.reps, lapses = x.lapses,
          state = x.state::"CardState", "lastReview" = (x.lr::timestamptz AT TIME ZONE 'UTC'), mastery = x.m, "updatedAt" = ${NOW_UTC}
        FROM jsonb_to_recordset(${JSON.stringify(w.cards)}::jsonb) AS x(id bigint, "repsBefore" int, due text, s real, d real, ed int, sd int,
          ls int, reps int, lapses int, state text, lr text, m int)
       WHERE c.id = x.id AND c."userId" = ${userId} AND c.reps = x."repsBefore"
      RETURNING c.id
    ), nc AS (
      INSERT INTO training_cards ("userId", deck, kind, "itemKey", "puzzleId", fen, solution, orient, "puzzleRating", theme, due,
          stability, difficulty, "elapsedDays", "scheduledDays", "learningSteps", reps, lapses, state, "lastReview", mastery,
          "createdAt", "updatedAt")
      SELECT ${userId}, 'PUZZLE', 'LICHESS_PUZZLE', x.key, x.pid, x.fen, x.sol, x.orient, x.pr, x.theme,
          (x.due::timestamptz AT TIME ZONE 'UTC'), x.s, x.d, x.ed, x.sd, x.ls, x.reps, x.lapses, x.state::"CardState",
          (x.lr::timestamptz AT TIME ZONE 'UTC'), x.m, ${NOW_UTC}, ${NOW_UTC}
        FROM jsonb_to_recordset(${JSON.stringify(w.newCards)}::jsonb) AS x(key text, pid text, fen text, sol text, orient text, pr int,
          theme text, due text, s real, d real, ed int, sd int, ls int, reps int, lapses int, state text, lr text, m int)
      ON CONFLICT ("userId", "itemKey") DO NOTHING
      RETURNING id, "itemKey"
    ), ta AS (
      INSERT INTO training_attempts ("clientAttemptId", "userId", "cardId", "sessionId", "itemId", deck, kind,
          "puzzleId", "puzzleRating", theme, solved, "firstTry", "hintsUsed", "wrongTries", "wrongMoves", "solutionShown", "timeMs",
          grade, "suggestedGrade", state, stability, difficulty, "elapsedDays", "scheduledDays", "ratingBefore", "ratingAfter", "reviewedAt")
      SELECT x."clientAttemptId"::uuid, ${userId}, COALESCE(x."cardId"::bigint, (SELECT nc.id FROM nc WHERE nc."itemKey" = x."cardKey")),
          x."sessionId"::bigint, x."itemId", x.deck::"TrainingDeck", x.kind::"TrainingItemKind", x."puzzleId", x."puzzleRating", x.theme,
          x.solved, x."firstTry", x."hintsUsed", x."wrongTries", x."wrongMoves", x."solutionShown", x."timeMs", x.grade::"FsrsGrade",
          x."suggestedGrade"::"FsrsGrade", x.state::"CardState", x.stability, x.difficulty, x."elapsedDays", x."scheduledDays",
          x."ratingBefore", x."ratingAfter", (x."reviewedAt"::timestamptz AT TIME ZONE 'UTC')
        FROM jsonb_to_recordset(${JSON.stringify(w.attempts)}::jsonb) AS x("clientAttemptId" text, "cardId" text, "cardKey" text,
          "sessionId" text, "itemId" text, deck text, kind text, "puzzleId" text, "puzzleRating" int, theme text, solved boolean,
          "firstTry" boolean, "hintsUsed" int, "wrongTries" int, "wrongMoves" text, "solutionShown" boolean, "timeMs" int, grade text,
          "suggestedGrade" text, state text, stability real, difficulty real, "elapsedDays" int, "scheduledDays" int,
          "ratingBefore" real, "ratingAfter" real, "reviewedAt" text)
      ON CONFLICT ("clientAttemptId") DO NOTHING
      RETURNING 1
    ), td AS (
      INSERT INTO training_days ("userId", day, "bankReviewed", "newIntroduced", "puzzlesDone", "activeMs", "planDone", "timeZone",
          "dayStartHour", "updatedAt")
      SELECT ${userId}, x.day::date, x.br, x.ni, x.pd, x.ms, x.bits, x.tz, x.dsh, ${NOW_UTC}
        FROM jsonb_to_recordset(${JSON.stringify(w.days)}::jsonb) AS x(day text, br int, ni int, pd int, ms int, bits int, tz text, dsh smallint)
      ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = training_days."bankReviewed" + EXCLUDED."bankReviewed",
        "newIntroduced" = training_days."newIntroduced" + EXCLUDED."newIntroduced",
        "puzzlesDone" = training_days."puzzlesDone" + EXCLUDED."puzzlesDone",
        "activeMs" = training_days."activeMs" + EXCLUDED."activeMs",
        "planDone" = training_days."planDone" | EXCLUDED."planDone", "updatedAt" = ${NOW_UTC}
      RETURNING 1
    ), tm AS (
      INSERT INTO theme_mastery ("userId", theme, attempts, "firstTry", ewma, "milestonePct", "lastAttemptAt")
      SELECT ${userId}, x.theme, x.n, x.ft, x.e, x.mp, (x.at::timestamptz AT TIME ZONE 'UTC')
        FROM jsonb_to_recordset(${JSON.stringify(w.themes)}::jsonb) AS x(theme text, n int, ft int, e real, mp int, at text)
      ON CONFLICT ("userId", theme) DO UPDATE SET attempts = EXCLUDED.attempts, "firstTry" = EXCLUDED."firstTry", ewma = EXCLUDED.ewma,
        "milestonePct" = GREATEST(theme_mastery."milestonePct", EXCLUDED."milestonePct"), "lastAttemptAt" = EXCLUDED."lastAttemptAt"
      RETURNING 1
    ), ts AS (
      UPDATE training_sessions t SET total = t.total + x.total, solved = t.solved + x.solved, "firstTry" = t."firstTry" + x."firstTry",
          "withHint" = t."withHint" + x."withHint", items = COALESCE(x.items, t.items)
        FROM jsonb_to_recordset(${JSON.stringify(w.sessions)}::jsonb) AS x(id bigint, total smallint, solved smallint, "firstTry" smallint,
          "withHint" smallint, items jsonb)
       WHERE t.id = x.id AND t."userId" = ${userId}
      RETURNING 1
    )${
      pr
        ? Prisma.sql`, tp AS (
      UPDATE training_profiles SET "puzzleRating" = ${pr.r}::real, "puzzleRd" = ${pr.rd}::real, "puzzleVol" = ${pr.vol}::real,
          "puzzleAttempts" = ${pr.n}, "solveStreak" = ${pr.ss}::smallint, "solveStreakBest" = GREATEST("solveStreakBest", ${pr.ss}::smallint),
          "dayStreak" = ${pr.ds}::smallint, "dayStreakBest" = GREATEST("dayStreakBest", ${pr.dsb}::smallint),
          "lastActiveDay" = ${pr.lad ? dayParam(pr.lad) : Prisma.sql`NULL::date`}, "updatedAt" = ${NOW_UTC}
       WHERE "userId" = ${userId}
      RETURNING 1
    )`
        : Prisma.empty
    }
    SELECT (SELECT count(*) FROM cu)::int AS cards, (SELECT count(*) FROM nc)::int AS "newCards", (SELECT count(*) FROM ta)::int AS attempts,
      (SELECT count(*) FROM td)::int AS days, (SELECT count(*) FROM tm)::int AS themes, (SELECT count(*) FROM ts)::int AS sessions`;
}

type CardState = CardRowDb & { reps: number };

type WorkingCard = {
  row: CardRowDb;
  card: CardRow;
  repsBefore: number;
  touched: boolean;
  mastery: number;
};

type NewPuzzleCard = {
  key: string;
  puzzleId: string;
  fen: string;
  solution: string;
  orient: string;
  rating: number;
  theme: string;
  card: CardRow;
  mastery: number;
};

type AttemptRowOut = {
  clientAttemptId: string;
  cardKey: string | null;
  cardId: string | null;
  sessionId: string | null;
  itemId: string | null;
  deck: "BANK" | "PUZZLE";
  kind: string;
  puzzleId: string | null;
  puzzleRating: number | null;
  theme: string;
  solved: boolean;
  firstTry: boolean;
  hintsUsed: number;
  wrongTries: number;
  wrongMoves: string | null;
  solutionShown: boolean;
  timeMs: number;
  grade: string | null;
  suggestedGrade: string;
  state: string | null;
  stability: number | null;
  difficulty: number | null;
  elapsedDays: number | null;
  scheduledDays: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  reviewedAt: string;
};

type DayDelta = {
  window: DayWindow;
  bankReviewed: number;
  newIntroduced: number;
  puzzlesDone: number;
  activeMs: number;
  gradedKeys: Set<string>;
  puzzlesByTheme: Map<string, number>;
};

type ReadRow = {
  profile: Parameters<typeof profileOfRow>[0] | null;
  cards: CardState[];
  sessions: (Omit<SessionRow, "id"> & { id: string })[];
  themes: {
    theme: string;
    attempts: number;
    firstTry: number;
    ewma: number;
    milestonePct: number;
  }[];
  dups: string[];
  graded: { s: string; i: string | null }[];
  days: {
    day: string;
    plan: unknown;
    planDone: number;
    bankReviewed: number;
    newIntroduced: number;
    timeZone: string | null;
    dayStartHour: number | null;
  }[];
};

type SessionState = {
  row: SessionRow;
  items: StoredItem[];
  changed: boolean;
  total: number;
  solved: number;
  firstTry: number;
  withHint: number;
  graded: Set<string>;
};

/**
 * W1. One interactive transaction: the locked read, the rules of §8 in `reviewedAt` order, one write statement, the
 * due read. Integrity (FIX-1): an item of a session is graded once (a second grade of it, from another tab or a replay
 * with a fresh clientAttemptId, answers `conflict` and writes nothing); a card's reps must match (`cardReps`, null =
 * no card when the payload was built); a sessionless grade must reschedule its card; a session attempt is never dated
 * before its session started (`reviewedAt` is raised to `startedAt`, so a batch cannot fill streak days before it).
 */
export async function applyAttempts(viewer: Viewer, attempts: readonly AttemptIn[], now: Date, deps: TrainDeps = trainDeps()): Promise<ApplyOutcome> {
  const tz = timeZoneOf(viewer);
  const out = new Map<string, AttemptOut>();
  const live: (AttemptIn & { at: Date })[] = [];
  for (const a of attempts) {
    if (out.has(a.clientAttemptId)) continue;
    if (isTooOld(a, now))
      out.set(a.clientAttemptId, {
        clientAttemptId: a.clientAttemptId,
        status: "rejected",
        reason: "too_old",
      });
    else live.push({ ...a, at: clampReviewedAt(a.reviewedAt, now) });
  }
  live.sort((x, y) => x.at.getTime() - y.at.getTime());

  const tx = await deps.tx(async (db) => applyInTx(db, viewer, live, now, tz, out));
  const results = attempts.map(
    (a) =>
      out.get(a.clientAttemptId) ?? {
        clientAttemptId: a.clientAttemptId,
        status: "rejected" as const,
        reason: "not_found" as const,
      },
  );
  const seen = new Set<string>();
  const unique = results.filter((r) => !seen.has(r.clientAttemptId) && (seen.add(r.clientAttemptId), true));
  const stats = {
    n: unique.length,
    ok: 0,
    duplicates: 0,
    conflicts: 0,
    rejected: 0,
  };
  for (const r of unique) {
    if (r.status === "ok") stats.ok += 1;
    else if (r.status === "duplicate") stats.duplicates += 1;
    else if (r.status === "conflict") stats.conflicts += 1;
    else stats.rejected += 1;
  }
  return {
    result: {
      results: unique,
      capRemaining: tx.capRemaining,
      planDone: tx.planDone,
      bankDue: tx.due.bankDue,
      ...(tx.rating ? { rating: tx.rating } : {}),
    },
    stats,
    touchedBank: tx.touchedBank,
    sessionFinished: tx.sessionFinished,
    due: tx.due,
  };
}

const parseJson = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

async function applyInTx(
  db: TrainDb,
  viewer: Viewer,
  live: readonly (AttemptIn & { at: Date })[],
  now: Date,
  tz: string,
  out: Map<string, AttemptOut>,
): Promise<{
  capRemaining: number;
  planDone: number;
  due: ApplyOutcome["due"];
  touchedBank: boolean;
  sessionFinished: boolean;
  rating: PuzzleRatingState | null;
}> {
  const userId = viewer.id;
  const keys = new Set<string>();
  for (const a of live) {
    if (a.cardRef) keys.add(a.cardRef);
    else if (a.puzzleId) keys.add(`p_${a.puzzleId}`);
  }
  const refs = [...new Set(live.flatMap((a) => (a.sessionRef ? [a.sessionRef] : [])))];
  // The day rows around the batch and today (any day-start hour 0–6 and a pinned day lie within ±2 days).
  const dayKeys = [...live.map((a) => dayKey(a.at, tz, 4)), dayKey(now, tz, 4)].sort();
  const read = async () =>
    (
      await db.$queryRaw<Record<string, unknown>[]>(
        w1ReadSql(userId, {
          keys: [...keys],
          refs,
          ids: live.map((a) => a.clientAttemptId),
          dayFrom: addDaysToKey(dayKeys[0]!, -2),
          dayTo: addDaysToKey(dayKeys[dayKeys.length - 1]!, 2),
        }),
      )
    )[0]!;
  // The member's batches one at a time (FIX-2): a second flush waits here and its read then sees the first one's rows.
  await db.$queryRaw(memberLockSql(LOCK_TRAIN_ATTEMPTS, userId));
  const raw = await read();
  let profileRow = parseJson<ReadRow["profile"]>(raw.profile);
  if (!profileRow) {
    // A member's first write: the row with the seed, then its lock (the other locks were taken by the read above).
    const accounts = await db.$queryRaw<RatingSource[]>(ratingsSql(userId));
    await db.$executeRaw(insertProfileSql(userId, defaultProfile(seedOf(viewer, accounts))));
    profileRow = (await db.$queryRaw<NonNullable<ReadRow["profile"]>[]>(lockProfileSql(userId)))[0] ?? null;
  }
  const profile: TrainingProfile = profileRow ? profileOfRow(profileRow) : defaultProfile(seedOf(viewer, []));
  const dayRows = parseJson<ReadRow["days"]>(raw.days);
  const anchor = dayAnchorOf(dayRows);
  const dsh = profile.dayStartHour;
  const windowAt = (at: Date) => trainingDayAt(at, tz, dsh, anchor);
  const clock = trainClock(now, tz, profile, anchor);

  const cards = new Map<string, WorkingCard>(
    parseJson<CardState[]>(raw.cards).map((r) => [
      r.itemKey,
      {
        row: r,
        card: cardRowOf(r),
        repsBefore: num(r.reps),
        touched: false,
        mastery: num(r.mastery),
      },
    ]),
  );
  const dups = new Set(parseJson<string[]>(raw.dups).map((id) => id.toLowerCase()));
  const gradedRows = parseJson<ReadRow["graded"]>(raw.graded);
  const sessions = new Map<string, SessionState>(
    parseJson<ReadRow["sessions"]>(raw.sessions).map((s0) => {
      const row: SessionRow = {
        ...s0,
        id: BigInt(s0.id),
        startedAt: asDate(s0.startedAt)!,
        endedAt: asDate(s0.endedAt),
      };
      const graded = new Set(gradedRows.flatMap((g) => (g.s === s0.id && g.i ? [g.i] : [])));
      return [
        row.referenceId,
        {
          row,
          items: storedItemsOf(row),
          changed: false,
          total: 0,
          solved: 0,
          firstTry: 0,
          withHint: 0,
          graded,
        },
      ];
    }),
  );
  const themes = new Map<string, ThemeMasteryState & { touched: boolean; lastAttemptAt: Date | null }>(
    parseJson<ReadRow["themes"]>(raw.themes).map((t) => [
      t.theme,
      {
        attempts: num(t.attempts),
        firstTry: num(t.firstTry),
        ewma: num(t.ewma),
        milestonePct: num(t.milestonePct),
        touched: false,
        lastAttemptAt: null,
      },
    ]),
  );

  // Resolve every attempt's item (card, puzzle snapshot, theme, the position it is solved in).
  type Resolved = {
    a: AttemptIn & { at: Date };
    session: SessionState | null;
    deck: "BANK" | "PUZZLE";
    theme: string;
    snapshot: PuzzleSnapshotV1 | null;
    solution: string[];
    accept: string[];
    baseFen: string | null;
    cardKey: string | null;
  };
  // First the batch's own checks and its dating: duplicates, the session, the session start (a session attempt is
  // never dated before its session started: a device clock behind the server's is raised to it), and a sessionless
  // attempt (a contract form no shipped client sends: no session start bounds it) is dated by the server's clock, so it
  // can never fill a past training day (FIX-2, P5-FX-14).
  const pending: {
    a: AttemptIn & { at: Date };
    session: SessionState | null;
  }[] = [];
  for (const a0 of live) {
    if (dups.has(a0.clientAttemptId.toLowerCase())) {
      out.set(a0.clientAttemptId, {
        clientAttemptId: a0.clientAttemptId,
        status: "duplicate",
      });
      continue;
    }
    const session = a0.sessionRef ? (sessions.get(a0.sessionRef) ?? null) : null;
    if (a0.sessionRef && !session) {
      out.set(a0.clientAttemptId, {
        clientAttemptId: a0.clientAttemptId,
        status: "rejected",
        reason: "not_found",
      });
      continue;
    }
    const started = session ? asDate(session.row.startedAt)! : null;
    const at = !session ? now : started && a0.at.getTime() < started.getTime() ? started : a0.at;
    pending.push({ a: at === a0.at ? a0 : { ...a0, at }, session });
  }
  pending.sort((x, y) => x.a.at.getTime() - y.a.at.getTime());

  /** The item of one attempt, resolved when its turn comes (a pass-2 copy re-queued earlier in this batch exists then). */
  const resolve = ({ a, session }: (typeof pending)[number]): Resolved | null => {
    // A session's item must be one of its stored items: an invented itemId, or the pass-2 id of an item that was
    // never re-queued (FIX-2), is not an item.
    const itemId = a.itemId;
    const item = session && itemId ? (session.items.find((it) => it.id === itemId) ?? null) : null;
    if (session && !item) {
      out.set(a.clientAttemptId, {
        clientAttemptId: a.clientAttemptId,
        status: "rejected",
        reason: "not_found",
      });
      return null;
    }
    if (a.kind === "puzzle") {
      const snapshot = item?.p ?? null;
      const cardKey = a.cardRef ?? (a.puzzleId ? `p_${a.puzzleId}` : null);
      const card = cardKey ? cards.get(cardKey) : undefined;
      if (card && card.row.deck !== "PUZZLE") {
        out.set(a.clientAttemptId, {
          clientAttemptId: a.clientAttemptId,
          status: "rejected",
          reason: "bad_item",
        });
        return null;
      }
      const snap: PuzzleSnapshotV1 | null =
        snapshot ??
        (card && card.row.cardFen && card.row.cardSolution && card.row.puzzleId
          ? [card.row.puzzleId, card.row.cardFen, card.row.cardSolution, num(card.row.puzzleRating ?? 1500), card.row.theme]
          : null);
      // The item's card is its own: a stored item's key, or (an item carrying a snapshot) the snapshot's puzzle card
      // (FIX-2: a snapshot item named with another PUZZLE card's ref would reschedule that card).
      const ownKey = item ? (item.p ? `p_${item.p[0]}` : item.key) : null;
      if (
        !snap ||
        (a.puzzleId && snap[0] !== a.puzzleId) ||
        (ownKey !== null && cardKey !== null && ownKey !== cardKey) ||
        (item && !item.p && item.key !== cardKey)
      ) {
        out.set(a.clientAttemptId, {
          clientAttemptId: a.clientAttemptId,
          status: "rejected",
          reason: "not_found",
        });
        return null;
      }
      const tokens = splitUci(snap[2]);
      let baseFen: string | null = null;
      try {
        baseFen = positionAfter(snap[1], tokens[0]);
      } catch {
        baseFen = null;
      }
      return {
        a,
        session,
        deck: "PUZZLE",
        theme: snap[4],
        snapshot: snap,
        solution: tokens.slice(1),
        accept: [],
        baseFen,
        cardKey: card ? cardKey : null,
      };
    }
    const card = a.cardRef ? cards.get(a.cardRef) : undefined;
    if (!card || card.row.deck !== "BANK" || !card.row.mistakeRef || (item && item.key !== card.row.itemKey)) {
      out.set(a.clientAttemptId, {
        clientAttemptId: a.clientAttemptId,
        status: "rejected",
        reason: "not_found",
      });
      return null;
    }
    let baseFen: string | null = null;
    try {
      baseFen = card.row.fen ? positionAfter(card.row.fen, card.row.setupUci) : null;
    } catch {
      baseFen = null;
    }
    return {
      a,
      session,
      deck: "BANK",
      theme: card.row.theme,
      snapshot: null,
      solution: splitUci(card.row.solution),
      accept: splitUci(card.row.accept),
      baseFen,
      cardKey: card.row.itemKey,
    };
  };

  // In order: the rules of §8.
  let rating = {
    r: profile.puzzleRating,
    rd: profile.puzzleRd,
    vol: profile.puzzleVol,
  };
  let rated = false;
  let puzzleAttempts = profile.puzzleAttempts;
  let solveStreak = profile.solveStreak;
  let streak: StreakState = {
    dayStreak: profile.dayStreak,
    dayStreakBest: profile.dayStreakBest,
    lastActiveDay: profile.lastActiveDay,
  };
  const days = new Map<string, DayDelta>();
  const newPuzzleCards = new Map<string, NewPuzzleCard>();
  const rows: AttemptRowOut[] = [];
  let touchedBank = false;
  const prefs = {
    timeZone: tz,
    releaseHour: profile.releaseHour,
    dayStartHour: dsh,
  };

  // Sentry child span `fsrs.apply` (plan §10.2): the rules of §8 over the batch, in memory between the read and the write.
  getRouteDeps().telemetry.startSpan("fsrs.apply", { attempts: String(pending.length) }, () => {
    for (const p of pending) {
      const r = resolve(p);
      if (!r) continue;
      const { a } = r;
      const flags = flagsOf(a);
      if (isBadItem(a, r.solution, r.accept, r.baseFen)) {
        out.set(a.clientAttemptId, {
          clientAttemptId: a.clientAttemptId,
          status: "rejected",
          reason: "bad_item",
        });
        continue;
      }
      const pass: 1 | 2 = a.itemId?.endsWith("b") ? 2 : 1;
      // Once per session item: another tab (or a replay with a new clientAttemptId) already graded it.
      if (r.session && a.itemId && r.session.graded.has(a.itemId)) {
        out.set(a.clientAttemptId, {
          clientAttemptId: a.clientAttemptId,
          status: "conflict",
        });
        continue;
      }
      const working = r.cardKey ? cards.get(r.cardKey) : undefined;
      // Optimistic concurrency: the payload's reps must be the card's (null = no card when it was built, i.e. 0; a pass-2
      // copy carries the pass-1 reps, so it may be one behind once its pass 1 is applied).
      if (working) {
        const expected = a.cardReps ?? 0;
        const passOneApplied = pass === 2 && !!r.session && r.session.graded.has(a.itemId!.slice(0, -1));
        if (!(expected === working.card.reps || (passOneApplied && expected + 1 === working.card.reps))) {
          out.set(a.clientAttemptId, {
            clientAttemptId: a.clientAttemptId,
            status: "conflict",
          });
          continue;
        }
      }
      const window = windowAt(a.at);
      const day = window.key;
      const sessionKind = r.session?.row.kind ?? null;
      const practice = sessionKind === "PRACTICE";
      const countsTowardCap = r.session?.row.countsTowardCap ?? false;
      const explicitPick = sessionKind === "BANK" && !countsTowardCap;
      const grade = a.grade as GradeKey | null;

      let scheduled = false;
      let result: Scheduled | null = null;
      if (grade && working) {
        const before = working.card;
        // A grade dated before the card's last review (an offline replay that another device overtook) never moves the
        // card back in time: it is logged, not scheduled (FSRS refuses a negative elapsed time).
        const outOfOrder = before.lastReview !== null && a.at.getTime() < before.lastReview.getTime();
        scheduled =
          !outOfOrder &&
          isScheduled({
            state: before.state,
            due: before.due,
            lastReview: before.lastReview,
            reviewedAt: a.at,
            explicitPick: explicitPick || !r.session,
            practice,
            timeZone: tz,
            dayStartHour: dsh,
          });
        // A sessionless grade that would not reschedule its card is a replay (the card was graded today): nothing to apply.
        if (!scheduled && !r.session) {
          out.set(a.clientAttemptId, {
            clientAttemptId: a.clientAttemptId,
            status: "conflict",
          });
          continue;
        }
        if (scheduled) {
          const firstGradeToday = !before.lastReview || before.lastReview.getTime() < window.start.getTime();
          result = scheduleCard(before, grade, a.at, prefs);
          working.card = result.card;
          working.mastery = result.mastery;
          working.touched = true;
          if (r.deck === "BANK") {
            const inc = capIncrements({
              deck: "BANK",
              countsTowardCap,
              scheduled,
              firstGradeToday,
              pass,
              stateBefore: result.stateBefore,
            });
            const d = dayDelta(days, window);
            d.bankReviewed += inc.bankReviewed;
            d.newIntroduced += inc.newIntroduced;
          }
        }
      } else if (grade && !working && r.deck === "PUZZLE" && !practice && r.snapshot && newPuzzleCards.has(`p_${r.snapshot[0]}`)) {
        // The card an earlier attempt of THIS batch created (pass 1 Again, then its pass-2 copy, flushed together from the
        // outbox): graded exactly as the next batch would grade it once the card exists (FIX-2: online = offline).
        const fresh = newPuzzleCards.get(`p_${r.snapshot[0]}`)!;
        const before = fresh.card;
        const outOfOrder = before.lastReview !== null && a.at.getTime() < before.lastReview.getTime();
        scheduled =
          !outOfOrder &&
          isScheduled({
            state: before.state,
            due: before.due,
            lastReview: before.lastReview,
            reviewedAt: a.at,
            explicitPick,
            practice,
            timeZone: tz,
            dayStartHour: dsh,
          });
        if (scheduled) {
          result = scheduleCard(before, grade, a.at, prefs);
          fresh.card = result.card;
          fresh.mastery = result.mastery;
        }
      } else if (grade && !working && r.deck === "PUZZLE" && !practice && (grade === "again" || grade === "hard") && r.snapshot) {
        // D-6: a missed puzzle (not a clean first-try solve) becomes a PUZZLE card; a clean solve is only logged.
        const key = `p_${r.snapshot[0]}`;
        {
          scheduled = true;
          result = scheduleCard({ ...newCardRow(a.at), fuzzKey: key }, grade, a.at, prefs);
          const tokens = r.snapshot[1].split(" ");
          newPuzzleCards.set(key, {
            key,
            puzzleId: r.snapshot[0],
            fen: r.snapshot[1],
            solution: r.snapshot[2],
            orient: tokens[1] === "w" ? "b" : "w",
            rating: r.snapshot[3],
            theme: r.snapshot[4],
            card: result.card,
            mastery: result.mastery,
          });
        }
      }
      const d = dayDelta(days, window);
      d.activeMs += a.timeMs;
      if (r.deck === "BANK" && grade) {
        touchedBank = true;
        if (r.cardKey) d.gradedKeys.add(r.cardKey);
      }

      // Requeue (§8.6): a scheduled Again on pass 1 inserts the pass-2 copy at min(i + 4, length), once, while the list has room
      // (SESSION_ITEMS_MAX); the new list is validated before it is kept, so a stored list is always readable.
      let requeued = false;
      // A grade the once-a-day rule logs as practice (`scheduled` false) queues no copy: its item showed no previews, so
      // the runner queued none either (FIX-2).
      if (grade === "again" && pass === 1 && scheduled && r.session && !practice && a.itemId) {
        const i = r.session.items.findIndex((it) => it.id === a.itemId);
        if (i >= 0) {
          const rq = requeueAfterAgain(
            r.session.items.map((it) => ({ ...it, itemId: it.id })),
            i,
            (it) => ({ ...it, skipped: undefined }),
          );
          if (rq.requeued) {
            const next = rq.items.map(
              ({ itemId, ...it }) =>
                ({
                  ...it,
                  id: itemId,
                  pass: it.pass,
                  ...(it.skipped ? { skipped: true } : {}),
                }) as StoredItem,
            );
            const valid = (() => {
              try {
                return buildSessionItems({
                  v: 1,
                  items: next.map(({ skipped, ...it }) => (skipped ? { ...it, skipped } : it)),
                }).items;
              } catch {
                return null;
              }
            })();
            if (valid) {
              r.session.items = valid;
              r.session.changed = true;
              requeued = true;
            }
          }
        }
      }

      // Puzzle rating (pass 1 of a session puzzle, not practice): the objective score against the snapshot's rating. A
      // sessionless grade never moves the rating (FIX-2: the server did not serve that puzzle; it could be re-graded).
      let ratingOut: AttemptOut["rating"] | undefined;
      let ratingBefore: number | null = null;
      let ratingAfter: number | null = null;
      if (r.deck === "PUZZLE" && grade && pass === 1 && !practice && r.snapshot && r.session) {
        ratingBefore = rating.r;
        const next = ratePuzzle(rating, r.snapshot[3], objectiveScore(flags));
        rating = { r: next.r, rd: next.rd, vol: next.vol };
        rated = true;
        ratingAfter = next.r;
        puzzleAttempts += 1;
        ratingOut = {
          value: Math.round(next.r),
          delta: next.delta,
          provisional: isProvisional(puzzleAttempts),
        };
      }
      if (r.deck === "PUZZLE" && grade && pass === 1) {
        d.puzzlesDone += 1;
        d.puzzlesByTheme.set(r.theme, (d.puzzlesByTheme.get(r.theme) ?? 0) + 1);
      }

      // Solve streak, theme mastery, day streak (graded pass-1 attempts).
      let themeOut: AttemptOut["theme"] | undefined;
      if (grade && pass === 1) {
        solveStreak = solveStreakAfter(solveStreak, flags);
        const prev = themes.get(r.theme) ?? {
          attempts: 0,
          firstTry: 0,
          ewma: 0,
          milestonePct: 0,
          touched: false,
          lastAttemptAt: null,
        };
        const next = applyThemeAttempt(prev, a.firstTry);
        themes.set(r.theme, {
          attempts: next.attempts,
          firstTry: next.firstTry,
          ewma: next.ewma,
          milestonePct: next.milestonePct,
          touched: true,
          lastAttemptAt: a.at,
        });
        themeOut = {
          key: r.theme,
          pct: themePct(next),
          ...(next.milestone ? { milestone: next.milestone } : {}),
        };
      }
      if (grade) streak = applyStreak(streak, day);

      if (r.session && a.itemId) {
        r.session.graded.add(a.itemId);
        if (pass === 1) {
          r.session.total += 1;
          if (a.solved && !a.solutionShown) r.session.solved += 1;
          if (a.firstTry) r.session.firstTry += 1;
          if (a.solved && !a.solutionShown && a.hintsUsed > 0 && a.wrongMovesUci.length === 0) r.session.withHint += 1;
        }
      }

      let cardOut: AttemptOut["card"] | undefined;
      const cardNow = working ?? (r.snapshot ? newPuzzleCards.get(`p_${r.snapshot[0]}`) : undefined);
      if (cardNow) {
        const card = cardNow.card;
        const key = "row" in cardNow ? cardNow.row.itemKey : cardNow.key;
        cardOut = {
          ref: key,
          due: card.due.toISOString(),
          dueLabel: dayLabel(card.due, now, tz),
          mastery: cardNow.mastery,
          reps: card.reps,
          scheduled,
          requeued,
        };
      }
      const after = result?.card ?? null;
      rows.push({
        clientAttemptId: a.clientAttemptId,
        cardKey: cardNow ? cardOut!.ref : null,
        cardId: working ? String(working.row.cardId) : null,
        sessionId: r.session ? String(r.session.row.id) : null,
        itemId: a.itemId,
        deck: r.deck,
        kind: itemKindDb(a.kind),
        puzzleId: r.snapshot ? r.snapshot[0] : null,
        puzzleRating: r.snapshot ? Math.round(r.snapshot[3]) : null,
        theme: r.theme,
        solved: a.solved,
        firstTry: a.firstTry,
        hintsUsed: a.hintsUsed,
        wrongTries: a.wrongMovesUci.length,
        wrongMoves: a.wrongMovesUci.length ? a.wrongMovesUci.join(" ").slice(0, 60) : null,
        solutionShown: a.solutionShown,
        timeMs: a.timeMs,
        grade: grade ? gradeDb(grade) : null,
        suggestedGrade: gradeDb(a.suggestedGrade),
        state: after ? after.state : null,
        stability: after ? after.stability : null,
        difficulty: after ? after.difficulty : null,
        elapsedDays: after ? after.elapsedDays : null,
        scheduledDays: result ? result.scheduledDays : null,
        ratingBefore,
        ratingAfter,
        reviewedAt: a.at.toISOString(),
      });
      out.set(a.clientAttemptId, {
        clientAttemptId: a.clientAttemptId,
        status: "ok",
        ...(cardOut ? { card: cardOut } : {}),
        ...(ratingOut ? { rating: ratingOut } : {}),
        solveStreak,
        dayStreak: streak.dayStreak,
        ...(themeOut ? { theme: themeOut } : {}),
      });
    }
  });

  // Plan bits of the touched days whose frozen plan is still open: today's earlier attempts and this batch.
  const rowOf = new Map(dayRows.map((r) => [r.day, r]));
  const open = [...days].flatMap(([key, delta]) => {
    const row = rowOf.get(key);
    const plan: DailyPlanV1 | null = row ? parseDailyPlan(row.plan) : null;
    if (!plan || !row) return [];
    const all = (1 << plan.steps.length) - 1;
    return (num(row.planDone) & all) === all ? [] : [{ key, plan, delta }];
  });
  const bits = new Map<string, number>();
  if (open.length) {
    const earlier = await db.$queryRaw<{ day: string; deck: string; theme: string; itemKey: string | null }[]>(
      dayAttemptsSql(
        userId,
        open.map((o) => ({
          day: o.key,
          from: o.delta.window.start,
          to: o.delta.window.end,
        })),
      ),
    );
    for (const o of open) {
      const mine = earlier.filter((e) => e.day === o.key);
      const gradedKeys = new Set([...o.delta.gradedKeys, ...mine.flatMap((e) => (e.itemKey ? [e.itemKey] : []))]);
      const puzzlesByTheme = new Map(o.delta.puzzlesByTheme);
      for (const e of mine) if (e.deck === "PUZZLE") puzzlesByTheme.set(e.theme, (puzzlesByTheme.get(e.theme) ?? 0) + 1);
      bits.set(o.key, planDoneBits(o.plan, { gradedKeys, puzzlesByTheme }));
    }
  }

  // ── The writes: one statement ──
  const touchedThemes = [...themes].filter(([, t]) => t.touched);
  const sessionList = [...sessions.values()].filter((s) => s.total > 0 || s.changed);
  if (rows.length || newPuzzleCards.size) {
    const written = await db.$queryRaw<{ attempts: number }[]>(
      w1WriteSql(userId, {
        cards: [...cards.values()]
          .filter((c) => c.touched)
          .map((c) => ({
            id: String(c.row.cardId),
            repsBefore: c.repsBefore,
            due: c.card.due.toISOString(),
            s: c.card.stability,
            d: c.card.difficulty,
            ed: c.card.elapsedDays,
            sd: c.card.scheduledDays,
            ls: c.card.learningSteps,
            reps: c.card.reps,
            lapses: c.card.lapses,
            state: c.card.state,
            lr: c.card.lastReview ? c.card.lastReview.toISOString() : null,
            m: masteryOf(c.card.state, c.card.stability),
          })),
        newCards: [...newPuzzleCards.values()].map((c) => ({
          key: c.key,
          pid: c.puzzleId,
          fen: c.fen,
          sol: c.solution,
          orient: c.orient,
          pr: Math.round(c.rating),
          theme: c.theme,
          due: c.card.due.toISOString(),
          s: c.card.stability,
          d: c.card.difficulty,
          ed: c.card.elapsedDays,
          sd: c.card.scheduledDays,
          ls: c.card.learningSteps,
          reps: c.card.reps,
          lapses: c.card.lapses,
          state: c.card.state,
          lr: c.card.lastReview ? c.card.lastReview.toISOString() : null,
          m: c.mastery,
        })),
        attempts: rows,
        days: [...days].map(([day, dd]) => {
          // A new row records the zone its day was opened in (an older day than the pinned one: the pinned zone's).
          const zone = anchor && day < anchor.day ? anchor : { timeZone: tz, dayStartHour: dsh };
          return {
            day,
            br: dd.bankReviewed,
            ni: dd.newIntroduced,
            pd: dd.puzzlesDone,
            ms: dd.activeMs,
            bits: bits.get(day) ?? 0,
            tz: zone.timeZone,
            dsh: zone.dayStartHour,
          };
        }),
        themes: touchedThemes.map(([theme, t]) => ({
          theme,
          n: t.attempts,
          ft: t.firstTry,
          e: t.ewma,
          mp: t.milestonePct,
          at: t.lastAttemptAt ? t.lastAttemptAt.toISOString() : null,
        })),
        sessions: sessionList.map((s) => ({
          id: String(s.row.id),
          total: s.total,
          solved: s.solved,
          firstTry: s.firstTry,
          withHint: s.withHint,
          items: s.changed ? { v: 1, items: s.items } : null,
        })),
        profile: rows.length
          ? {
              r: rating.r,
              rd: rating.rd,
              vol: rating.vol,
              n: puzzleAttempts,
              ss: solveStreak,
              ds: streak.dayStreak,
              dsb: streak.dayStreakBest,
              lad: streak.lastActiveDay,
            }
          : null,
      }),
    );
    // Every applied attempt has its row: an attempt another transaction inserted first would have its effects applied
    // twice, so the batch rolls back (the client retries and gets `duplicate`). The lock above makes this unreachable.
    if (num(written[0]?.attempts) !== rows.length)
      throw new Error(`W1: ${rows.length - num(written[0]?.attempts)} attempt(s) already applied by a concurrent batch`);
  }
  let sessionFinished = false;
  for (const s of sessionList) if (s.items.length > 0 && s.items.every((it) => s.graded.has(it.id) || it.skipped)) sessionFinished = true;

  // The response's counters at `now`: the due read sees this batch's writes; today's counters are the read row + deltas.
  const due = await readDueSummary(db, userId, now, clock.nextRelease);
  const todayRow = rowOf.get(clock.today);
  const delta = days.get(clock.today);
  const counters =
    todayRow || delta
      ? {
          bankReviewed: num(todayRow?.bankReviewed) + (delta?.bankReviewed ?? 0),
          newIntroduced: num(todayRow?.newIntroduced) + (delta?.newIntroduced ?? 0),
          puzzlesDone: 0,
          planDone: num(todayRow?.planDone) | (bits.get(clock.today) ?? 0),
        }
      : ZERO_DAY;
  const cap = capOf(due, profile, counters);
  return {
    capRemaining: cap.capRemaining,
    planDone: counters.planDone,
    due: {
      bankDue: cap.dueShown,
      dueRaw: cap.dueRaw,
      total: due.total,
      nextAt: due.nextBatchAt ? due.nextBatchAt.toISOString() : null,
    },
    touchedBank,
    sessionFinished,
    rating: rated
      ? {
          value: rating.r,
          rd: rating.rd,
          vol: rating.vol,
          provisional: isProvisional(puzzleAttempts),
        }
      : null,
  };
}

function dayDelta(days: Map<string, DayDelta>, window: DayWindow): DayDelta {
  let d = days.get(window.key);
  if (!d) {
    d = {
      window,
      bankReviewed: 0,
      newIntroduced: 0,
      puzzlesDone: 0,
      activeMs: 0,
      gradedKeys: new Set(),
      puzzlesByTheme: new Map(),
    };
    days.set(window.key, d);
  }
  return d;
}
