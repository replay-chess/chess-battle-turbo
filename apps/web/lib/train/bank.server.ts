// R2 `GET /api/train/bank` and the BANK due queue shared with R1's plan and W2 (phase-05 plan §7.3 R2, W2 step 3,
// §5.2 S3, §9.1).
//
// A bank of ≤ 300 cards (the common case) is sent whole on the first request (`meta.complete = true`): every row, the
// facets and the labels computed in TS from those rows, so tab, filter and clear run on the client. A larger bank
// pages by 50 with the filters in SQL; the first request adds the facets (one GROUPING SETS statement), and a request
// with a cursor returns rows only (api-perf AP-38: one statement). The next batch and the upcoming rows of both come
// from statement (a)'s arrivals under the daily cap (`batchesOf`). The cursor is `[due, id, filterHash]`; a cursor
// minted for other filters is 400 `cursor_filter_mismatch`.
// No `player_reviews` read per row (no TOAST detoast): the "See It in Your Game" ply is the mistake's `lastPly`.
import { Prisma } from "@repo/db";
import { decodeCursor, encodeCursor } from "@repo/contracts/http/cursor";
import {
  BANK_COMPLETE_MAX_ROWS,
  BANK_PAGE_ROWS,
  type BankNextPage,
  type BankPage,
  type BankQuery,
  type BankRow,
  type Facet,
  type PhaseW,
} from "@repo/contracts/http/train";
import { servedByDay, type ServedDay } from "@repo/chess-training/caps";
import { DEFAULT_DAY_START_HOUR } from "@repo/chess-training/constants";
import { atLabel, releaseLabelOfDay, weekdayLabel } from "@repo/chess-training/labels";
import { focusTheme, type PlanTheme } from "@repo/chess-training/plan";
import type { BankCardIn } from "@repo/chess-training/session";
import { seedOf as filterSeed } from "@repo/chess-training/session";
import { themeLabel, themePluralLabel } from "@repo/chess-training/themes";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { capOf, type DayCounters, type DueSummary } from "./badges.server";
import { loadTrainState, timeZoneOf, type TrainClock } from "./day.server";
import { asDate, at, num, trainDeps, type TrainDeps } from "./db.server";
import { CARD_COLUMNS, MISTAKE_COLUMNS, bankRowOf, cardRowOf, phaseDb, sourceDb, type CardRowDb } from "./dto.server";
import type { TrainingProfile } from "./profile.server";

/** One R2 page as the cache holds it (`lib/api/queries/train.ts BankListPage`). */
export type BankListPage =
  | { data: BankPage; meta: { nextCursor: string | null; complete: boolean } }
  | { data: BankNextPage; meta: { nextCursor: string | null; complete: false } };

export type BankFilterQuery = Pick<BankQuery, "view" | "theme" | "phase" | "source">;

const FROM_BANK = Prisma.sql`FROM training_cards c
  JOIN mistakes m ON m.id = c."mistakeId"
  LEFT JOIN games g ON g.id = m."lastGameId"`;

function filterSql(f: Partial<BankFilterQuery>, now: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.theme) parts.push(Prisma.sql`AND c.theme = ${f.theme}`);
  if (f.phase) parts.push(Prisma.sql`AND c.phase = ${phaseDb(f.phase)}::"GamePhase"`);
  if (f.source) parts.push(Prisma.sql`AND m.source = ${sourceDb(f.source)}::"MistakeSource"`);
  if (f.view === "due") {
    parts.push(Prisma.sql`AND c.due <= ${at(now)} AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${at(now)})`);
  }
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

