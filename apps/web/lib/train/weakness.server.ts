// TR-5 `GET /api/train/weakness` and the `/train/weakness` RSC seed (phase-06 plan §5.2, §7.1.1, §6.5, §9.1).
//
// Read path, at most 2 sequential round trips:
//   1. Q-W1 (latest snapshot, PK backward scan) ‖ Q-W2 (live bank counts per theme) ‖ Q-W4 (training profile)
//      ‖ the jobs part of Q-W3 (active ANALYZE_GAME / RECOMPUTE_WEAKNESS / IMPORT_SYNC, plus the weakness row when it
//      FAILED: `jobs_user_active_idx`, `jobs_dedupeKey_key`);
//   2. only when there is no READY snapshot or work is active: the game_players part of Q-W3 (the scope window's
//      counts per time class) ‖ the running imports ‖ Q-W3b (the newest analysis, only while analyses are queued).
// Then the pure `buildPayload()` (TRN) and the version ETag. The GET never enqueues (AP-09): its one write is the
// kick compare-and-set Q-W12 on a stale QUEUED recompute, run in `after()` by the route (registered `kick_cas`).
//
// Every timestamp column is UTC `timestamp(3)`; instants are bound with `at()` from the request clock `now`.
import { inputsHealableSql } from "@repo/chess-analysis/weakness-inputs";
import { Prisma } from "@repo/db";
import { parseWeaknessMetrics } from "@repo/db/json";
import { weaknessKickCasSql } from "@repo/db/weakness-jobs";
import { weaknessDedupeKey } from "@repo/contracts/internal/jobs";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import {
  buildPayload,
  type PayloadProbe,
  type PayloadProfile,
  type PayloadSnapshot,
} from "@repo/chess-training/weakness/payload";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { RecomputeState } from "@repo/chess-training/weakness/status";
import { fnv1a64 } from "@/lib/api/etag";
import { requestNow } from "@/lib/api/now";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { kickWorker, type KickResult } from "@/lib/services/analysis/kick";
import { timeZoneOf } from "./day.server";
import { seedOf, unseededRow, type RatingSource } from "./profile.server";
import { asDate, at, num, trainDeps, type TrainDb, type TrainDeps } from "./db.server";
import { resolveLessons } from "./weakness-lessons.server";

