// TR-12 `POST /api/train/weakness/recompute` and TR-13 `POST /api/train/weakness/seen` (phase-06 plan §7.1.2,
// §7.1.3, §7.4.1, §5.4; AP-09, AP-11).
//
// requestRecompute: Retry, "Include bullet games" and the orphaned page's auto-build. The durable 1-per-600-s limit is
// read from the member's own job row (`payload.userAt`) inside the shared enqueue statement (`requestRecomputeSql`,
// @repo/db/weakness-jobs), so it survives a Neon scale-to-zero (the UNLOGGED burst table does not): a refused request
// writes nothing and answers 429 with `retryAfterSec`. A scope change is written in the same transaction, AFTER the
// enqueue and only when it was accepted: the enqueue holds the job row's lock until commit, so of two concurrent
// requests the refused one never changes the scope (a write in a sibling CTE would, since both CTEs read one snapshot),
// and a member without a profile row gets P5's puzzle-rating seed with it (`readProfile`). The kick runs after the
// response (`after()`), with `runAt`.
//
// markWeaknessSeen (Q-W9): `lastWeaknessSeenVersion = GREATEST(seen, LEAST(v, weaknessVersion))`, so a stale or forged
// version can neither lower it nor run ahead of the real one. No row (no profile yet) is a no-op.
import { Prisma } from "@repo/db";
import { recomputeRetryAfterSec, requestRecomputeSql } from "@repo/db/weakness-jobs";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { WEAKNESS_RECOMPUTE_WINDOW_SEC, type RecomputeBody, type RecomputeResponse } from "@repo/contracts/http/weakness";
import { resolveScope } from "@repo/chess-training/weakness/scope";
import type { WeaknessScope } from "@repo/chess-training/weakness/types";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { kickWorker, type KickResult } from "@/lib/services/analysis/kick";
import { NOW_UTC, num, trainDeps, type TrainDeps } from "./db.server";
import { readProfile, unseededRow } from "./profile.server";
import { weaknessKickBody, weaknessProfileSql } from "./weakness.server";

type StoredScopeRow = { weaknessTimeClasses: string[] | null; weaknessMonths: number; ratingSeeded?: boolean; puzzleAttempts?: number | bigint };

/** The scope the body asks for: unspecified fields keep the stored ones; both resolved (defaults, order) like the worker. */
export function requestedScope(stored: StoredScopeRow | null, body: RecomputeBody): { current: WeaknessScope; next: WeaknessScope } {
  const row = { weaknessTimeClasses: stored?.weaknessTimeClasses ?? [], weaknessMonths: num(stored?.weaknessMonths ?? 0) };
  const current = resolveScope(row);
  const next = resolveScope({
    weaknessTimeClasses: body.timeClasses ?? current.timeClasses,
    weaknessMonths: body.months ?? current.months,
  });
  return { current, next };
}

export function sameScope(a: WeaknessScope, b: WeaknessScope): boolean {
  return a.months === b.months && a.timeClasses.length === b.timeClasses.length && a.timeClasses.every((tc, i) => b.timeClasses[i] === tc);
}

/** Applies the seed over a row the worker created unseeded (profile.server `unseededRow`), else keeps the rating. */
const UNSEEDED = Prisma.sql`(NOT training_profiles."ratingSeeded" AND training_profiles."puzzleAttempts" = 0)`;
const SEED_UNSEEDED = Prisma.sql`"puzzleRating" = CASE WHEN ${UNSEEDED} THEN EXCLUDED."puzzleRating" ELSE training_profiles."puzzleRating" END,
      "puzzleRd" = CASE WHEN ${UNSEEDED} THEN EXCLUDED."puzzleRd" ELSE training_profiles."puzzleRd" END,
      "puzzleVol" = CASE WHEN ${UNSEEDED} THEN EXCLUDED."puzzleVol" ELSE training_profiles."puzzleVol" END,
      "ratingSeeded" = true`;

/**
 * Stores the scope on the member's training profile (`training_profiles_pkey`), creating the row with P5's puzzle
 * rating seed when the member has none yet (`"updatedAt"` has no column default: M5).
 */
