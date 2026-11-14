// R2 `GET /api/train/bank` and the BANK due queue shared with R1's plan and W2 (phase-05 plan §7.3 R2, W2 step 3,
// §5.2 S3, §9.1).
//
// A bank of ≤ 300 cards (the common case) is sent whole on the first request (`meta.complete = true`): every row, the
// facets, the upcoming histogram and the labels computed in TS from those rows, so tab, filter and clear run on the
// client. A larger bank pages by 50 with the filters in SQL; the first request adds the facets (one GROUPING SETS
// statement) and the upcoming histogram, and a request with a cursor returns rows only (api-perf AP-38: one
// statement). The cursor is `[due, id, filterHash]`; a cursor minted for other filters is 400 `cursor_filter_mismatch`.
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
import { calendarDaysBetween, localDate } from "@repo/chess-training/tz";
import { atLabel, dayLabel, releaseLabel } from "@repo/chess-training/labels";
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
export function bankRowsSql(userId: bigint, o: { now: Date; filter?: Partial<BankFilterQuery>; after?: { due: Date; id: bigint }; limit: number }): Prisma.Sql {
  const after = o.after ? Prisma.sql`AND (c.due, c.id) > (${at(o.after.due)}, ${o.after.id})` : Prisma.empty;
  return Prisma.sql`SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS} ${FROM_BANK}
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

/** Future dues of the next 14 days (the upcoming histogram of a large bank). */
export function upcomingDuesSql(userId: bigint, now: Date): Prisma.Sql {
  return Prisma.sql`SELECT GREATEST(due, COALESCE("suspendedUntil", due)) AS due FROM training_cards
    WHERE "userId" = ${userId} AND deck = 'BANK' AND due > ${at(now)} - interval '1 day'
      AND due <= ${at(now)} + interval '14 days'`;
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
 * "Tomorrow 6 · Saturday 3 · Sunday 5 · Next week 9": per local day for the next 6 days (non-zero only), then the
 * days 7–13 as "Next week", at most 4 rows.
 */
export function upcomingOf(dues: readonly Date[], now: Date, timeZone: string): BankPage["upcoming"] {
  const today = localDate(now, timeZone);
  const perDay = new Map<number, number>();
  let nextWeek = 0;
  for (const due of dues) {
    if (due.getTime() <= now.getTime()) continue;
    const d = calendarDaysBetween(today, localDate(due, timeZone));
    if (d >= 1 && d <= 6) perDay.set(d, (perDay.get(d) ?? 0) + 1);
    else if (d >= 7 && d <= 13) nextWeek += 1;
  }
  const out: BankPage["upcoming"] = [...perDay]
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => ({ label: dayLabel(new Date(now.getTime() + d * 86_400_000), now, timeZone, { long: true }), n }));
  if (nextWeek > 0) out.push({ label: "Next week", n: nextWeek });
  return out.slice(0, 4);
}

/** The next batch (`NextBatch`) from the due summary, labelled in the zone at `now`. */
export function nextBatchOf(due: DueSummary, timeZone: string, now: Date): BankPage["nextBatch"] {
  if (!due.nextBatchAt || due.nextBatch <= 0) return null;
  return {
    at: due.nextBatchAt.toISOString(),
    atLabel: atLabel(due.nextBatchAt, timeZone),
    count: due.nextBatch,
    whenLabel: releaseLabel(due.nextBatchAt, now, timeZone),
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
function rowsOf(rows: readonly CardRowDb[], now: Date, tz: string): BankRow[] {
  return rows.flatMap((r) => {
    const row = bankRowOf(r, now, tz);
    return row ? [row] : [];
  });
}

function pageHead(
  due: DueSummary,
  profile: TrainingProfile,
  day: DayCounters,
  themes: readonly ThemeMasteryRow[],
  clock: TrainClock,
): Pick<BankPage, "state" | "counts" | "nextBatch" | "focusTheme" | "lesson"> {
  const cap = capOf(due, profile, day);
  const focus = focusTheme(planThemesOf(themes)).key;
  return {
    state: due.total === 0 ? "empty" : cap.dueShown === 0 ? "caughtup" : "default",
    counts: { due: cap.dueShown, dueRaw: cap.dueRaw, all: due.total, capRemaining: cap.capRemaining, cap: profile.bankDailyCap },
    nextBatch: nextBatchOf(due, clock.timeZone, clock.now),
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
    const rows = await db.$queryRaw<CardRowDb[]>(bankRowsSql(viewer.id, { now, filter, after, limit: BANK_PAGE_ROWS + 1 }));
    const page = rows.slice(0, BANK_PAGE_ROWS);
    const last = page[page.length - 1];
    return {
      data: { rows: rowsOf(page, now, tz) },
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
  const emptyCtas = head.state === "empty" ? await emptyCtasOf(deps, viewer) : null;

  if (all.length <= BANK_COMPLETE_MAX_ROWS) {
    const rows = rowsOf(all, now, tz);
    const dues = all.map((r) => {
      const d = asDate(r.due)!;
      const s = asDate(r.suspendedUntil);
      return s && s.getTime() > d.getTime() ? s : d;
    });
    return {
      data: { ...head, rows, facets: facetsOfRows(rows), upcoming: upcomingOf(dues, now, tz), emptyCtas },
      meta: { nextCursor: null, complete: true },
    };
  }

  // A large bank: page 1 of the filtered list, the facets and the upcoming histogram (one more parallel round trip).
  const [rows, facets, upcoming] = await Promise.all([
    db.$queryRaw<CardRowDb[]>(bankRowsSql(viewer.id, { now, filter, limit: BANK_PAGE_ROWS + 1 })),
    db.$queryRaw<FacetRow[]>(bankFacetsSql(viewer.id)),
    db.$queryRaw<{ due: Date }[]>(upcomingDuesSql(viewer.id, now)),
  ]);
  const page = rows.slice(0, BANK_PAGE_ROWS);
  const last = page[page.length - 1];
  return {
    data: {
      ...head,
      rows: rowsOf(page, now, tz),
      facets: facetsOfSql(facets),
      upcoming: upcomingOf(upcoming.map((u) => asDate(u.due)!), now, tz),
      emptyCtas,
    },
    meta: { nextCursor: rows.length > BANK_PAGE_ROWS && last ? bankCursor({ due: asDate(last.due)!, cardId: last.cardId }, filter) : null, complete: false },
  };
}

async function emptyCtasOf(deps: TrainDeps, viewer: Viewer): Promise<BankPage["emptyCtas"]> {
  const rows = await deps.db.$queryRaw<LastGameRow[]>(lastGameSql(viewer.id));
  const g = rows[0];
  return {
    lastGame: g ? { gameRef: g.ref, opponent: (g.opponent ?? "").slice(0, 40), reviewed: Boolean(g.reviewed) } : null,
    hasLinkedAccount: (viewer.accounts?.length ?? 0) > 0,
  };
}