// ── Statements ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Q-W1: the member's latest snapshot (`weakness_snapshots_pkey`, Index Scan Backward, 1 row). */
export function latestSnapshotSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT to_char("weekStart", 'YYYY-MM-DD') AS "weekStart", "algoVersion", status::text AS status,
      "gamesInScope", "gamesAnalysed", metrics, "computedAt"
    FROM weakness_snapshots WHERE "userId" = ${userId} ORDER BY "weekStart" DESC LIMIT 1`;
}

/**
 * Q-W2: BANK cards per theme carried by their mistake (any position in `themes`, so `rc:timePressure` counts too),
 * hidden mistakes excluded (`training_cards_userId_deck_due_idx` prefix + `mistakes_pkey`). FIX-2 (D-P6-FIX2-9): cards
 * skipped until the next release (`suspendedUntil` > now) are left out exactly as Q-W7 leaves them out, so the
 * preview's "{own} from your games" and the week plan describe the drill TR-7 then starts. `m."userId"` (always the
 * card's) lets the planner read the member's mistakes by `mistakes_userId_createdAt_idx` instead of scanning every
 * member's (FIX-2: the §9.1 volume gate measured a Seq Scan on mistakes at 20 members × 500).
 */
export function bankThemeCountsSql(userId: bigint, now: Date): Prisma.Sql {
  return Prisma.sql`SELECT t AS theme, count(*)::int AS n
    FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" CROSS JOIN LATERAL unnest(m.themes) t
    WHERE c."userId" = ${userId} AND c.deck = 'BANK' AND m."userId" = ${userId} AND m."hiddenAt" IS NULL
      AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${at(now)})
    GROUP BY t`;
}

/** Q-W4: the profile columns the page reads (`training_profiles_pkey`). */
export function weaknessProfileSql(userId: bigint): Prisma.Sql {
  // `seedSources`: the linked-account ratings P5's seed reads (profile.server.ts ratingsSql), only for a row the worker
  // created before any training write (not seeded, no rated puzzle), in the same statement (regression:
  // weakness-rating-unseeded).
  return Prisma.sql`SELECT "puzzleRating", "weaknessVersion", "lastWeaknessSeenVersion",
      "weaknessTimeClasses"::text[] AS "weaknessTimeClasses", "weaknessMonths", "ratingSeeded", "puzzleAttempts",
      CASE WHEN NOT "ratingSeeded" AND "puzzleAttempts" = 0 THEN
        (SELECT COALESCE(json_agg(json_build_object('provider', la.provider::text, 'ratings', la.ratings)
                                  ORDER BY (la.provider = 'CHESSCOM') DESC, la.id), '[]'::json)
           FROM linked_accounts la WHERE la."userId" = ${userId}) END AS "seedSources"
    FROM training_profiles WHERE "userId" = ${userId}`;
}

/**
 * Q-W3, jobs part: the member's active analyses, recompute and imports (`jobs_user_active_idx`), and the weakness
 * row itself when its last run exhausted its attempts (`jobs_dedupeKey_key`): the failed state with no pending job.
 */
export function weaknessJobsSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT kind::text AS kind, status::text AS status, count(*)::int AS n
      FROM jobs
     WHERE "userId" = ${userId} AND status IN ('QUEUED', 'RUNNING')
       AND kind IN ('ANALYZE_GAME', 'RECOMPUTE_WEAKNESS', 'IMPORT_SYNC')
     GROUP BY kind, status
    UNION ALL
    SELECT 'RECOMPUTE_WEAKNESS', CASE WHEN status = 'FAILED' THEN 'FAILED' ELSE 'PAUSED' END, 1 FROM jobs
     WHERE "dedupeKey" = ${weaknessDedupeKey(userId)}
       AND (status = 'FAILED' OR (status = 'DONE' AND result->>'skipped' = 'disabled'))`;
}

/**
 * Q-W3, game_players part: the window's human games per time class (no BOT / LEGEND_BOT mode, no imported game against
 * a BOT-titled account, §8.2; aborted games left out), in two bounded parts of one statement, both on
 * `game_players_userId_endedAt_gameId_idx` + `games_pkey`:
 *   - `s`, the scope: exactly the rows the worker's recompute reads (Q-W5, `load.ts`), the scope's time classes
 *     filtered BEFORE the limit, the newest `maxGames` (300). FIX-3 (review item 3): the plan's single "newest 1,000 of
 *     every class" read ranked the scope only inside those 1,000, so a member with 1,000 newer bullet games read
 *     "0 analysed" while the worker counted 30;
 *   - `o`, the other time classes (bullet, for the "include bullet" offer, D-P6-FIX3-W1): their newest 1,000, counts only.
 *
 * `analysed` (FIX-2, D-P6-FIX2-7) counts exactly the rows the worker's recompute counts, so the page and the snapshot
 * can never disagree about "20 analysed" (a disagreement kept the page "computing" for good): analysed (`accuracy`),
 * with usable weakness inputs (`weaknessInputsV` ≥ 1) or inputs the recompute's heal will compute (still 0, the
 * analysis finished). A row whose heal failed (−1) or whose re-analysis is running does not count, as it does not in
 * the snapshot. The progress probe (`progressEmitter.ts`) and J4 (`coverage.ts`) use the same set and predicate.
 */
