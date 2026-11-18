// RECOMPUTE_WEAKNESS step 1 (phase-06 plan §7.4.2): everything the handler needs about the member, in ONE statement:
// the zone, the onboarding rating band, the entitlement columns (the web's rules through import/context.ts:
// isMember / isTrialing, never re-derived), the training profile's puzzle rating, weakness version and scope, and the
// newest snapshot's status, week and (when READY) top keys (the version rule, §8.16). The worker role reads only granted columns
// (replay_worker.p4.sql: entitlement + zone + ref; .p6.sql: ratingBand; .p5.sql: training_profiles).
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { RatingBandDb, WeaknessProfileRow, WeaknessScope } from "@repo/chess-training/weakness/types";
import { idStr, num, numOrNull, stmt, type Db, type Row, type Statement } from "../db/client";
import { isMember, isTrialing, type ImportMember } from "../import/context";

const ms = (col: string) => `(extract(epoch FROM ${col}) * 1000)::float8`;

export interface WeaknessContext {
  userId: string;
  userRef: string;
  timeZone: string;
  ratingBand: RatingBandDb | null;
  member: ImportMember;
  puzzleRating: number | null;
  weaknessVersion: number;
  profile: WeaknessProfileRow | null;
  /** `metrics.topKeys` of the newest snapshot when it is READY, or null (the version rule, §8.16). */
  prevTop: string[] | null;
  /**
   * The member's NEWEST snapshot is READY: what the page serves (Q-W1). FIX-2 (D-P6-FIX2-12): an older week's READY
   * row behind a newer INSUFFICIENT or FAILED one (a purge, a narrower scope) does not count: the member sees the
   * insufficient / computing page and gets its progress frames, first_build and failure row.
   */
  hadReady: boolean;
  /** A READY snapshot exists in any week (`weakness_first_ready` is the member's first ever). */
  everReady: boolean;
  /** The newest snapshot's week ("YYYY-MM-DD"), or null: a recompute never writes an older week (D-P6-FIX2-11). */
  latestWeekStart: string | null;
  /** Any snapshot row exists (any status). */
  hasSnapshot: boolean;
  /** The newest snapshot's algoVersion, or null. */
  latestAlgo: number | null;
}

export function weaknessContextStatement(userId: string): Statement {
  return stmt(
    `SELECT u.id::text AS id, u."referenceId" AS ref, u."timeZone", u."ratingBand"::text AS "ratingBand", u.role::text AS role,
        u."subscriptionStatus", ${ms(`u."currentPeriodEnd"`)} AS "currentPeriodEndMs", u."cancelAtPeriodEnd",
        ${ms(`u."trialStartedAt"`)} AS "trialStartedAtMs", ${ms(`u."trialEndsAt"`)} AS "trialEndsAtMs",
        tp."puzzleRating", tp."weaknessVersion", tp."weaknessTimeClasses"::text[] AS "weaknessTimeClasses",
        tp."weaknessMonths", (tp."userId" IS NOT NULL) AS "hasProfile",
        CASE WHEN latest.status = 'READY' THEN latest.metrics -> 'topKeys' END AS "prevTop",
        COALESCE(latest.status = 'READY', false) AS "hadReady",
        EXISTS (SELECT 1 FROM weakness_snapshots ws WHERE ws."userId" = u.id AND ws.status = 'READY') AS "everReady",
        to_char(latest."weekStart", 'YYYY-MM-DD') AS "latestWeekStart",
        latest."algoVersion" AS "latestAlgo", (latest."weekStart" IS NOT NULL) AS "hasSnapshot"
   FROM users u
   LEFT JOIN training_profiles tp ON tp."userId" = u.id
   LEFT JOIN LATERAL (SELECT ws."algoVersion", ws."weekStart", ws.status::text AS status, ws.metrics FROM weakness_snapshots ws
                       WHERE ws."userId" = u.id ORDER BY ws."weekStart" DESC LIMIT 1) latest ON true
  WHERE u.id = $1::bigint`,
    [userId],
  );
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const RATING_BANDS = new Set(["NEW_TO_CHESS", "UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"]);

/** Postgres text[] comes back as an array (pg, Neon) or, through some drivers, as its literal. */
export function textArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("{") && v.endsWith("}")) {
    const inner = v.slice(1, -1);
    return inner === "" ? [] : inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
  }
  return [];
}

export function toWeaknessContext(row: Row): WeaknessContext {
  const prevTop = Array.isArray(row.prevTop) ? row.prevTop.map(String) : null;
  const band = str(row.ratingBand);
  return {
    userId: idStr(row.id),
    userRef: String(row.ref),
    timeZone: str(row.timeZone) ?? "UTC",
    ratingBand: band && RATING_BANDS.has(band) ? (band as RatingBandDb) : null,
    member: {
      userRef: String(row.ref),
      timeZone: str(row.timeZone) ?? "UTC",
      role: str(row.role) ?? "USER",
      subscriptionStatus: str(row.subscriptionStatus),
      currentPeriodEndMs: numOrNull(row.currentPeriodEndMs),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
      trialStartedAtMs: numOrNull(row.trialStartedAtMs),
      trialEndsAtMs: numOrNull(row.trialEndsAtMs),
    },
    puzzleRating: numOrNull(row.puzzleRating),
    weaknessVersion: row.weaknessVersion === null || row.weaknessVersion === undefined ? 0 : num(row.weaknessVersion),
    profile:
      row.hasProfile === true
        ? { weaknessTimeClasses: textArray(row.weaknessTimeClasses), weaknessMonths: numOrNull(row.weaknessMonths) ?? 0 }
        : null,
    prevTop: row.hadReady === true ? (prevTop ?? []) : null,
    hadReady: row.hadReady === true,
    everReady: row.everReady === true,
    latestWeekStart: str(row.latestWeekStart),
    hasSnapshot: row.hasSnapshot === true,
    latestAlgo: numOrNull(row.latestAlgo),
  };
}

export async function loadWeaknessContext(db: Db, userId: string): Promise<WeaknessContext | null> {
  const rows = await db.query(weaknessContextStatement(userId));
  return rows[0] ? toWeaknessContext(rows[0]) : null;
}

/**
 * The week a recompute writes (FIX-2, D-P6-FIX2-11): the member's current local week, never older than the newest row.
 * A member who moves west across Monday midnight computes an earlier Monday; writing it would overwrite last week's
 * history while Q-W1 (newest week first) kept serving the newer, now stale row.
 */
export function writeWeekOf(current: string, latestWeekStart: string | null): string {
  return latestWeekStart !== null && latestWeekStart > current ? latestWeekStart : current;
}

/** The member's scope and its window start (the Q-W5 `since`), at `now` in the member's zone. */
export function scopeOf(c: Pick<WeaknessContext, "profile" | "timeZone">, now: Date): { scope: WeaknessScope; since: Date } {
  const scope = resolveScope(c.profile);
  return { scope, since: scopeSince(now, c.timeZone, scope.months) };
}

/** The web's `member` (an admin, entitled, or everyone with the paywall off): lapsed members are skipped. */
export function isWeaknessMember(c: WeaknessContext, nowMs: number, paywall: boolean): boolean {
  return isMember(c.member, nowMs, paywall);
}

export function isWeaknessTrialing(c: WeaknessContext, nowMs: number): boolean {
  return isTrialing(c.member, nowMs);
}
