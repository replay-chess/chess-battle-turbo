// Due counts and the nav badges (phase-05 plan §7.3 statement (a), R8, §8.5; interface check §0.13).
//
//   dueSummarySql()   statement (a): due review / due new / total / the next batch, one range read of
//                     training_cards_userId_deck_due_idx. R1, R2, HOME-1 and W1's response read it.
//   BADGE_FACTS_SQL   the same counts plus the cap inputs (profile cap, newPerDay, dayStartHour; the latest
//                     training_days row) as ONE json scalar, folded into the viewer statement (`VIEWER_SQL`, so
//                     /api/me stays one statement) and used alone by R8 when the viewer did not carry it.
//   badgesFrom()      the cap formula in TS (§8.5): the latest training_days row counts only when it is today's, with
//                     today pinned across a zone change exactly as R1/W1/W2 pin it (`trainingDayAt`; FIX-2).
//
// Skipped cards (`suspendedUntil` ahead of now) are not due. The badge is `dueShown` (capped), as the hub shows it.
//
// P6 (phase-06 plan §7.1.5 ME-2, §8.16; WP7): the profile's `wv` / `ws` (weaknessVersion, lastWeaknessSeenVersion)
// ride in the same json scalar (training_profiles_pkey, already read), so /api/me and R8 each stay ONE statement.
// `weaknessReady` = flag on ∧ wv > ws, and then `trainDot ||= weaknessReady`. With the flag off the badges are P5's,
// byte for byte (`badgesFor`).
import { Prisma } from "@repo/db";
import type { Badges } from "@repo/contracts/http/train";
import { capState, type Arrival, type CapState } from "@repo/chess-training/caps";
import { DEFAULT_BANK_DAILY_CAP, DEFAULT_DAY_START_HOUR, DEFAULT_NEW_PER_DAY } from "@repo/chess-training/constants";
import { trainingDayAt } from "@repo/chess-training/day";
import { isValidTimeZone } from "@repo/chess-training/tz";
import { badgesFor } from "../auth/viewer-dto";
import { asDate, at, num, type TrainDb } from "./db.server";

export type DueSummary = {
  dueReview: number;
  dueNew: number;
  total: number;
  /** The earliest future due (null when nothing is scheduled ahead). */
  nextAt: Date | null;
  /** The next batch: the next release when cards are due by then, else the earliest future due. */
  nextBatchAt: Date | null;
  /** Cards falling due by `nextBatchAt`, uncapped: what the screens show comes from `arrivals` (`servedByDay`). */
  nextBatch: number;
  /** The cards falling due in the next 14 days, grouped by instant and NEW-ness (a skipped card at its skip end). */
  arrivals: Arrival[];
};

/**
 * Statement (a). `rel` = the next release instant: the batch is every card due in (now, max(rel, nextAt)], so a bank
 * whose next cards come in three days still says when and how many. `arrivals` = the cards that fall due in the next
 * 14 days (a skipped card when its skip ends), grouped by instant and NEW-ness, for the cap projection (`servedByDay`).
 */
export function dueSummarySql(userId: bigint, now: Date, rel: Date): Prisma.Sql {
  const NOW = at(now);
  return Prisma.sql`WITH c AS (
      SELECT due, state, ("suspendedUntil" IS NOT NULL AND "suspendedUntil" > ${NOW}) AS skipped,
             GREATEST(due, COALESCE("suspendedUntil", due)) AS avail
        FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK'),
    n AS (SELECT min(due) AS next_at FROM c WHERE due > ${NOW}),
    a AS (SELECT avail, state = 'NEW' AS fresh, count(*)::int AS k FROM c
           WHERE avail > ${NOW} AND avail <= ${NOW} + interval '14 days' GROUP BY 1, 2)
    SELECT count(*) FILTER (WHERE due <= ${NOW} AND state <> 'NEW' AND NOT skipped)::int AS "dueReview",
           count(*) FILTER (WHERE due <= ${NOW} AND state = 'NEW' AND NOT skipped)::int AS "dueNew",
           count(*)::int AS total,
           (SELECT next_at FROM n) AS "nextAt",
           GREATEST(${at(rel)}, (SELECT next_at FROM n)) AS "nextBatchAt",
           count(*) FILTER (WHERE due > ${NOW} AND due <= GREATEST(${at(rel)}, (SELECT next_at FROM n)))::int AS "nextBatch",
           (SELECT coalesce(json_agg(json_build_object('at', avail, 'new', fresh, 'n', k) ORDER BY avail), '[]'::json) FROM a) AS arrivals
      FROM c`;
}