export function scopeCountsSql(userId: bigint, since: Date, scopeTimeClasses: readonly string[] = ["RAPID", "BLITZ"], maxGames = 300): Prisma.Sql {
  const tcs = [...scopeTimeClasses];
  const human = Prisma.sql`gp."userId" = ${userId} AND gp."endedAt" >= ${at(since)}
             AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
             AND NOT (gp.source <> 'REPLAY' AND COALESCE(CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END, '') = 'BOT')`;
  return Prisma.sql`WITH s AS (
      SELECT gp."gameId", gp."timeClass"::text AS "timeClass", gp.accuracy, gp."weaknessInputsV" AS v
        FROM game_players gp JOIN games g ON g.id = gp."gameId"
       WHERE ${human} AND gp."timeClass"::text = ANY(${tcs}::text[])
       ORDER BY gp."endedAt" DESC, gp."gameId" DESC
       LIMIT ${maxGames}
    ), o AS (
      SELECT gp."timeClass"::text AS "timeClass"
        FROM game_players gp JOIN games g ON g.id = gp."gameId"
       WHERE ${human} AND (gp."timeClass"::text = ANY(${tcs}::text[])) IS NOT TRUE
       ORDER BY gp."endedAt" DESC, gp."gameId" DESC
       LIMIT 1000
    )
    SELECT s."timeClass", count(*)::int AS n,
        count(*) FILTER (WHERE s.accuracy IS NOT NULL
          AND (s.v >= 1 OR (${Prisma.raw(inputsHealableSql("s.v"))} AND EXISTS (SELECT 1 FROM game_analyses ga WHERE ga."gameId" = s."gameId" AND ga."completedAt" IS NOT NULL))))::int AS analysed
      FROM s GROUP BY s."timeClass"
    UNION ALL
    SELECT o."timeClass", count(*)::int, 0 FROM o GROUP BY o."timeClass"`;
}