export function upsertScopeSql(userId: bigint, scope: WeaknessScope, seed: { puzzleRating: number; puzzleRd: number; puzzleVol: number }): Prisma.Sql {
  return Prisma.sql`INSERT INTO training_profiles ("userId", "puzzleRating", "puzzleRd", "puzzleVol", "ratingSeeded",
      "weaknessTimeClasses", "weaknessMonths", "updatedAt")
    VALUES (${userId}, ${seed.puzzleRating}::real, ${seed.puzzleRd}::real, ${seed.puzzleVol}::real, true,
      ${scope.timeClasses as string[]}::"TimeClass"[], ${scope.months}::smallint, ${NOW_UTC})
    ON CONFLICT ("userId") DO UPDATE SET "weaknessTimeClasses" = EXCLUDED."weaknessTimeClasses",
      "weaknessMonths" = EXCLUDED."weaknessMonths", "updatedAt" = EXCLUDED."updatedAt",
      ${SEED_UNSEEDED}`;
}

/** `requestRecomputeSql`'s row (its `scope` variant is not used: see the header). */
type EnqueueRow = { queued: number | bigint; prevUserAtMs: number | null };

/** 429 for the durable limit: retry when the previous request is 600 s old (1 … 600 s). */
export function recomputeLimitError(prevUserAtMs: number | null, now: Date): ApiError {
  const retryAfterSec =
    prevUserAtMs === null
      ? WEAKNESS_RECOMPUTE_WINDOW_SEC
      : Math.min(WEAKNESS_RECOMPUTE_WINDOW_SEC, recomputeRetryAfterSec(prevUserAtMs, now.getTime()));
  return new ApiError("rate_limited", { retryAfterSec, details: { reason: "recompute_limit", bucket: "weakness-recompute" } });
}

export type RecomputeOutcome = { response: RecomputeResponse; kick: () => Promise<KickResult> };

/**
 * TR-12: one read (the stored scope; plus P5's rating seed when the member has no profile row and the scope changes),
 * then the rate-limited enqueue (one statement, or one transaction with the scope write). Throws 429 inside the window.
 */
export async function requestRecompute(viewer: Pick<Viewer, "id" | "onboarding">, body: RecomputeBody, now: Date, deps: TrainDeps = trainDeps()): Promise<RecomputeOutcome> {
  const rows = await deps.db.$queryRaw<StoredScopeRow[]>(weaknessProfileSql(viewer.id));
  const stored = rows[0] ?? null;
  const { current, next } = requestedScope(stored, body);
  const scopeChanged = !sameScope(current, next);
  const enqueue = requestRecomputeSql({
    userId: viewer.id,
    trigger: scopeChanged ? "scope" : "user",
    priority: JOB_PRIORITY.USER_OPENED,
    runAt: now,
    debounceSec: 0,
    now,
  });

  let result: EnqueueRow | undefined;
  if (!scopeChanged) {
    result = (await deps.db.$queryRaw<EnqueueRow[]>(enqueue))[0];
  } else {
    // P5's seed for a member without a row, or with a row the worker created unseeded (its weaknessVersion bump).
    const seed = stored && !unseededRow({ ratingSeeded: stored.ratingSeeded ?? true, puzzleAttempts: num(stored.puzzleAttempts ?? 0) })
      ? null
      : await readProfile(deps.db, viewer);
    result = await deps.tx(async (tx) => {
      const r = (await tx.$queryRaw<EnqueueRow[]>(enqueue))[0];
      if (num(r?.queued) > 0) {
        await tx.$executeRaw(
          upsertScopeSql(viewer.id, next, seed ?? { puzzleRating: 1500, puzzleRd: 350, puzzleVol: 0.06 }),
        );
      }
      return r;
    });
  }
  if (num(result?.queued) === 0) throw recomputeLimitError(result?.prevUserAtMs === null || result?.prevUserAtMs === undefined ? null : num(result.prevUserAtMs), now);
  return {
    response: { status: "computing", queuedAt: now.toISOString(), scopeChanged },
    kick: () => kickWorker(weaknessKickBody(now)),
  };
}

/** Q-W9 (`training_profiles_pkey`, a HOT update). */
export function markSeenSql(userId: bigint, version: number): Prisma.Sql {
  return Prisma.sql`UPDATE training_profiles
    SET "lastWeaknessSeenVersion" = GREATEST("lastWeaknessSeenVersion", LEAST(${version}::int, "weaknessVersion")), "updatedAt" = ${NOW_UTC}
    WHERE "userId" = ${userId} AND "lastWeaknessSeenVersion" < LEAST(${version}::int, "weaknessVersion")`;
}

/** TR-13: marks the profile version seen (idempotent; a lower or repeated version changes nothing). */
export async function markWeaknessSeen(viewer: Pick<Viewer, "id">, version: number, deps: Pick<TrainDeps, "db"> = trainDeps()): Promise<void> {
  await deps.db.$executeRaw(markSeenSql(viewer.id, version));
}