type DueRow = { dueReview: number; dueNew: number; total: number; nextAt: unknown; nextBatchAt: unknown; nextBatch: number; arrivals?: unknown };

/** The `arrivals` json (`[{at, new, n}]`, `at` a UTC timestamp without zone) as Arrival rows; anything malformed is dropped. */
export function arrivalsOf(value: unknown): Arrival[] {
  const v = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(v)) return [];
  return v.flatMap((x: unknown) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    const when = o ? asDate(o.at) : null;
    return o && when ? [{ at: when, isNew: o.new === true, n: num(o.n) }] : [];
  });
}

export function dueSummaryOf(row: DueRow | undefined): DueSummary {
  const nextAt = asDate(row?.nextAt);
  const nextBatch = num(row?.nextBatch);
  return {
    dueReview: num(row?.dueReview),
    dueNew: num(row?.dueNew),
    total: num(row?.total),
    nextAt,
    nextBatchAt: nextAt ? asDate(row?.nextBatchAt) : null,
    nextBatch: nextAt ? nextBatch : 0,
    arrivals: arrivalsOf(row?.arrivals),
  };
}

export async function readDueSummary(db: TrainDb, userId: bigint, now: Date, rel: Date): Promise<DueSummary> {
  const rows = await db.$queryRaw<DueRow[]>(dueSummarySql(userId, now, rel));
  return dueSummaryOf(rows[0]);
}

/** Today's counters (training_days_pkey), zeros when the row does not exist yet. */
export type DayCounters = { bankReviewed: number; newIntroduced: number; puzzlesDone: number; planDone: number };

export const ZERO_DAY: DayCounters = { bankReviewed: 0, newIntroduced: 0, puzzlesDone: 0, planDone: 0 };

export function capOf(due: Pick<DueSummary, "dueReview" | "dueNew">, profile: { bankDailyCap: number; newPerDay: number }, day: DayCounters): CapState {
  return capState({
    cap: profile.bankDailyCap,
    newPerDay: profile.newPerDay,
    bankReviewed: day.bankReviewed,
    newIntroduced: day.newIntroduced,
    dueReview: due.dueReview,
    dueNew: due.dueNew,
  });
}

// ── The viewer statement's badge facts ──────────────────────────────────────────────────────────────────────────
/**
 * One json scalar (`{r, n, p, d}`): due review / due new BANK cards (not skipped), the profile's cap inputs and the
 * latest training_days row. `u` and `now` are SQL expressions of the enclosing statement (the viewer statement binds
 * the request clock as `$2`). Index range reads only: training_cards_userId_deck_due_idx, training_profiles_pkey,
 * training_days_pkey (backward, LIMIT 1).
 */
export function badgeFactsSql(u: string, now: string): string {
  return (
    `(SELECT json_build_object(` +
    `'r', count(*) FILTER (WHERE bc.state <> 'NEW'), 'n', count(*) FILTER (WHERE bc.state = 'NEW'), ` +
    `'p', (SELECT json_build_object('cap', tp."bankDailyCap", 'npd', tp."newPerDay", 'dsh', tp."dayStartHour", ` +
    `'wv', tp."weaknessVersion", 'ws', tp."lastWeaknessSeenVersion") ` +
    `FROM training_profiles tp WHERE tp."userId" = ${u}), ` +
    `'d', (SELECT json_build_object('day', to_char(td.day, 'YYYY-MM-DD'), 'br', td."bankReviewed", 'ni', td."newIntroduced", ` +
    `'tz', td."timeZone", 'dsh', td."dayStartHour") ` +
    `FROM training_days td WHERE td."userId" = ${u} ORDER BY td.day DESC LIMIT 1)) ` +
    `FROM training_cards bc WHERE bc."userId" = ${u} AND bc.deck = 'BANK' AND bc.due <= ${now} ` +
    `AND (bc."suspendedUntil" IS NULL OR bc."suspendedUntil" <= ${now}))`
  );
}