/** Bank rows in (due, id) order: `limit` rows after the cursor, filtered (the paged path) or not (the complete path). */
export function bankRowsSql(
  userId: bigint,
  o: { now: Date; filter?: Partial<BankFilterQuery>; after?: { due: Date; id: bigint }; limit: number; dayStart?: boolean },
): Prisma.Sql {
  const after = o.after ? Prisma.sql`AND (c.due, c.id) > (${at(o.after.due)}, ${o.after.id})` : Prisma.empty;
  // A cursor page has no train state: the member's day start rides along as a PK scalar (still one statement).
  const dayStart = o.dayStart ? Prisma.sql`, (SELECT tp."dayStartHour" FROM training_profiles tp WHERE tp."userId" = ${userId}) AS "dayStartHour"` : Prisma.empty;
  return Prisma.sql`SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS} ${dayStart} ${FROM_BANK}
    WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL ${filterSql(o.filter ?? {}, o.now)} ${after}
    ORDER BY c.due, c.id LIMIT ${o.limit}`;
}

/** The facets of a large bank (one statement, GROUPING SETS over the user's range). */
export function bankFacetsSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT c.theme, c.phase::text AS phase, m.source::text AS source, GROUPING(c.theme) AS gt,
      GROUPING(c.phase) AS gp, count(*)::int AS n
    FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
    WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND m."hiddenAt" IS NULL
    GROUP BY GROUPING SETS ((c.theme), (c.phase), (m.source))`;
}

/** The ≤ 50 due BANK cards (W2's BANK query; R1's plan reads the same), oldest due first. */
export function dueCardsSql(userId: bigint, now: Date, f: Partial<BankFilterQuery> = {}): Prisma.Sql {
  return Prisma.sql`SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS}, m."lastGameId" ${FROM_BANK}
    WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND c.due <= ${at(now)}
      AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${at(now)}) AND m."hiddenAt" IS NULL
      ${filterSql({ theme: f.theme, phase: f.phase, source: f.source }, now)}
    ORDER BY c.due, c.id LIMIT 50`;
}

export type DueCardRow = CardRowDb & { lastGameId: bigint | null };

/** A due card as the session composer reads it. */
export function bankCardIn(r: CardRowDb): BankCardIn {
  return {
    key: r.itemKey,
    kind: r.kind === "REVIEW_POSITION" ? "REVIEW_POSITION" : "MISTAKE",
    card: cardRowOf(r),
    lastPlayedAt: asDate(r.lastPlayedAt) ?? new Date(0),
  };
}

/** theme_mastery rows (< 60 per member, PK prefix). */
export function themeMasterySql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT theme, attempts, "firstTry", ewma, "bankCount", "milestonePct", "lastAttemptAt"
    FROM theme_mastery WHERE "userId" = ${userId} ORDER BY theme`;
}

export type ThemeMasteryRow = {
  theme: string;
  attempts: number;
  firstTry: number;
  ewma: number;
  bankCount: number;
  milestonePct: number;
  lastAttemptAt: Date | null;
};

export function planThemesOf(rows: readonly ThemeMasteryRow[]): PlanTheme[] {
  return rows.map((t) => ({ key: t.theme, attempts: num(t.attempts), ewma: num(t.ewma), bankCount: num(t.bankCount) }));
}