/** The member's queued or running imports, summed over both providers (`import_runs_userId_createdAt_idx` prefix). */
export function activeImportsSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT count(*)::int AS runs, COALESCE(sum(imported), 0)::int AS imported,
      COALESCE(sum(GREATEST(seen, imported)), 0)::int AS seen, COALESCE(sum(total), 0)::int AS total,
      bool_or(total IS NULL) AS "totalUnknown", min("startedAt") AS "startedAt"
    FROM import_runs WHERE "userId" = ${userId} AND status IN ('QUEUED', 'RUNNING')`;
}

/** Q-W3b: the newest finished analysis of the window's games (the "stalled" check, only while analyses are queued). */
export function lastAnalysedSql(userId: bigint, since: Date): Prisma.Sql {
  return Prisma.sql`SELECT max(ga."completedAt") AS "lastAnalysedAt"
    FROM game_players gp JOIN game_analyses ga ON ga."gameId" = gp."gameId"
    WHERE gp."userId" = ${userId} AND gp."endedAt" >= ${at(since)}`;
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────
type SnapshotRow = {
  weekStart: string;
  algoVersion: number;
  status: string;
  gamesInScope: number;
  gamesAnalysed: number;
  metrics: unknown;
  computedAt: Date | string;
};
type ProfileRow = {
  puzzleRating: number | null;
  weaknessVersion: number;
  lastWeaknessSeenVersion: number;
  weaknessTimeClasses: string[] | null;
  weaknessMonths: number;
  ratingSeeded: boolean;
  puzzleAttempts: number;
  /** Set only for an unseeded row (see weaknessProfileSql). */
  seedSources: RatingSource[] | null;
};
type JobRow = { kind: string; status: string; n: number };
type CountRow = { timeClass: string | null; n: number; analysed: number };
type ImportRow = { runs: number; imported: number; seen: number; total: number; totalUnknown: boolean | null; startedAt: Date | string | null };

/** The jobs part read back: recompute state, the failed flag, the active analyses and imports. */
export type JobsState = {
  recompute: RecomputeState;
  lastJobFailed: boolean;
  activeAnalyzeJobs: number;
  importJobs: number;
  recomputeQueued: boolean;
  /** FIX-1: the last recompute ended DONE `skipped: "disabled"` (the worker's WEAKNESS_JOBS_ENABLED kill switch). */
  paused: boolean;
};

export function jobsStateOf(rows: readonly JobRow[]): JobsState {
  let recompute: RecomputeState = "none";
  let lastJobFailed = false;
  let activeAnalyzeJobs = 0;
  let importJobs = 0;
  let recomputeQueued = false;
  let paused = false;
  for (const r of rows) {
    const n = num(r.n);
    if (r.kind === "RECOMPUTE_WEAKNESS") {
      if (r.status === "RUNNING") recompute = "running";
      else if (r.status === "QUEUED") {
        recomputeQueued = true;
        if (recompute === "none") recompute = "queued";
      } else if (r.status === "FAILED") lastJobFailed = true;
      else if (r.status === "PAUSED") paused = true;
    } else if (r.kind === "ANALYZE_GAME") activeAnalyzeJobs += n;
    else if (r.kind === "IMPORT_SYNC") importJobs += n;
  }
  return { recompute, lastJobFailed, activeAnalyzeJobs, importJobs, recomputeQueued, paused };
}

function snapshotOf(row: SnapshotRow | undefined): PayloadSnapshot | null {
  if (!row) return null;
  if (row.status !== "READY" && row.status !== "INSUFFICIENT" && row.status !== "FAILED") return null;
  // A row an older or newer build wrote is read as "no snapshot": the page's auto-build asks for a fresh one.
  const metrics = parseWeaknessMetrics(row.metrics);
  if (!metrics) return null;
  return {
    weekStart: row.weekStart,
    algoVersion: num(row.algoVersion),
    status: row.status,
    gamesInScope: num(row.gamesInScope),
    gamesAnalysed: num(row.gamesAnalysed),
    metrics,
    computedAt: asDate(row.computedAt)!,
  };
}

function profileOf(row: ProfileRow | undefined): PayloadProfile | null {
  if (!row) return null;
  return {
    puzzleRating: row.puzzleRating === null ? null : num(row.puzzleRating),
    weaknessVersion: num(row.weaknessVersion),
    lastWeaknessSeenVersion: num(row.lastWeaknessSeenVersion),
    weaknessTimeClasses: row.weaknessTimeClasses ?? [],
    weaknessMonths: num(row.weaknessMonths),
  };
}

/**
 * The running imports as the progress block reads them (the `import_runs` rows, never an IMPORT_SYNC job alone: a
 * DAILY wake waits QUEUED for days and creates a run only when it finds new games). An unknown total (still reading)
 * stays one ahead of what was seen, so the step keeps running.
 */
export function importRunOf(row: ImportRow | undefined, now: Date): PayloadProbe["importRun"] {
  if (!row || num(row.runs) === 0) return null;
  const done = num(row.imported);
  const seen = num(row.seen);
  const total = row.totalUnknown ? Math.max(seen, done) + 1 : Math.max(num(row.total), done);
  const started = asDate(row.startedAt);
  const elapsedSec = started ? (now.getTime() - started.getTime()) / 1000 : 0;
  return { done, total, ratePerSec: done > 0 && elapsedSec > 0 ? done / elapsedSec : null };
}

// ── Environment ─────────────────────────────────────────────────────────────────────────────────────────────────
type Env = Readonly<Record<string, string | undefined>>;

/** Seconds per analysed game for the fallback ETA (`ANALYSIS_SECONDS_PER_GAME`, default 45). */
export function secondsPerGame(env: Env = process.env): number {
  const n = Number(env.ANALYSIS_SECONDS_PER_GAME);
  return Number.isFinite(n) && n > 0 ? n : 45;
}

/** Engine lanes for the fallback ETA (`ANALYSIS_LANES`, default 1). */
export function analysisLanes(env: Env = process.env): number {
  const n = Number(env.ANALYSIS_LANES);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// ── The flag (lazy, with a test seam; flags never gate authorisation) ─────────────────────────────────────────
export type WeaknessFlag = (viewer: Viewer) => Promise<boolean>;

const defaultWeaknessFlag: WeaknessFlag = async (viewer) => {
  const { getFlags } = await import("@/lib/flags");
  // Read by name: the registry entry (`lib/flags/registry/p06.ts`) decides the default per environment.
  const flags: Readonly<Partial<Record<string, boolean>>> = await getFlags(viewer);
  return flags.weakness === true;
};

let weaknessFlag: WeaknessFlag = defaultWeaknessFlag;

/** Test seam for pure unit tests (contract tests use FLAGS_OVERRIDE); returns a restore function. */
export function setWeaknessFlag(next: WeaknessFlag): () => void {
  const previous = weaknessFlag;
  weaknessFlag = next;
  return () => {
    weaknessFlag = previous;
  };
}

/** True when the `weakness` flag is on for the viewer. */
export function weaknessEnabled(viewer: Viewer): Promise<boolean> {
  return weaknessFlag(viewer);
}

/** TR-5/12/13 and TR-7 `kind:"weakness"`: 404 `not_found` while the flag is off (plan §7.8). */
export async function assertWeaknessEnabled(viewer: Viewer): Promise<void> {
  if (!(await weaknessEnabled(viewer))) throw new DataError("not_found");
}

// ── ETag ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The strong version tag (§7.1.1): `wk1:{snapshotKey}:{algoVersion}:{bankHash}:{tick}:{seenVersion}`.
 *   - `snapshotKey` = `{weekStart}.{computedAt base36}` or `none` (a new snapshot write changes it);
 *   - `bankHash` = fnv1a64 over the rows' sorted `pattern:inBank` pairs, plus the other live inputs the body shows
 *     (the puzzle rating of the week plan, the version, the zone the labels are written in);
 *   - `tick` = `0` for a settled READY profile; otherwise the probe's counters (analysed, in scope, window games,
 *     import progress, jobs state, stalled), so a poll during a build sees every step and a 304 only when nothing moved.
 * No payload hash: the tag is built from versions and counters (api-design §2.12).
 */
export function weaknessEtag(p: WeaknessPayload, live: { timeZone: string; jobs: JobsState; windowGames: number; importDone: number; importTotal: number }): string {
  const pairs = [...p.top, ...p.more].map((r) => `${r.pattern}:${r.inBank}`).sort();
  const bankHash = fnv1a64(`${pairs.join(",")}|r${p.rating ?? "-"}|v${p.version}|${live.timeZone}`);
  const settled = p.status === "ready" && p.updating === null;
  const j = live.jobs;
  const tick = settled
    ? "0"
    : [
        p.status.charAt(0),
        p.games.analysed,
        p.games.inScope,
        live.windowGames,
        live.importDone,
        live.importTotal,
        j.recompute.charAt(0),
        j.activeAnalyzeJobs,
        j.lastJobFailed ? "f" : "",
        p.progress?.stalled ? "s" : "",
        p.updating?.newGames ?? "",
      ].join(".");
  return `wk1:${p.snapshotKey ?? "none"}:${p.algoVersion}:${bankHash}:${tick}:${p.seenVersion}`;
}

// ── TR-5 ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type WeaknessRead = {
  payload: WeaknessPayload;
  etag: string;
  /** A RECOMPUTE_WEAKNESS row is QUEUED: the route runs the kick CAS (Q-W12) in `after()`. */
  kickDue: boolean;
};

/** Reads the member's weakness profile at `now` (≤ 2 round trips) and builds the payload and its tag. */
export async function readWeakness(viewer: Viewer, now: Date, deps: Pick<TrainDeps, "db"> = trainDeps(), env: Env = process.env): Promise<WeaknessRead> {
  const db: TrainDb = deps.db;
  const timeZone = timeZoneOf(viewer);
  const [snapRows, bankRows, profileRows, jobRows] = await Promise.all([
    db.$queryRaw<SnapshotRow[]>(latestSnapshotSql(viewer.id)),
    db.$queryRaw<{ theme: string; n: number }[]>(bankThemeCountsSql(viewer.id, now)),
    db.$queryRaw<ProfileRow[]>(weaknessProfileSql(viewer.id)),
    db.$queryRaw<JobRow[]>(weaknessJobsSql(viewer.id)),
  ]);
  const snapshot = snapshotOf(snapRows[0]);
  let profile = profileOf(profileRows[0]);
  // A row the worker created before any training write (its weaknessVersion bump) holds the column default, not P5's
  // seed: read the seed as every P5 reader does (profile.server.ts readProfile), so the drill's "near {rating}" is the
  // rating TR-7 draws the puzzles at (regression: weakness-rating-unseeded).
  const pr = profileRows[0];
  if (profile && pr && unseededRow({ ratingSeeded: pr.ratingSeeded, puzzleAttempts: num(pr.puzzleAttempts) })) {
    profile = { ...profile, puzzleRating: seedOf(viewer, pr.seedSources ?? []).r };
  }
  const jobs = jobsStateOf(jobRows);
  const inBank: Record<string, number> = {};
  for (const r of bankRows) inBank[r.theme] = num(r.n);

  const scope = resolveScope(profile);
  const since = scopeSince(now, timeZone, scope.months);
  // Step 2 only without a READY profile, or while analyses or a recompute are pending (§7.1.1 step 3).
  const busy = jobs.recompute !== "none" || jobs.activeAnalyzeJobs > 0;
  let probeGames: PayloadProbe["games"] = null;
  let importRun: PayloadProbe["importRun"] = null;
  let lastAnalysedAt: Date | null = null;
  let windowGames = 0;
  if (snapshot?.status !== "READY" || busy) {
    const [counts, imports, last] = await Promise.all([
      db.$queryRaw<CountRow[]>(scopeCountsSql(viewer.id, since, scope.timeClasses, scope.maxGames)),
      db.$queryRaw<ImportRow[]>(activeImportsSql(viewer.id)),
      jobs.activeAnalyzeJobs > 0 ? db.$queryRaw<{ lastAnalysedAt: Date | string | null }[]>(lastAnalysedSql(viewer.id, since)) : Promise.resolve([]),
    ]);
    probeGames = counts.map((c) => ({ timeClass: c.timeClass, n: num(c.n), analysed: num(c.analysed) }));
    windowGames = probeGames.reduce((s, g) => s + g.n, 0);
    importRun = importRunOf(imports[0], now);
    lastAnalysedAt = asDate(last[0]?.lastAnalysedAt ?? null);
  }

  const patterns = snapshot?.status === "READY" ? snapshot.metrics.rows.map((r) => r.pattern) : [];
  const lessons = await resolveLessons(patterns);
  const payload = buildPayload({
    now,
    timeZone,
    snapshot,
    profile,
    inBank,
    probe: {
      recompute: jobs.recompute,
      lastJobFailed: jobs.lastJobFailed,
      paused: jobs.paused,
      activeAnalyzeJobs: jobs.activeAnalyzeJobs,
      games: probeGames,
      importRun,
      lastAnalysedAt,
    },
    isTrialing: viewer.entitlement.state === "trial",
    secPerGame: secondsPerGame(env),
    lanes: analysisLanes(env),
    lessons,
  });
  const etag = weaknessEtag(payload, { timeZone, jobs, windowGames, importDone: importRun?.done ?? 0, importTotal: importRun?.total ?? 0 });
  return { payload, etag, kickDue: jobs.recomputeQueued };
}

/** The RSC seed (`/train/weakness`, `/train/weakness/[pattern]`): the payload TR-5 answers, at the request clock. */
export async function getWeakness(viewer: Viewer, now?: Date, deps: Pick<TrainDeps, "db"> = trainDeps()): Promise<WeaknessPayload> {
  return (await readWeakness(viewer, now ?? (await requestNow()), deps)).payload;
}

/** True when the payload has a row (shown or "more") for `pattern`: the drill route redirects otherwise. */
export function payloadHasPattern(p: WeaknessPayload, pattern: string): boolean {
  return p.top.some((r) => r.pattern === pattern) || p.more.some((r) => r.pattern === pattern);
}

// ── Q-W12: the kick CAS (TR-5's only write) ─────────────────────────────────────────────────────────────────────
/** The body of a weakness kick (`runAt` always set: two identical bodies in one second would be refused as a replay). */
export function weaknessKickBody(runAt: Date) {
  return { v: 1 as const, reason: "weakness" as const, kinds: ["RECOMPUTE_WEAKNESS" as const], runAt: runAt.toISOString() };
}

/**
 * Re-kicks the member's QUEUED recompute when it is overdue by 30 s and nobody kicked it in the last 30 s (the CAS on
 * `jobs."lastKickAt"`): however many tabs poll, at most one kick per 30 s. Returns whether this call kicked.
 */
export async function weaknessKick(userId: bigint, now: Date, db: TrainDb = trainDeps().db): Promise<{ kicked: boolean; result: KickResult | null }> {
  const won = await db.$queryRaw<{ id: bigint }[]>(weaknessKickCasSql(userId, now));
  if (won.length === 0) return { kicked: false, result: null };
  return { kicked: true, result: await kickWorker(weaknessKickBody(now)) };
}
