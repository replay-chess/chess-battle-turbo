// Training sessions (phase-05 plan §7.3 W2, W3, W4, R3; §8.6; §5.2 S4/S5/S7): create or resume, read, extend, end
// and summarise. Every function takes the request clock `now`; the RSC pages pass `requestNow()`.
//
// W2 `openSession`: one parallel batch (the training state of day.server.ts and the reuse/limit statement of §6.5:
// the member's sessions of the last 2 h, `training_sessions_userId_startedAt_idx`). An ACTIVE session of the same kind
// and filter key (< 2 h, not fully graded) is returned as is (200, not counted). Otherwise the 31st new session in an
// hour answers 429 `rate_limited {reason: "session_limit"}` with `Retry-After` (durable: counted from the rows, a
// Neon suspend cannot reset it). The items come from `@repo/chess-training/session` buildSession (WP-B), puzzles from
// the shard loader's selectPuzzleBatch (WP-D) with the 90-day exclusion query; one write transaction inserts the
// session (and abandons the member's other ACTIVE puzzle session: a theme switch replaces it).
//
// `size` stores the planned size: the item count for bank, daily and practice sessions; for a PUZZLES session the
// fixed `count`, or 0 for a streaming session (extends by 10 while 2 remain).
import { createHash } from "node:crypto";
import { Prisma } from "@repo/db";
import { newGameRef } from "@repo/db/games";
import { buildSessionItems, parseDailyPlan, parseSessionItems, type PuzzleSnapshotV1, type SessionItemsV1 } from "@repo/db/json";
import { canonicalJson } from "@/lib/api/idempotency";
import {
  EXTEND_ITEMS,
  TRAIN_PUZZLES_DAILY_LIMIT_DEFAULT,
  TRAIN_SESSION_HOURLY,
  type ExtendResult,
  type SessionCreate,
  type SessionPayload,
  type SessionSummary,
  type ThemeOption,
} from "@repo/contracts/http/train";
import { exceedsPuzzleLimit, isScheduled } from "@repo/chess-training/caps";
import { PLAN_PUZZLE_COUNT, PUZZLE_EXCLUDE_DAYS, SESSION_ITEMS_MAX } from "@repo/chess-training/constants";
import { dayStart, addDaysToKey } from "@repo/chess-training/day";
import { newCardRow, previewAll } from "@repo/chess-training/fsrs";
import { intervalLabel } from "@repo/chess-training/labels";
import { isPerfectSession } from "@repo/chess-training/mastery";
import { focusTheme, isStepDone, puzzlesHref } from "@repo/chess-training/plan";
import { isProvisional } from "@repo/chess-training/rating";
import {
  buildSession,
  extendItems,
  itemsAfter,
  queueLabel,
  seedOf,
  type PlannedItem,
  type PuzzleCardIn,
  type PuzzlePick,
  type SessionPlan,
} from "@repo/chess-training/session";
import { themeLabel, themeNoun, themePluralLabel } from "@repo/chess-training/themes";
import { ApiError } from "@/lib/api/api-error";
import { requestNow } from "@/lib/api/now";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { capOf } from "./badges.server";
import { bankCardIn, bankRowsSql, dueCardsSql, planThemesOf, themeMasterySql, type DueCardRow, type ThemeMasteryRow } from "./bank.server";
import { loadTrainState, type TrainState } from "./day.server";
import { asDate, at, dayParam, LOCK_TRAIN_SESSION, memberLockSql, num, trainDeps, type TrainDb, type TrainDeps } from "./db.server";
import { CARD_COLUMNS, MISTAKE_COLUMNS, cardRowOf, gradeWire, snapshotOfCard, trainItemOf, type CardRowDb, type ItemBuild } from "./dto.server";
import {
  primaryThemeOf,
  puzzlesEnabled,
  selectPuzzleBatch,
  toPuzzleSnapshot,
  toShardPuzzle,
  type ShardDeps,
} from "./puzzles.server";
import { insertProfileSql } from "./profile.server";
import { themeOptionsOf } from "./themes.server";

type SessionKindDb = "DAILY" | "BANK" | "PUZZLES" | "WEAKNESS" | "PRACTICE";
type SessionStatusDb = "ACTIVE" | "COMPLETED" | "ABANDONED";
type StoredItem = SessionItemsV1["items"][number];