/** The newest analysed game (the empty bank's "Review your last game"). */
export function lastGameSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT g."referenceId" AS ref, gp."opponentName" AS opponent, gp."momentsCount" AS moments,
      (pr."completedAt" IS NOT NULL) AS reviewed
    FROM game_players gp JOIN games g ON g.id = gp."gameId"
    LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
    WHERE gp."userId" = ${userId} AND gp."endedAt" IS NOT NULL AND g."analysisStatus" = 'DONE'
    ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 1`;
}

export type LastGameRow = { ref: string; opponent: string; moments: number; reviewed: boolean };

// ── Labels from rows ────────────────────────────────────────────────────────────────────────────────────────────
const PHASE_LABEL: Record<PhaseW, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
const SOURCE_LABEL = { own: "My blunders", missed: "Missed punishments" } as const;

/** Facets from the rows: themes by count (then key), phases and sources in their fixed order, non-zero only. */
export function facetsOfRows(rows: readonly BankRow[]): BankPage["facets"] {
  const themes = new Map<string, number>();
  const phases = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const r of rows) {
    themes.set(r.theme.key, (themes.get(r.theme.key) ?? 0) + 1);
    phases.set(r.phase, (phases.get(r.phase) ?? 0) + 1);
    sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
  }
  return facetsOf(themes, phases, sources);
}

function facetsOf(themes: Map<string, number>, phases: Map<string, number>, sources: Map<string, number>): BankPage["facets"] {
  const theme: Facet[] = [...themes]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([key, n]) => ({ key, label: themeLabel(key), n }));
  const phase: Facet[] = (["opening", "middlegame", "endgame"] as const)
    .filter((k) => (phases.get(k) ?? 0) > 0)
    .map((key) => ({ key, label: PHASE_LABEL[key], n: phases.get(key)! }));
  const source: Facet[] = (["own", "missed"] as const)
    .filter((k) => (sources.get(k) ?? 0) > 0)
    .map((key) => ({ key, label: SOURCE_LABEL[key], n: sources.get(key)! }));
  return { theme, phase, source };
}

type FacetRow = { theme: string | null; phase: string | null; source: string | null; gt: number; gp: number; n: number };

export function facetsOfSql(rows: readonly FacetRow[]): BankPage["facets"] {
  const themes = new Map<string, number>();
  const phases = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const r of rows) {
    if (num(r.gt) === 0 && r.theme) themes.set(r.theme, num(r.n));
    else if (num(r.gp) === 0 && r.phase) {
      const k = r.phase === "OPENING" ? "opening" : r.phase === "ENDGAME" ? "endgame" : "middlegame";
      phases.set(k, (phases.get(k) ?? 0) + num(r.n));
    } else if (r.source) sources.set(r.source === "MISSED_PUNISH" ? "missed" : "own", num(r.n));
  }
  return facetsOf(themes, phases, sources);
}

/**
 * The reviews each coming training day serves under the member's cap (`servedByDay`, §8.5): the one source of every
 * "next batch" count (bank, hub, Home) and of the bank's "Coming up" rows, so none promises more than the cap.
 */
export function batchesOf(
  due: Pick<DueSummary, "dueReview" | "dueNew" | "arrivals">,
  profile: Pick<TrainingProfile, "bankDailyCap" | "newPerDay">,
  day: DayCounters,
  clock: Pick<TrainClock, "now" | "timeZone" | "dayStartHour" | "today" | "dayEndUtc">,
): ServedDay[] {
  return servedByDay({
    cap: profile.bankDailyCap,
    newPerDay: profile.newPerDay,
    bankReviewed: day.bankReviewed,
    newIntroduced: day.newIntroduced,
    dueReview: due.dueReview,
    dueNew: due.dueNew,
    arrivals: due.arrivals,
    now: clock.now,
    timeZone: clock.timeZone,
    dayStartHour: clock.dayStartHour,
    today: clock.today,
    todayEnd: clock.dayEndUtc,
  });
}

/**
 * "Tomorrow 6 · Saturday 3 · Sunday 5 · Next week 9": the reviews served per training day (`batchesOf`) for the next 6
 * days (non-zero only), then the days 7–13 as "Next week", at most 4 rows.
 */
export function upcomingOf(days: readonly ServedDay[]): BankPage["upcoming"] {
  let nextWeek = 0;
  const out: BankPage["upcoming"] = [];
  for (const d of days) {
    if (d.offset >= 1 && d.offset <= 6) out.push({ label: upcomingDayLabel(d.key, d.offset), n: d.n });
    else if (d.offset >= 7 && d.offset <= 13) nextWeek += d.n;
  }
  if (nextWeek > 0) out.push({ label: "Next week", n: nextWeek });
  return out.slice(0, 4);
}

/** "Tomorrow", then the weekday, for the upcoming histogram's day `d` (1–6) ahead of today's training day. */
function upcomingDayLabel(key: string, d: number): string {
  return d === 1 ? "Tomorrow" : weekdayLabel(key);
}

/**
 * The next batch (`NextBatch`): the first coming day's reviews under the cap (`batchesOf`), labelled on the member's
 * training days (P5-FZ-4: at 01:00 a 08:00 release is "tomorrow" when the day starts at 04:00, as the hub's header
 * says). FIX-4 (D-P6-FIX4-2): the word counts from the clock's day (`today`, which a zone change can pin past the
 * zone's rollover) to the day the batch is served on, and the payload carries both days and today's end, so the
 * browser's word follows the same days.
 */
export function nextBatchOf(days: readonly ServedDay[], clock: Pick<TrainClock, "now" | "timeZone" | "dayStartHour" | "today" | "dayEndUtc">): BankPage["nextBatch"] {
  const next = days[0];
  if (!next) return null;
  return {
    at: next.at.toISOString(),
    atLabel: atLabel(next.at, clock.timeZone),
    count: next.n,
    whenLabel: releaseLabelOfDay(next.at, clock.timeZone, next.key, clock.today),
    dayStartHour: clock.dayStartHour,
    dayKey: next.key,
    todayKey: clock.today,
    todayEndsAt: clock.dayEndUtc.toISOString(),
  };
}

// ── Cursor ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** A short hash of the normalised filter; a cursor carries it so a filter change cannot reuse it. */
export function filterHash(f: Partial<BankFilterQuery>): string {
  return filterSeed(`${f.view ?? "all"}|${f.theme ?? ""}|${f.phase ?? ""}|${f.source ?? ""}`).toString(36);
}

export function bankCursor(row: { due: Date; cardId: bigint }, f: Partial<BankFilterQuery>): string {
  return encodeCursor([row.due.toISOString(), row.cardId.toString(), filterHash(f)]);
}

/** The cursor's position; 400 for a malformed cursor or one minted for other filters. */
export function readBankCursor(cursor: string, f: Partial<BankFilterQuery>): { due: Date; id: bigint } {
  const parts = decodeCursor<[string, string, string]>(cursor, 3);
  const due = parts && typeof parts[0] === "string" ? new Date(parts[0]) : null;
  if (!parts || !due || Number.isNaN(due.getTime()) || typeof parts[1] !== "string" || !/^\d{1,19}$/.test(parts[1])) {
    throw new DataError("validation_failed", { fields: { cursor: "Invalid cursor" } });
  }
  if (parts[2] !== filterHash(f)) {
    throw new DataError("validation_failed", { fields: { cursor: "The cursor belongs to other filters" }, details: { reason: "cursor_filter_mismatch" } });
  }
  return { due, id: BigInt(parts[1]) };
}

// ── listBank ────────────────────────────────────────────────────────────────────────────────────────────────────
function rowsOf(rows: readonly CardRowDb[], now: Date, tz: string, dayStartHour: number): BankRow[] {
  return rows.flatMap((r) => {
    const row = bankRowOf(r, now, tz, dayStartHour);
    return row ? [row] : [];
  });
}

function pageHead(
  due: DueSummary,
  profile: TrainingProfile,
  day: DayCounters,
  themes: readonly ThemeMasteryRow[],
  clock: TrainClock,
): Pick<BankPage, "state" | "counts" | "nextBatch" | "upcoming" | "focusTheme" | "lesson"> {
  const cap = capOf(due, profile, day);
  const focus = focusTheme(planThemesOf(themes)).key;
  const batches = batchesOf(due, profile, day, clock);
  return {
    state: due.total === 0 ? "empty" : cap.dueShown === 0 ? "caughtup" : "default",
    counts: { due: cap.dueShown, dueRaw: cap.dueRaw, all: due.total, capRemaining: cap.capRemaining, cap: profile.bankDailyCap },
    nextBatch: nextBatchOf(batches, clock),
    upcoming: upcomingOf(batches),
    focusTheme: { key: focus, label: themePluralLabel(focus) },
    lesson: null,
  };
}

/**
 * R2 and the `/train/bank` RSC seed. `cursor` null = the first request (the full page head); otherwise rows only.
 * Reads only (no GET side effect).
 */
export async function listBank(
  viewer: Viewer,
  filter: BankFilterQuery,
  cursor: string | null,
  now: Date,
  deps: TrainDeps = trainDeps(),
): Promise<BankListPage> {
  const { db } = deps;
  const tz = timeZoneOf(viewer);
  if (cursor) {
    const after = readBankCursor(cursor, filter);
    const rows = await db.$queryRaw<(CardRowDb & { dayStartHour?: number | null })[]>(
      bankRowsSql(viewer.id, { now, filter, after, limit: BANK_PAGE_ROWS + 1, dayStart: true }),
    );
    const page = rows.slice(0, BANK_PAGE_ROWS);
    const last = page[page.length - 1];
    const dayStartHour = rows[0]?.dayStartHour ?? null;
    return {
      data: { rows: rowsOf(page, now, tz, dayStartHour === null ? DEFAULT_DAY_START_HOUR : num(dayStartHour)) },
      meta: { nextCursor: rows.length > BANK_PAGE_ROWS && last ? bankCursor({ due: asDate(last.due)!, cardId: last.cardId }, filter) : null, complete: false },
    };
  }

  const [state, themes, all] = await Promise.all([
    loadTrainState(db, viewer, now),
    db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)),
    db.$queryRaw<CardRowDb[]>(bankRowsSql(viewer.id, { now, limit: BANK_COMPLETE_MAX_ROWS + 1 })),
  ]);
  const { due, profile, clock, counters: day } = state;
  const head = pageHead(due, profile, day, themes, clock);
  // An empty bank, or one Remove From Bank can empty on the page: the client shows the empty state as soon as the last
  // row goes (model.pageAfterRemovals, D6), before the DELETE commits after the Undo window and the bank refetches, so
  // it needs the same links the server's empty bank shows (regression: bank-empty-ctas, only "Play a Game" until a
  // reload). A larger bank never reaches empty in one page without a refetch in between, so it skips the read.
  const emptyCtas = head.state === "empty" || head.counts.all <= BANK_EMPTY_CTAS_ROWS ? await emptyCtasOf(deps, viewer) : null;

  if (all.length <= BANK_COMPLETE_MAX_ROWS) {
    const rows = rowsOf(all, now, tz, clock.dayStartHour);
    return {
      data: { ...head, rows, facets: facetsOfRows(rows), emptyCtas },
      meta: { nextCursor: null, complete: true },
    };
  }

  // A large bank: page 1 of the filtered list and the facets (one more parallel round trip).
  const [rows, facets] = await Promise.all([
    db.$queryRaw<CardRowDb[]>(bankRowsSql(viewer.id, { now, filter, limit: BANK_PAGE_ROWS + 1 })),
    db.$queryRaw<FacetRow[]>(bankFacetsSql(viewer.id)),
  ]);
  const page = rows.slice(0, BANK_PAGE_ROWS);
  const last = page[page.length - 1];
  return {
    data: {
      ...head,
      rows: rowsOf(page, now, tz, clock.dayStartHour),
      facets: facetsOfSql(facets),
      emptyCtas,
    },
    meta: { nextCursor: rows.length > BANK_PAGE_ROWS && last ? bankCursor({ due: asDate(last.due)!, cardId: last.cardId }, filter) : null, complete: false },
  };
}

/** A bank of at most this many cards carries `emptyCtas` (see listBank). */
export const BANK_EMPTY_CTAS_ROWS = 3;

async function emptyCtasOf(deps: TrainDeps, viewer: Viewer): Promise<BankPage["emptyCtas"]> {
  const rows = await deps.db.$queryRaw<LastGameRow[]>(lastGameSql(viewer.id));
  const g = rows[0];
  return {
    lastGame: g ? { gameRef: g.ref, opponent: (g.opponent ?? "").slice(0, 40), reviewed: Boolean(g.reviewed) } : null,
    hasLinkedAccount: (viewer.accounts?.length ?? 0) > 0,
  };
}