export type BadgeFacts = {
  r: number;
  n: number;
  /** P6: `wv` / `ws` are the profile's weaknessVersion / lastWeaknessSeenVersion (0 when absent). */
  p: { cap: number; npd: number; dsh: number; wv?: number; ws?: number } | null;
  /** The latest day row, with the zone it was opened in (m5b; null on older rows). */
  d: { day: string; br: number; ni: number; tz: string | null; dsh: number | null } | null;
};

function factsOf(value: unknown): BadgeFacts | null {
  const v = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const p = o.p && typeof o.p === "object" ? (o.p as Record<string, unknown>) : null;
  const d = o.d && typeof o.d === "object" ? (o.d as Record<string, unknown>) : null;
  return {
    r: num(o.r),
    n: num(o.n),
    p: p ? { cap: num(p.cap), npd: num(p.npd), dsh: num(p.dsh), wv: num(p.wv), ws: num(p.ws) } : null,
    d:
      d && typeof d.day === "string"
        ? { day: d.day, br: num(d.br), ni: num(d.ni), tz: typeof d.tz === "string" ? d.tz : null, dsh: d.dsh === null || d.dsh === undefined ? null : num(d.dsh) }
        : null,
  };
}

/** P6 badge options: `weakness` = the viewer's `weakness` flag (off, or absent, gives P5's badges unchanged). */
export type BadgeOptions = { weakness?: boolean };

/** A new weakness profile is waiting: the profile's version moved past what the member has seen (§8.16). */
export function weaknessUnseen(f: Pick<BadgeFacts, "p"> | null): boolean {
  return (f?.p?.wv ?? 0) > (f?.p?.ws ?? 0);
}

export { badgesFor };

/**
 * The badges from the facts: `bankDue` = the capped due count (§8.5); `trainDot` = something is due. With
 * `{weakness: true}` (P6) also `weaknessReady`, folded into `trainDot`.
 */
export function badgesFrom(value: unknown, timeZone: string, now: Date, opts: BadgeOptions = {}): Badges {
  const f = factsOf(value);
  if (!f) return opts.weakness ? { bankDue: 0, trainDot: false, weaknessReady: false } : { bankDue: 0, trainDot: false };
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  // The day in progress keeps its key across a zone change (the hub, W1 and W2 say the same; FIX-2).
  const anchor = f.d && f.d.tz && f.d.dsh !== null ? { day: f.d.day, timeZone: f.d.tz, dayStartHour: f.d.dsh } : null;
  const today = trainingDayAt(now, tz, f.p?.dsh ?? DEFAULT_DAY_START_HOUR, anchor).key;
  const day = f.d && f.d.day === today ? { bankReviewed: f.d.br, newIntroduced: f.d.ni, puzzlesDone: 0, planDone: 0 } : ZERO_DAY;
  const cap = capOf({ dueReview: f.r, dueNew: f.n }, { bankDailyCap: f.p?.cap ?? DEFAULT_BANK_DAILY_CAP, newPerDay: f.p?.npd ?? DEFAULT_NEW_PER_DAY }, day);
  return badgesFor({ bankDue: cap.dueShown, trainDot: cap.dueShown > 0, weaknessReady: weaknessUnseen(f) }, opts.weakness === true);
}

/** R8: one statement (the badge facts of the viewer at `now`); `opts.weakness` = the viewer's `weakness` flag (P6). */
export async function getBadges(
  db: { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T> },
  viewer: { id: bigint; timeZone: string },
  now: Date,
  opts: BadgeOptions = {},
): Promise<Badges> {
  const sql = `SELECT ${badgeFactsSql("$1::bigint", "($2::timestamptz AT TIME ZONE 'UTC')")} AS facts`;
  const rows = await db.$queryRawUnsafe<{ facts: unknown }[]>(sql, viewer.id.toString(), now.toISOString());
  return badgesFrom(rows[0]?.facts, viewer.timeZone, now, opts);
}