export type SessionRow = {
  id: bigint;
  referenceId: string;
  kind: SessionKindDb;
  status: SessionStatusDb;
  source: string;
  filterKey: string;
  theme: string | null;
  size: number;
  mix: boolean;
  countsTowardCap: boolean;
  items: unknown;
  day: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type AttemptRow = {
  id?: bigint;
  reviewedAt?: Date;
  itemId: string | null;
  grade: string | null;
  solved: boolean;
  firstTry: boolean;
  hintsUsed: number;
  wrongTries: number;
  solutionShown: boolean;
  theme: string;
  deck: string;
  scheduledDays: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
};

const KIND_WIRE: Record<SessionKindDb, SessionPayload["kind"]> = {
  DAILY: "daily",
  BANK: "bank",
  PUZZLES: "puzzles",
  WEAKNESS: "weakness",
  PRACTICE: "practice",
};
const STATUS_WIRE: Record<SessionStatusDb, SessionPayload["status"]> = { ACTIVE: "active", COMPLETED: "completed", ABANDONED: "abandoned" };
const TITLE: Record<SessionKindDb, SessionPayload["header"]["title"]> = {
  DAILY: "Mistake Bank",
  BANK: "Mistake Bank",
  PUZZLES: "Puzzles",
  WEAKNESS: "Weakness drill",
  PRACTICE: "Practice",
};

// ── Statements ──────────────────────────────────────────────────────────────────────────────────────────────────
export function sessionSql(userId: bigint, ref: string, lock = false): Prisma.Sql {
  return Prisma.sql`SELECT id, "referenceId", kind::text AS kind, status::text AS status, source, "filterKey", theme, size, mix,
      "countsTowardCap", items, to_char(day, 'YYYY-MM-DD') AS day, "startedAt", "endedAt"
    FROM training_sessions WHERE "referenceId" = ${ref} AND "userId" = ${userId} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
}

/** In grading order (reviewedAt, then id): done here, so the read stays an index range with no Sort node. */
export function byReviewedAt<T extends Pick<AttemptRow, "id" | "reviewedAt">>(rows: readonly T[]): T[] {
  const t = (r: T) => (r.reviewedAt ? asDate(r.reviewedAt)!.getTime() : 0);
  return [...rows].sort((a, b) => t(a) - t(b) || (a.id !== undefined && b.id !== undefined ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : 0));
}

/** A session's attempts (training_attempts_userId_reviewedAt_idx, bounded below by the session start). */
export function sessionAttemptsSql(userId: bigint, sessionId: bigint, startedAt: Date): Prisma.Sql {
  return Prisma.sql`SELECT id, "reviewedAt", "itemId", grade::text AS grade, solved, "firstTry", "hintsUsed", "wrongTries",
      "solutionShown", theme, deck::text AS deck, "scheduledDays", "ratingBefore", "ratingAfter"
    FROM training_attempts
    WHERE "userId" = ${userId} AND "reviewedAt" >= ${at(startedAt)} - interval '7 days' AND "sessionId" = ${sessionId}`;
}

/**
 * A session's attempts by the session's ref, in the same round trip as the session row (the summary: §9.1 "R3 / W4
 * summary 1 RT"; FIX-1): the session by its key, then the attempts' (userId, reviewedAt) range from its start.
 */
export function sessionAttemptsByRefSql(userId: bigint, ref: string): Prisma.Sql {
  return Prisma.sql`SELECT a.id, a."reviewedAt", a."itemId", a.grade::text AS grade, a.solved, a."firstTry", a."hintsUsed", a."wrongTries",
      a."solutionShown", a.theme, a.deck::text AS deck, a."scheduledDays", a."ratingBefore", a."ratingAfter"
    FROM training_sessions s
    JOIN training_attempts a ON a."userId" = ${userId} AND a."reviewedAt" >= s."startedAt" - interval '7 days' AND a."sessionId" = s.id
    WHERE s."referenceId" = ${ref} AND s."userId" = ${userId}`;
}

/** Cards by API ref with their mistakes (training_cards_userId_itemKey_key). */
export function cardsByKeySql(userId: bigint, keys: readonly string[]): Prisma.Sql {
  return Prisma.sql`SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS} FROM training_cards c
    LEFT JOIN mistakes m ON m.id = c."mistakeId" LEFT JOIN games g ON g.id = m."lastGameId"
    WHERE c."userId" = ${userId} AND c."itemKey" = ANY(${keys as string[]}::text[])`;
}

/**
 * The game's in-bank cards (explicit `gameRef` pick; PK / unique lookups only), one row per occurrence (no rows when
 * it is not the viewer's game). The caller orders them by ply (no Sort node in the plan).
 */
export function gameCardsSql(userId: bigint, gameRef: string): Prisma.Sql {
  return Prisma.sql`SELECT g0.id AS "gameId", mo.ply AS "momentPly", ${CARD_COLUMNS}, ${MISTAKE_COLUMNS}
    FROM games g0 JOIN game_players gp ON gp."gameId" = g0.id AND gp."userId" = ${userId}
    LEFT JOIN mistake_occurrences mo ON mo."gameId" = g0.id
    LEFT JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = ${userId} AND m."hiddenAt" IS NULL
    LEFT JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
    LEFT JOIN games g ON g.id = m."lastGameId"
    WHERE g0."referenceId" = ${gameRef}`;
}

/** Due PUZZLE-deck cards of a theme (≤ 30 % of a batch; training_cards_userId_deck_due_idx). */
export function duePuzzleCardsSql(userId: bigint, now: Date, theme: string): Prisma.Sql {
  return Prisma.sql`SELECT ${CARD_COLUMNS}, ${MISTAKE_COLUMNS} FROM training_cards c
    LEFT JOIN mistakes m ON m.id = c."mistakeId" LEFT JOIN games g ON g.id = m."lastGameId"
    WHERE c."userId" = ${userId} AND c.deck = 'PUZZLE' AND c.due <= ${at(now)}
      AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${at(now)}) AND c.theme = ${theme}
    ORDER BY c.due, c.id LIMIT 30`;
}

/**
 * Puzzle ids among `ids` that are not new to the member: attempted in the last 90 days (training_attempts_puzzle_idx),
 * or holding a PUZZLE card (training_cards_userId_itemKey_key, `p_<id>`; FIX-2): a carded puzzle comes back through
 * its card's schedule (as a due card of its theme), never again as a new puzzle whose grade W1 would refuse. ≤ 500 ids.
 */
export function recentPuzzlesSql(userId: bigint, ids: readonly string[], now: Date): Prisma.Sql {
  return Prisma.sql`SELECT DISTINCT "puzzleId" FROM training_attempts
    WHERE "userId" = ${userId} AND "puzzleId" = ANY(${ids as string[]}::text[])
      AND "reviewedAt" > ${at(now)} - make_interval(days => ${PUZZLE_EXCLUDE_DAYS}::int)
    UNION
    SELECT substr("itemKey", 3) AS "puzzleId" FROM training_cards
    WHERE "userId" = ${userId} AND "itemKey" = ANY(${ids.map((id) => `p_${id}`)}::text[])`;
}

/**
 * ACTIVE reuse and the durable `train-session` limit in one statement (§6.5): sessions created in the last hour, the
 * oldest of them, and the newest ACTIVE session of this kind and filter key younger than 2 h.
 */
export function reuseSql(userId: bigint, now: Date, kind: SessionKindDb, filterKey: string): Prisma.Sql {
  const NOW = at(now);
  return Prisma.sql`SELECT count(*) FILTER (WHERE "startedAt" > ${NOW} - interval '1 hour')::int AS n1h,
      min("startedAt") FILTER (WHERE "startedAt" > ${NOW} - interval '1 hour') AS oldest,
      (array_agg("referenceId" ORDER BY "startedAt" DESC)
        FILTER (WHERE status = 'ACTIVE' AND kind = ${kind}::"SessionKind" AND "filterKey" = ${filterKey}))[1] AS reuse
    FROM training_sessions WHERE "userId" = ${userId} AND "startedAt" > ${NOW} - interval '2 hours'`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const kindDbOf = (spec: SessionCreate): SessionKindDb =>
  spec.kind === "daily" ? "DAILY" : spec.kind === "puzzles" ? "PUZZLES" : spec.kind === "practice" ? "PRACTICE" : "BANK";

/** The ACTIVE-reuse key (§6.4): sha256 of the normalised spec and the training day, 32 hex characters. */
export function filterKeyOf(spec: SessionCreate, day: string): string {
  const norm: Record<string, unknown> = { ...spec, day };
  delete norm.source;
  if (spec.kind === "bank" && spec.cardRefs) norm.cardRefs = [...new Set(spec.cardRefs)].sort();
  return createHash("sha256").update(canonicalJson(norm)).digest("hex").slice(0, 32);
}

/** The daily fair-use cap (`TRAIN_PUZZLES_DAILY_LIMIT`, default 400). */
export function puzzleDailyLimit(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.TRAIN_PUZZLES_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : TRAIN_PUZZLES_DAILY_LIMIT_DEFAULT;
}

/** 429 `session_limit`, retrying when the oldest session of the hour is an hour old. */
function sessionLimitError(oldestValue: unknown, now: Date): ApiError {
  const oldest = asDate(oldestValue) ?? now;
  const retryAfterSec = Math.max(1, Math.ceil((oldest.getTime() + TRAIN_SESSION_HOURLY.windowSec * 1000 - now.getTime()) / 1000));
  return new ApiError("rate_limited", { retryAfterSec, details: { reason: "session_limit" } });
}

/** 429 for the daily puzzle limit, retrying when the next local training day starts. */
function puzzleLimitError(state: TrainState): ApiError {
  const next = dayStart(addDaysToKey(state.clock.today, 1), state.clock.timeZone, state.clock.dayStartHour);
  const retryAfterSec = Math.max(1, Math.ceil((next.getTime() - state.clock.now.getTime()) / 1000));
  return new ApiError("rate_limited", { retryAfterSec, details: { reason: "daily_puzzle_limit" } });
}

function storedItemsOf(row: Pick<SessionRow, "items">): StoredItem[] {
  return parseSessionItems(row.items)?.items ?? [];
}

/** Items graded (or skipped) so far: the first item that is neither is where the runner resumes. */
export function resumeIndexOf(items: readonly { itemId: string; skipped?: boolean }[], graded: ReadonlySet<string>): number {
  const i = items.findIndex((it) => !graded.has(it.itemId) && !it.skipped);
  return i < 0 ? items.length : i;
}

function plannedToStored(p: PlannedItem, snapshot: PuzzleSnapshotV1 | undefined): StoredItem {
  return { id: p.itemId, key: p.key, kind: p.kind, pass: p.pass, ...(snapshot ? { p: snapshot } : {}) };
}

type BuildContext = {
  viewer: Pick<Viewer, "id" | "ref">;
  state: TrainState;
  cards: ReadonlyMap<string, CardRowDb>;
  themes: readonly ThemeMasteryRow[] | null;
};

/**
 * The runner items of stored session items (an item whose card is gone or whose row is corrupt is left out). An item
 * carries grade previews only when W1 would reschedule its card now (§8.5 the once-a-day rule, FIX-2): "Solve this
 * one" on a card already reviewed today and not due is practice, so its buttons show no interval and Again queues no
 * copy, on the client and on the server alike.
 */
function itemsOf(
  stored: readonly StoredItem[],
  row: Pick<SessionRow, "kind" | "countsTowardCap">,
  ctx: BuildContext,
): { payload: SessionPayload["items"]; labels: SessionPayload["queueLabels"] } {
  const { clock } = ctx.state;
  const prefs = { timeZone: clock.timeZone, releaseHour: ctx.state.profile.releaseHour, dayStartHour: clock.dayStartHour };
  const kind = row.kind;
  const explicitPick = kind === "BANK" && !row.countsTowardCap;
  const scheduledFor = (card: CardRowDb | null): boolean => {
    if (kind === "PRACTICE") return false;
    if (!card) return true;
    const c = cardRowOf(card);
    return isScheduled({ state: c.state, due: c.due, lastReview: c.lastReview, reviewedAt: clock.now, explicitPick, practice: false, timeZone: clock.timeZone, dayStartHour: clock.dayStartHour });
  };
  const payload: SessionPayload["items"] = [];
  const labels: SessionPayload["queueLabels"] = [];
  for (const it of stored) {
    const card = ctx.cards.get(it.key) ?? null;
    let build: ItemBuild | null = null;
    if (it.kind === "LICHESS_PUZZLE") {
      const snapshot = it.p ?? (card ? snapshotOfCard(card) : null);
      if (snapshot) build = { itemId: it.id, pass: it.pass, scheduled: scheduledFor(card), source: { kind: "puzzle", card, snapshot } };
    } else if (card && card.deck === "BANK" && card.mistakeRef && !card.hiddenAt) {
      build = { itemId: it.id, pass: it.pass, scheduled: scheduledFor(card), source: { kind: "bank", card } };
    }
    if (!build) continue;
    try {
      const item = trainItemOf(build, clock.now, clock.timeZone, prefs);
      payload.push(item);
      const label =
        build.source.kind === "bank"
          ? queueLabel((build.source.card.lastOpponentName ?? "").slice(0, 40), Math.max(1, num(build.source.card.moveNumber)), item.theme.label)
          : `Lichess puzzle · ${item.rating ?? ""} · ${item.theme.label}`;
      labels.push({ itemId: item.itemId, label: label.slice(0, 80) });
    } catch {
      // A corrupt row (its stored solution is not legal): the item is skipped; the report flow covers it.
    }
  }
  return { payload, labels };
}

function headerOf(kind: SessionKindDb, state: TrainState, withRating: boolean): SessionPayload["header"] {
  const p = state.profile;
  return {
    title: TITLE[kind],
    solveStreak: p.solveStreak,
    rating: withRating ? { value: p.puzzleRating, rd: p.puzzleRd, vol: p.puzzleVol, provisional: isProvisional(p.puzzleAttempts) } : null,
  };
}

function payloadOf(
  row: Pick<SessionRow, "referenceId" | "kind" | "status" | "theme" | "size" | "countsTowardCap">,
  stored: readonly StoredItem[],
  graded: ReadonlySet<string>,
  ctx: BuildContext,
  extra: { widened?: SessionPayload["widened"]; empty?: SessionPayload["empty"] } = {},
): SessionPayload {
  const { payload, labels } = itemsOf(stored, row, ctx);
  const hasPuzzles = stored.some((it) => it.kind === "LICHESS_PUZZLE");
  const cap = capOf(ctx.state.due, ctx.state.profile, ctx.state.counters);
  const puzzles = row.kind === "PUZZLES";
  const themes: ThemeOption[] | null = puzzles && ctx.themes ? themeOptionsOf(Math.round(ctx.state.profile.puzzleRating), ctx.themes) : null;
  return {
    ref: row.referenceId,
    kind: KIND_WIRE[row.kind],
    status: STATUS_WIRE[row.status],
    theme: row.theme ? { key: row.theme, label: themePluralLabel(row.theme) } : null,
    items: payload,
    resumeIndex: resumeIndexOf(
      payload.map((p) => ({ itemId: p.itemId, skipped: stored.find((s) => s.id === p.itemId)?.skipped })),
      graded,
    ),
    queueLabels: labels,
    header: headerOf(row.kind, ctx.state, puzzles || hasPuzzles),
    capRemaining: row.countsTowardCap ? cap.capRemaining : null,
    countsTowardCap: row.countsTowardCap,
    stream: puzzles && num(row.size) === 0,
    targetCount: puzzles && num(row.size) > 0 ? num(row.size) : null,
    themes,
    widened: extra.widened ?? null,
    empty: payload.length === 0 ? (extra.empty ?? "caughtup") : null,
  };
}

async function cardsFor(db: TrainDb, userId: bigint, stored: readonly StoredItem[]): Promise<Map<string, CardRowDb>> {
  const keys = [...new Set(stored.map((it) => it.key))];
  if (keys.length === 0) return new Map();
  const rows = await db.$queryRaw<CardRowDb[]>(cardsByKeySql(userId, keys));
  return new Map(rows.map((r) => [r.itemKey, r]));
}

function gradedOf(attempts: readonly AttemptRow[]): Set<string> {
  return new Set(attempts.flatMap((a) => (a.itemId ? [a.itemId] : [])));
}

/** A stored session read back as a payload (R3, a resume, W2's reuse). */
async function readPayload(db: TrainDb, viewer: Pick<Viewer, "id" | "ref">, row: SessionRow, state: TrainState): Promise<{ payload: SessionPayload; stored: StoredItem[]; graded: Set<string> }> {
  const stored = storedItemsOf(row);
  const [attempts, cards, themes] = await Promise.all([
    db.$queryRaw<AttemptRow[]>(sessionAttemptsSql(viewer.id, row.id, asDate(row.startedAt)!)),
    cardsFor(db, viewer.id, stored),
    row.kind === "PUZZLES" ? db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)) : Promise.resolve(null),
  ]);
  const graded = gradedOf(attempts);
  return { payload: payloadOf(row, stored, graded, { viewer, state, cards, themes }), stored, graded };
}

// ── R3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** R3 `include=items` and the runner's `?s=` resume. 404 for another member's (or a missing) ref. */
export async function getSession(viewer: Viewer, ref: string, now?: Date, deps: TrainDeps = trainDeps()): Promise<SessionPayload> {
  const at_ = now ?? (await requestNow());
  const [state, rows] = await Promise.all([loadTrainState(deps.db, viewer, at_), deps.db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, ref))]);
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  return (await readPayload(deps.db, viewer, row, state)).payload;
}

// ── W2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
type Composed = { plan: SessionPlan; snapshots: Map<string, PuzzleSnapshotV1>; cards: Map<string, CardRowDb>; themes: ThemeMasteryRow[] | null; size: number; mix: boolean };

function snapshotsOfPick(pick: PuzzlePick | null, cards: Map<string, CardRowDb>, requested: string): Map<string, PuzzleSnapshotV1> {
  const out = new Map<string, PuzzleSnapshotV1>();
  for (const it of pick?.items ?? []) {
    if (it.source === "shard") {
      const p = toShardPuzzle(it.puzzle);
      out.set(`p_${p.id}`, toPuzzleSnapshot(p, primaryThemeOf(p, requested)));
    } else {
      const card = cards.get(it.card.key);
      const snap = card ? snapshotOfCard(card) : null;
      if (snap) out.set(it.card.key, snap);
    }
  }
  return out;
}

async function pickPuzzles(
  deps: TrainDeps,
  viewer: Pick<Viewer, "id" | "ref">,
  state: TrainState,
  theme: string,
  count: number,
  sessionIds: ReadonlySet<string>,
  seedKey: string,
  shardDeps?: Partial<ShardDeps>,
): Promise<{ pick: PuzzlePick; cards: Map<string, CardRowDb> }> {
  const now = state.clock.now;
  const dueRows = await deps.db.$queryRaw<CardRowDb[]>(duePuzzleCardsSql(viewer.id, now, theme));
  const cards = new Map(dueRows.map((r) => [r.itemKey, r]));
  const dueCards: PuzzleCardIn[] = dueRows.flatMap((r) =>
    r.puzzleId ? [{ key: r.itemKey, puzzleId: r.puzzleId, rating: num(r.puzzleRating ?? 1500), due: asDate(r.due)! }] : [],
  );
  const pick = await selectPuzzleBatch(
    {
      rating: state.profile.puzzleRating,
      theme,
      count,
      sessionIds,
      dueCards,
      seed: seedOf(`${viewer.ref}|${state.clock.today}|${seedKey}`),
      exclude: async (ids) => {
        const rows = await deps.db.$queryRaw<{ puzzleId: string }[]>(recentPuzzlesSql(viewer.id, ids, now));
        return rows.map((r) => r.puzzleId);
      },
    },
    shardDeps,
  );
  return { pick, cards };
}

async function compose(
  deps: TrainDeps,
  viewer: Viewer,
  spec: SessionCreate,
  state: TrainState,
  themes: ThemeMasteryRow[],
  filterKey: string,
  shardDeps?: Partial<ShardDeps>,
): Promise<Composed> {
  const { db } = deps;
  const { clock } = state;
  const cap = capOf(state.due, state.profile, state.counters);
  const focus = focusTheme(planThemesOf(themes)).key;
  const limit = puzzleDailyLimit();

  if (spec.kind === "practice") {
    const rows = await db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, spec.fromSessionRef));
    if (!rows[0]) throw new DataError("not_found");
    const from = storedItemsOf(rows[0]).map((it) => ({ key: it.key, kind: it.kind, pass: it.pass, ...(it.p ? { puzzle: [it.p[0], it.p[1], it.p[2], it.p[3], 0] as const } : {}) }));
    const plan = buildSession("practice", { from });
    const snapshots = new Map<string, PuzzleSnapshotV1>();
    for (const it of storedItemsOf(rows[0])) if (it.p) snapshots.set(it.key, it.p);
    const cards = await cardsFor(db, viewer.id, storedItemsOf(rows[0]));
    return { plan, snapshots, cards, themes: null, size: plan.items.length, mix: false };
  }

  if (spec.kind === "puzzles") {
    if (!puzzlesEnabled()) throw new ApiError("upstream_unavailable", { details: { provider: "puzzles", kind: "disabled" } });
    const count = spec.count ?? EXTEND_ITEMS;
    if (exceedsPuzzleLimit(state.counters.puzzlesDone, count, limit)) throw puzzleLimitError(state);
    const theme = spec.theme ?? focus;
    const { pick, cards } = await pickPuzzles(deps, viewer, state, theme, count, new Set(), filterKey, shardDeps);
    const plan = buildSession("puzzles", { pick, ...(spec.count !== undefined ? { count: spec.count } : {}) });
    return { plan, snapshots: snapshotsOfPick(pick, cards, theme), cards, themes, size: spec.count ?? 0, mix: pick.theme !== theme };
  }

  if (spec.kind === "daily") {
    const plan = parseDailyPlan(state.today?.plan);
    const planDone = state.counters.planDone;
    const bankIdx = plan?.steps.findIndex((s) => s.kind === "bank") ?? -1;
    const puzzleIdx = plan?.steps.findIndex((s) => s.kind === "puzzles") ?? -1;
    const bankOpen = !(bankIdx >= 0 && isStepDone(planDone, bankIdx));
    const dueRows = bankOpen ? await db.$queryRaw<DueCardRow[]>(dueCardsSql(viewer.id, clock.now)) : [];
    const cards = new Map<string, CardRowDb>(dueRows.map((r) => [r.itemKey, r]));
    const step = puzzleIdx >= 0 ? plan!.steps[puzzleIdx]! : null;
    const puzzleOpen = puzzlesEnabled() && (plan ? step !== null && !isStepDone(planDone, puzzleIdx) : true);
    let pick: PuzzlePick | null = null;
    const theme = step?.theme ?? focus;
    if (puzzleOpen && !exceedsPuzzleLimit(state.counters.puzzlesDone, step?.count ?? PLAN_PUZZLE_COUNT, limit)) {
      const picked = await pickPuzzles(deps, viewer, state, theme, step?.count ?? PLAN_PUZZLE_COUNT, new Set(), filterKey, shardDeps);
      pick = picked.pick;
      for (const [k, v] of picked.cards) cards.set(k, v);
    }
    const frozen = plan && bankIdx >= 0 ? (plan.steps[bankIdx]!.cardKeys ?? []) : null;
    const built = buildSession("daily", {
      now: clock.now,
      frozenKeys: frozen,
      dueCards: dueRows.map(bankCardIn),
      capRemaining: cap.capRemaining,
      newRemaining: cap.newRemaining,
      puzzles: pick,
    });
    return { plan: built, snapshots: snapshotsOfPick(pick, cards, theme), cards, themes, size: built.items.length, mix: pick ? pick.theme !== theme : false };
  }

  // BANK: explicit picks, the "nothing due" practice list, or the due queue (filtered).
  if (spec.cardRefs || spec.gameRef) {
    let rows: CardRowDb[];
    if (spec.cardRefs) {
      const found = await db.$queryRaw<CardRowDb[]>(cardsByKeySql(viewer.id, spec.cardRefs));
      const byKey = new Map(found.filter((r) => r.deck === "BANK" && r.mistakeRef && !r.hiddenAt).map((r) => [r.itemKey, r]));
      if (byKey.size === 0) throw new DataError("not_found");
      rows = [...new Set(spec.cardRefs)].flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
    } else {
      const found = await db.$queryRaw<(CardRowDb & { gameId: bigint; momentPly: number | null })[]>(gameCardsSql(viewer.id, spec.gameRef!));
      if (found.length === 0) throw new DataError("not_found");
      const seen = new Set<string>();
      rows = [...found]
        .sort((a, b) => num(a.momentPly ?? 0) - num(b.momentPly ?? 0))
        .filter((r) => r.itemKey && r.mistakeRef && !seen.has(r.itemKey) && (seen.add(r.itemKey), true));
    }
    const plan = buildSession("bank", { mode: "explicit", cards: rows.map(bankCardIn) });
    return { plan, snapshots: new Map(), cards: new Map(rows.map((r) => [r.itemKey, r])), themes: null, size: plan.items.length, mix: false };
  }
  const filter = spec.filter ?? {};
  if (spec.practice) {
    const rows = await db.$queryRaw<CardRowDb[]>(bankRowsSql(viewer.id, { now: clock.now, filter, limit: 20 }));
    const plan = buildSession("bank", { mode: "list", cards: rows.map(bankCardIn) });
    return { plan, snapshots: new Map(), cards: new Map(rows.map((r) => [r.itemKey, r])), themes: null, size: plan.items.length, mix: false };
  }
  const rows = await db.$queryRaw<DueCardRow[]>(dueCardsSql(viewer.id, clock.now, filter));
  const filtered = Boolean(filter.theme || filter.phase || filter.source);
  const plan = buildSession("bank", {
    mode: "due",
    now: clock.now,
    dueCards: rows.map(bankCardIn),
    capRemaining: cap.capRemaining,
    newRemaining: cap.newRemaining,
    filtered,
    dueRaw: cap.dueRaw,
  });
  return { plan, snapshots: new Map(), cards: new Map(rows.map((r) => [r.itemKey, r])), themes: null, size: plan.items.length, mix: false };
}

export type OpenedSession = { payload: SessionPayload; created: boolean };

/**
 * W2 and the runner pages' create: returns an ACTIVE session of the same spec (< 2 h, not fully graded; 200, not
 * counted) or creates one (201). 404 for picks that are not the viewer's, 429 for the session or puzzle limit, 502
 * when a needed puzzle shard is down.
 */
export async function openSession(viewer: Viewer, spec: SessionCreate, now: Date, deps: TrainDeps = trainDeps(), shardDeps?: Partial<ShardDeps>): Promise<OpenedSession> {
  const { db } = deps;
  const kind = kindDbOf(spec);
  const [state, themes] = await Promise.all([loadTrainState(db, viewer, now), db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id))]);
  const filterKey = filterKeyOf(spec, state.clock.today);
  const limitRows = await db.$queryRaw<{ n1h: number; oldest: unknown; reuse: string | null }[]>(reuseSql(viewer.id, now, kind, filterKey));
  const lim = limitRows[0] ?? { n1h: 0, oldest: null, reuse: null };
  const reusable = !(spec.kind === "practice" || (spec.kind === "bank" && spec.practice));
  let emptyCandidate: SessionRow | null = null;
  if (reusable && lim.reuse) {
    const rows = await db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, lim.reuse));
    const row = rows[0];
    if (row) {
      const read = await readPayload(db, viewer, row, state);
      if (read.stored.length === 0) emptyCandidate = row;
      else if (read.payload.resumeIndex < read.payload.items.length) return { payload: read.payload, created: false };
    }
  }

  // The durable hourly limit before any build work (shard loads, exclusion reads): a member past it costs one read
  // (FIX-1 W2 order). An empty reusable session is still answered as it is (it is not a new session).
  if (num(lim.n1h) >= TRAIN_SESSION_HOURLY.limit) {
    if (emptyCandidate) return { payload: payloadOf(emptyCandidate, [], new Set(), { viewer, state, cards: new Map(), themes: null }), created: false };
    throw sessionLimitError(lim.oldest, now);
  }

  const composed = await compose(deps, viewer, spec, state, themes, filterKey, shardDeps);
  const ctx: BuildContext = { viewer, state, cards: composed.cards, themes: composed.themes };
  if (composed.plan.items.length === 0 && emptyCandidate) {
    return { payload: payloadOf(emptyCandidate, [], new Set(), ctx, { empty: composed.plan.empty }), created: false };
  }

  const stored = composed.plan.items.map((p) => plannedToStored(p, composed.snapshots.get(p.key)));
  const items = buildSessionItems({ v: 1, items: stored });
  const ref = newGameRef(now.getTime());
  const row = {
    referenceId: ref,
    kind,
    status: "ACTIVE" as const,
    theme: composed.plan.theme,
    size: composed.size,
    countsTowardCap: composed.plan.countsTowardCap,
  };
  const source = spec.kind === "practice" ? "deeplink" : (spec.source ?? "plan");
  // Two creates of the same member at once (two tabs, the runner page and the hub) are serialised by a per-member
  // transaction lock, and the reuse and the limit are checked again under it: the second one finds the first's
  // session (and returns it), and the 31st session of the hour is refused however the requests interleave (FIX-1).
  const winner = await deps.tx(async (tx) => {
    await tx.$queryRaw(memberLockSql(LOCK_TRAIN_SESSION, viewer.id));
    const again = (await tx.$queryRaw<{ n1h: number; oldest: unknown; reuse: string | null }[]>(reuseSql(viewer.id, now, kind, filterKey)))[0];
    if (reusable && again?.reuse && again.reuse !== lim.reuse) return again.reuse;
    if (num(again?.n1h) >= TRAIN_SESSION_HOURLY.limit) throw sessionLimitError(again?.oldest, now);
    if (kind === "PUZZLES") {
      await tx.$executeRaw(Prisma.sql`UPDATE training_sessions SET status = 'ABANDONED', "endedAt" = ${at(now)}
        WHERE "userId" = ${viewer.id} AND kind = 'PUZZLES' AND status = 'ACTIVE'`);
    }
    await tx.$executeRaw(Prisma.sql`INSERT INTO training_sessions ("referenceId", "userId", kind, status, source, "filterKey", theme, size,
        mix, "countsTowardCap", items, day, "startedAt")
      VALUES (${ref}, ${viewer.id}, ${kind}::"SessionKind", 'ACTIVE', ${source}, ${filterKey}, ${row.theme}, ${row.size}::smallint,
        ${composed.mix}, ${row.countsTowardCap}, ${JSON.stringify(items)}::jsonb, ${dayParam(state.clock.today)}, ${at(now)})`);
    if (!state.profile.exists) await tx.$executeRaw(insertProfileSql(viewer.id, state.profile));
    return null;
  });
  if (winner) {
    const rows = await db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, winner));
    if (rows[0]) return { payload: (await readPayload(db, viewer, rows[0], state)).payload, created: false };
  }
  const widened = composed.plan.widened ? { from: composed.plan.widened.from, to: composed.plan.widened.to } : null;
  return { payload: payloadOf(row, items.items, new Set(), ctx, { widened, empty: composed.plan.empty }), created: true };
}

/** The runner pages' create-or-resume (the same service and limits as W2). */
export async function createOrResumeSession(viewer: Viewer, spec: SessionCreate, now: Date, deps: TrainDeps = trainDeps()): Promise<SessionPayload> {
  return (await openSession(viewer, spec, now, deps)).payload;
}

// ── W3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * W3: 10 more puzzles after `after`. Idempotent: a repeat returns what was appended after it. The append is an
 * optimistic write (the item list must not have changed since the read), so no row lock is held across the shard
 * fetch; a lost race returns the winner's items. 409 `session_ended` for a session that is not ACTIVE.
 */
export async function extendSession(viewer: Viewer, ref: string, after: string, now: Date, deps: TrainDeps = trainDeps(), shardDeps?: Partial<ShardDeps>): Promise<ExtendResult> {
  const { db } = deps;
  const [state, rows] = await Promise.all([loadTrainState(db, viewer, now), db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, ref))]);
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  if (row.status !== "ACTIVE") throw new ApiError("conflict", { details: { reason: "session_ended" } });
  const stored = storedItemsOf(row);
  const asIds = stored.map((s) => ({ itemId: s.id, pass: s.pass }));
  const build = async (list: readonly StoredItem[]) => {
    const cards = await cardsFor(db, viewer.id, list);
    return itemsOf(list, row, { viewer, state, cards, themes: null }).payload;
  };
  const existing = itemsAfter(asIds, after);
  if (existing.length > 0) {
    const ids = new Set(existing.map((e) => e.itemId));
    return { items: (await build(stored.filter((s) => ids.has(s.id)))).slice(0, EXTEND_ITEMS), stream: row.kind === "PUZZLES" && num(row.size) === 0 };
  }
  if (row.kind !== "PUZZLES" || num(row.size) > 0) return { items: [], stream: false };
  if (!puzzlesEnabled()) return { items: [], stream: false };
  // A full stream ends here (SESSION_ITEMS_MAX, pass-2 copies included): the summary offers the next set (FIX-1).
  const room = Math.min(EXTEND_ITEMS, SESSION_ITEMS_MAX - stored.length);
  if (room <= 0) return { items: [], stream: false };
  if (exceedsPuzzleLimit(state.counters.puzzlesDone, room, puzzleDailyLimit())) throw puzzleLimitError(state);

  const theme = row.theme ?? "mix";
  const sessionIds = new Set(stored.flatMap((s) => (s.p ? [s.p[0]] : s.key.startsWith("p_") ? [s.key.slice(2)] : [])));
  const { pick, cards } = await pickPuzzles(deps, viewer, state, theme, room, sessionIds, `${row.filterKey}|${after}`, shardDeps);
  const added = extendItems(asIds, { ...pick, items: pick.items.slice(0, room) });
  if (added.length === 0) return { items: [], stream: false };
  const snapshots = snapshotsOfPick(pick, cards, theme);
  const appended = added.map((p) => plannedToStored(p, snapshots.get(p.key)));
  buildSessionItems({ v: 1, items: [...stored, ...appended] });
  // The new items are APPENDED to the stored list in SQL (never a rewrite of it): a skip (W5) or an Again re-queue
  // (W1) that commits between the read above and this write keeps its change. The length check makes a second
  // extend for the same `after` lose cleanly (it then answers the winner's items).
  const updated = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`UPDATE training_sessions
    SET items = jsonb_set(items, '{items}', (items->'items') || ${JSON.stringify(appended)}::jsonb)
    WHERE id = ${row.id} AND "userId" = ${viewer.id} AND status = 'ACTIVE'
      AND jsonb_array_length(items->'items') = ${stored.length}::int
    RETURNING id`);
  if (updated.length === 0) {
    const again = (await db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, ref)))[0];
    if (!again || again.status !== "ACTIVE") throw new ApiError("conflict", { details: { reason: "session_ended" } });
    const list = storedItemsOf(again);
    const ids = new Set(itemsAfter(list.map((s) => ({ itemId: s.id, pass: s.pass })), after).map((e) => e.itemId));
    return { items: (await build(list.filter((s) => ids.has(s.id)))).slice(0, EXTEND_ITEMS), stream: true };
  }
  const items = itemsOf(appended, row, { viewer, state, cards, themes: null }).payload;
  return { items, stream: stored.length + appended.length < SESSION_ITEMS_MAX };
}

// ── W4 and the summary ──────────────────────────────────────────────────────────────────────────────────────────
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The pre-session EWMA from the stored one and the session's own first-try results (in order). */
function ewmaBefore(ewma: number, results: readonly boolean[]): number {
  let e = ewma;
  for (let i = results.length - 1; i >= 0; i--) e = (e - 0.15 * (results[i] ? 1 : 0)) / 0.85;
  return Math.min(1, Math.max(0, e));
}

/** The summary of a session (R3 `include=summary`, W4, the summary page). */
export function summaryOf(
  row: SessionRow,
  attempts: readonly AttemptRow[],
  masteryRows: readonly ThemeMasteryRow[],
  state: TrainState,
): SessionSummary {
  const stored = storedItemsOf(row);
  const byItem = new Map<string, AttemptRow[]>();
  for (const a of attempts) if (a.itemId) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);
  const passOne = stored.filter((s) => s.pass === 1);
  let total = 0;
  let solved = 0;
  let firstTry = 0;
  let withHint = 0;
  const themeCount = new Map<string, number>();
  const themeFirstTry = new Map<string, boolean[]>();
  for (const it of passOne) {
    const first = byItem.get(it.id)?.[0];
    if (!first) continue;
    total += 1;
    const tries = [...(byItem.get(it.id) ?? []), ...(byItem.get(`${it.id}b`) ?? [])];
    if (tries.some((a) => a.solved && !a.solutionShown)) solved += 1;
    if (first.firstTry) firstTry += 1;
    if (first.solved && !first.solutionShown && num(first.wrongTries) === 0 && num(first.hintsUsed) > 0) withHint += 1;
    themeCount.set(first.theme, (themeCount.get(first.theme) ?? 0) + 1);
    themeFirstTry.set(first.theme, [...(themeFirstTry.get(first.theme) ?? []), first.firstTry]);
  }
  const skipped = stored.filter((s) => s.skipped).length;

  const prefs = { timeZone: state.clock.timeZone, releaseHour: state.profile.releaseHour, dayStartHour: state.clock.dayStartHour };
  const fallback = previewAll(newCardRow(state.clock.now), state.clock.now, prefs);
  const grades = (["again", "hard", "good", "easy"] as const).map((g) => {
    const rows = attempts.filter((a) => a.grade && gradeWire(a.grade) === g);
    const days = rows.flatMap((a) => (a.scheduledDays === null || a.scheduledDays === undefined ? [] : [num(a.scheduledDays)]));
    return { grade: g, n: rows.length, intervalLabel: days.length ? intervalLabel(median(days)) : fallback[g].label };
  });

  const themes = [...themeCount]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8)
    .map(([key, n]) => ({ key, label: themeLabel(key), n }));

  // A theme milestone crossed in this session: the stored milestone is above the level the theme had before it.
  let milestone: SessionSummary["milestone"] = null;
  for (const [theme, results] of themeFirstTry) {
    const m = masteryRows.find((r) => r.theme === theme);
    if (!m || num(m.milestonePct) === 0) continue;
    const before = ewmaBefore(num(m.ewma), results);
    const attemptsBefore = num(m.attempts) - results.length;
    const levelBefore = attemptsBefore >= 5 ? Math.floor(before * 10 + 1e-9) * 10 : 0;
    if (levelBefore < num(m.milestonePct)) {
      milestone = { kind: "theme", label: `Milestone · ${themeNoun(theme)}s ${num(m.milestonePct)}%`.slice(0, 60) };
      break;
    }
  }

  const ratings = attempts.filter((a) => a.ratingBefore !== null && a.ratingAfter !== null);
  const rating =
    row.kind === "PUZZLES" && ratings.length
      ? { value: Math.round(num(ratings[ratings.length - 1]!.ratingAfter)), delta: Math.round(num(ratings[ratings.length - 1]!.ratingAfter)) - Math.round(num(ratings[0]!.ratingBefore)) }
      : row.kind === "PUZZLES"
        ? { value: Math.round(state.profile.puzzleRating), delta: 0 }
        : null;

  const perfect = total >= 3 && isPerfectSession({ total, firstTry, skipped });
  const top = themes[0]?.key ?? focusTheme(planThemesOf(masteryRows)).key;
  const topPlural = themePluralLabel(top);
  const cap = capOf(state.due, state.profile, state.counters);
  const bankKinds = row.kind === "BANK" || row.kind === "DAILY";
  const puzzleTheme = row.theme ?? stored.find((s) => s.p)?.p?.[4] ?? null;
  const eyebrow =
    row.kind === "PUZZLES"
      ? `Session summary · ${row.theme ? themePluralLabel(row.theme) : "Puzzles"}`
      : row.kind === "PRACTICE"
        ? "Session summary · Practice"
        : row.kind === "DAILY" && puzzleTheme
          ? `Session summary · Mistake Bank + ${themeNoun(puzzleTheme)}s`
          : "Session summary · Mistake Bank";
  const doneForToday = bankKinds && cap.dueShown === 0;
  const title = perfect ? "A perfect session." : doneForToday ? "Done for today." : "Session complete.";
  const themeLine = (() => {
    const results = themeFirstTry.get(top) ?? [];
    if (results.length < 2) return "";
    return ` ${topPlural} are improving: ${results.filter(Boolean).length} of ${results.length} found on the first try.`;
  })();
  let subtitle: string;
  if (perfect) {
    subtitle = `${firstTry} of ${total} on the first try.${milestone ? ` ${topPlural} just passed ${milestone.label.replace(/^.* (\d+%)$/, "$1")} mastery.` : ""}`;
  } else if (row.kind === "PUZZLES") {
    subtitle = rating && rating.delta !== 0 ? `Rating ${rating.value} (${rating.delta > 0 ? "+" : ""}${rating.delta} this session).` : `${solved} of ${total} solved.`;
  } else if (doneForToday) {
    subtitle = `Your bank resets tomorrow.${themeLine}`;
  } else {
    subtitle = `${solved} of ${total} solved.${cap.dueShown > 0 && bankKinds ? ` ${cap.dueShown} more due in your bank.` : ""}${themeLine}`;
  }

  return {
    ref: row.referenceId,
    variant: perfect ? "perfect" : "default",
    kind: KIND_WIRE[row.kind],
    eyebrow: eyebrow.slice(0, 80),
    title,
    subtitle: subtitle.slice(0, 200),
    stats: { solved, total, firstTry, withHint, skipped },
    grades,
    themes,
    milestone,
    rating,
    next: {
      puzzles: { href: puzzlesHref(puzzleTheme ?? top, { source: "summary" }), note: "Rated and themed sets don't count against your bank cap" },
      lesson: null,
    },
    graded: attempts.length,
  };
}

/** The summary of one of the viewer's sessions (R3 `include=summary`, the summary page). 404 for a foreign ref. */
export async function getSessionSummary(viewer: Viewer, ref: string, now?: Date, deps: TrainDeps = trainDeps()): Promise<SessionSummary> {
  const t = now ?? (await requestNow());
  // One round trip: the day state, the session, its attempts (by the session's ref) and the theme rows in parallel.
  const [state, rows, mastery, attemptRows] = await Promise.all([
    loadTrainState(deps.db, viewer, t),
    deps.db.$queryRaw<SessionRow[]>(sessionSql(viewer.id, ref)),
    deps.db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)),
    deps.db.$queryRaw<AttemptRow[]>(sessionAttemptsByRefSql(viewer.id, ref)),
  ]);
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  return summaryOf(row, byReviewedAt(attemptRows), mastery, state);
}

/**
 * W4: ends an ACTIVE session (`done` → COMPLETED, `user` / `timeout` → ABANDONED, `endedAt` = now) and answers its
 * summary; a second call finds it ended and answers the same summary.
 */
export async function endSession(viewer: Viewer, ref: string, reason: "done" | "user" | "timeout", now: Date, deps: TrainDeps = trainDeps()): Promise<{ summary: SessionSummary; ended: boolean; kind: SessionKindDb }> {
  const status = reason === "done" ? "COMPLETED" : "ABANDONED";
  const ended = await deps.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`UPDATE training_sessions SET status = ${status}::"SessionStatus", "endedAt" = ${at(now)}
    WHERE "referenceId" = ${ref} AND "userId" = ${viewer.id} AND status = 'ACTIVE' RETURNING id`);
  const summary = await getSessionSummary(viewer, ref, now, deps);
  return { summary, ended: ended.length > 0, kind: (summary.kind.toUpperCase() as SessionKindDb) };
}

/** The SessionItemsV1 helpers W1 and W5 need (re-queue copies, skipped flags). */
export { storedItemsOf };
export type { StoredItem };
