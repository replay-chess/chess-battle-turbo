// Database side of the Phase 3 dev seeds (phase-03 plan §6.9): reads what a previous run left, decides per fixture
// (insert / update / unchanged), and writes whole fixtures in set-based statements.
//
// A fixture is written as a unit: its ANALYZE_GAME / LEGEND_COMPARE jobs (no FK) and its game row are deleted (the
// FKs cascade to game_players, game_analyses, player_reviews, legend_comparisons and shares), then one data-modifying
// CTE inserts every row of up to FIXTURE_CHUNK fixtures, and the members' `gamesVersion` is bumped so archive and
// review ETags change. All inside one transaction per chunk. Raw SQL with explicit casts, `timestamp(3)` values
// written as UTC (`$iso::timestamptz AT TIME ZONE 'UTC'`, the P1 convention), so the session TimeZone never matters.
//
// A re-run that finds a fixture with the same content hash and the expected state writes nothing for it.
import { Prisma, type PrismaClient } from "#generated";
import type { SqlClient } from "../src/live/types";
import {
  SEED_HASH_KEY,
  seededRef,
  shareInSeededState,
  type SeedFixture,
  type SeedMember,
  type SeedShareKind,
  type ShareRow,
} from "./builders";
import { SeedGuardError } from "./target";

/** Fixtures per write statement (≈ 110 bind parameters each; Postgres allows 65,535 per statement). */
export const FIXTURE_CHUNK = 100;

export function ts(d: Date | null): Prisma.Sql {
  return d ? Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`NULL::timestamp(3)`;
}

const json = (v: unknown) => Prisma.sql`${JSON.stringify(v)}::jsonb`;

/**
 * A numeric array as a Postgres array literal ("{1,2,-3}"), bound as text and cast in SQL: the driver never has to
 * guess an element type (an empty array, or reals that happen to be whole numbers).
 */
export function pgArray(values: readonly number[]): string {
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError(`pgArray: ${v} is not a finite number`);
  return `{${values.join(",")}}`;
}

// ── State of a previous run ────────────────────────────────────────────────────────────────────────────────────

export interface StoredFixture {
  ref: string;
  hash: string | null;
  analysisStatus: string;
  jobStatus: string | null;
  jobAttempts: number | null;
  hasAnalysis: boolean;
  reviews: number;
  legend: { userId: string; status: string }[];
}

export async function readFixtureStates(db: SqlClient, refs: readonly string[]): Promise<Map<string, StoredFixture>> {
  const out = new Map<string, StoredFixture>();
  for (let i = 0; i < refs.length; i += 1000) {
    const part = refs.slice(i, i + 1000);
    const rows = await db.$queryRaw<StoredFixture[]>(Prisma.sql`
      SELECT g."referenceId" AS ref, g."gameData"->>${SEED_HASH_KEY} AS hash, g."analysisStatus"::text AS "analysisStatus",
             j.status::text AS "jobStatus", j.attempts::int AS "jobAttempts",
             EXISTS (SELECT 1 FROM game_analyses a WHERE a."gameId" = g.id) AS "hasAnalysis",
             (SELECT count(*)::int FROM player_reviews pr WHERE pr."gameId" = g.id) AS reviews,
             COALESCE((SELECT json_agg(json_build_object('userId', lc."userId"::text, 'status', lc.status::text) ORDER BY lc."userId")
                         FROM legend_comparisons lc WHERE lc."gameId" = g.id), '[]'::json) AS legend
        FROM games g
        LEFT JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id
       WHERE g."referenceId" = ANY(${part}::text[])`);
    for (const r of rows) out.set(r.ref, r);
  }
  return out;
}

export type FixtureAction = { action: "insert" } | { action: "update"; reason: string } | { action: "unchanged" };

/** What a run does with one fixture, given what it found. Pure. */
export function fixtureAction(f: SeedFixture, stored: StoredFixture | undefined, opts: { loose?: boolean } = {}): FixtureAction {
  if (!stored) return { action: "insert" };
  if (stored.hash !== f.hash) return { action: "update", reason: stored.hash ? "definition changed" : "not a seeded row" };
  if (opts.loose) return { action: "unchanged" };
  const e = f.expect;
  if (stored.analysisStatus !== e.analysisStatus) return { action: "update", reason: `analysisStatus ${stored.analysisStatus}` };
  if (e.job === null && stored.jobStatus !== null) return { action: "update", reason: `job ${stored.jobStatus}` };
  if (e.job === "doneOrPruned" && stored.jobStatus !== null && stored.jobStatus !== "DONE") {
    return { action: "update", reason: `job ${stored.jobStatus}` };
  }
  if (e.job !== null && e.job !== "doneOrPruned" && (stored.jobStatus !== e.job.status || stored.jobAttempts !== e.job.attempts)) {
    return { action: "update", reason: `job ${stored.jobStatus ?? "missing"}/${stored.jobAttempts ?? "-"}` };
  }
  if (stored.hasAnalysis !== e.analysis) return { action: "update", reason: stored.hasAnalysis ? "unexpected analysis" : "analysis missing" };
  if (stored.reviews !== e.reviews) return { action: "update", reason: `${stored.reviews} reviews` };
  const want = e.legend.map((l) => ({ userId: l.userId.toString(), status: l.status }));
  if (JSON.stringify(stored.legend) !== JSON.stringify(want)) return { action: "update", reason: "legend comparison state" };
  return { action: "unchanged" };
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────────────────

function gameValues(f: SeedFixture): Prisma.Sql {
  const g = f.game;
  const creatorIsWhite = g.whitePlayerId === g.creatorId;
  const secs = (ms: number | null) => (ms === null ? g.initialTimeSeconds : Math.floor(ms / 1000));
  const creatorLeft = secs(creatorIsWhite ? g.whiteTimeMs : g.blackTimeMs);
  const opponentLeft = secs(creatorIsWhite ? g.blackTimeMs : g.whiteTimeMs);
  return Prisma.sql`(${g.ref}, ${g.creatorId}::bigint, ${g.opponentId}::bigint, 'COMPLETED'::"GameStatus", ${g.mode}::"GameMode", false,
    ${g.timeClass}::"TimeClass", ${g.botElo}::smallint, ${g.whitePlayerId}::bigint, ${g.blackPlayerId}::bigint,
    ${g.startingFen}, ${g.startPly}::smallint, ${g.studySeconds}::smallint, ${g.fen}, ${g.moves}, ${pgArray(g.moveClocksMs)}::int[],
    ${g.plyCount}::smallint, ${g.initialTimeSeconds}::int, ${g.incrementSeconds}::int, ${creatorLeft}::int, ${opponentLeft}::int,
    ${g.whiteTimeMs}::int, ${g.blackTimeMs}::int, 'ENDED'::"LivePhase", ${g.endMethod}::"GameEndMethod", ${g.outcome}::"GameWinner",
    ${g.result}::"GameResult", ${g.winnerId}::bigint, ${g.pgn}, ${g.chessPositionId}::bigint, ${json(g.meta)}, ${json(g.gameData)},
    ${g.whiteName}::varchar(40), ${g.blackName}::varchar(40), ${g.whiteRating}::smallint, ${g.blackRating}::smallint,
    'REPLAY'::"GameSource", ${g.analysisStatus}::"AnalysisStatus", ${g.ecoCode}::varchar(3), ${g.openingName}::varchar(80),
    ${ts(g.createdAt)}, ${ts(g.completedAt)}, ${ts(g.startedAt)}, ${ts(g.completedAt)}, ${ts(g.completedAt)}, ${ts(g.expiresAt)})`;
}

/** One data-modifying CTE that inserts every row of `fixtures` (none of whose refs may exist). */
export function insertFixturesSql(fixtures: readonly SeedFixture[]): Prisma.Sql {
  if (fixtures.length === 0) throw new Error("insertFixturesSql: no fixtures");
  const ctes: Prisma.Sql[] = [
    Prisma.sql`g AS (
      INSERT INTO games ("referenceId", "creatorId", "opponentId", status, mode, rated, "timeClass", "botElo", "whitePlayerId",
        "blackPlayerId", "startingFen", "startPly", "studySeconds", fen, moves, "moveClocksMs", "plyCount", "initialTimeSeconds",
        "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining", "whiteTimeMs", "blackTimeMs", phase, "endMethod", outcome,
        result, "winnerId", pgn, "chessPositionId", meta, "gameData", "whiteName", "blackName", "whiteRating", "blackRating", source,
        "analysisStatus", "ecoCode", "openingName", "createdAt", "updatedAt", "startedAt", "lastMoveAt", "completedAt", "expiresAt")
      VALUES ${Prisma.join(fixtures.map(gameValues), ",\n")}
      RETURNING id, "referenceId" AS ref, "completedAt", "chessPositionId", "timeClass", mode
    )`,
  ];

  const players = fixtures.flatMap((f) =>
    f.players.map(
      (p) => Prisma.sql`(${f.game.ref}, ${p.userId}::bigint, ${p.color}::char(1), ${p.result}::"PlayerResult", ${p.opponentUserId}::bigint,
        ${p.opponentName}::varchar(40), ${p.opponentRating}::smallint, ${p.ratingBefore}::smallint, ${p.accuracy}::real,
        ${p.headline}::varchar(80), ${p.momentsCount}::smallint, ${pgArray(p.counts)}::smallint[], ${pgArray(p.phaseAccuracy)}::real[], ${p.ecoCode}::varchar(3))`,
    ),
  );
  ctes.push(Prisma.sql`gp AS (
      INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, result, "endedAt", "opponentUserId", "opponentName",
        "opponentRating", "ratingBefore", source, accuracy, headline, "momentsCount", counts, "phaseAccuracy", "ecoCode", "createdAt", "updatedAt")
      SELECT g.id, v.uid, v.color, g.mode, g."timeClass", false, v.result, g."completedAt", v.opp, v.opp_name, v.opp_rating, v.rating_before,
             'REPLAY', v.accuracy, v.headline, v.moments, v.counts, v.phase, v.eco, g."completedAt", g."completedAt"
        FROM (VALUES ${Prisma.join(players, ",\n")}) AS v(ref, uid, color, result, opp, opp_name, opp_rating, rating_before, accuracy,
             headline, moments, counts, phase, eco)
        JOIN g ON g.ref = v.ref
      RETURNING 1
    )`);

  const analyses = fixtures.filter((f) => f.analysis).map((f) => {
    const a = f.analysis!;
    return Prisma.sql`(${f.game.ref}, ${a.version}::smallint, ${a.engine}::varchar(48), ${a.nodesPass1}::int, ${a.nodesPass2}::int,
      ${a.evalSource}::"EvalSource", ${a.totalPlies}::smallint, ${a.gradedPlies}::smallint, ${a.failedAtPly}::smallint,
      ${pgArray(a.evals)}::smallint[], ${pgArray(a.second)}::smallint[], ${pgArray(a.best)}::smallint[], ${pgArray(a.judgements)}::smallint[],
      ${a.lines === null ? null : JSON.stringify(a.lines)}::jsonb, ${a.middlegamePly}::smallint, ${a.endgamePly}::smallint,
      ${a.accuracyWhite}::real, ${a.accuracyBlack}::real, ${pgArray(a.countsWhite)}::smallint[], ${pgArray(a.countsBlack)}::smallint[], ${ts(a.completedAt)})`;
  });
  if (analyses.length > 0) {
    ctes.push(Prisma.sql`a AS (
      INSERT INTO game_analyses ("gameId", version, engine, "nodesPass1", "nodesPass2", "evalSource", "totalPlies", "gradedPlies",
        "failedAtPly", evals, second, best, judgements, lines, "middlegamePly", "endgamePly", "accuracyWhite", "accuracyBlack",
        "countsWhite", "countsBlack", "depthP50", "readyMs", "createdAt", "updatedAt", "completedAt")
      SELECT g.id, v.version, v.engine, v.n1, v.n2, v.src, v.total, v.graded, v.failed, v.evals, v.second, v.best, v.judgements, v.lines,
             v.mid, v.endg, v.acc_w, v.acc_b, v.counts_w, v.counts_b, NULL, NULL, g."completedAt", COALESCE(v.done, g."completedAt"), v.done
        FROM (VALUES ${Prisma.join(analyses, ",\n")}) AS v(ref, version, engine, n1, n2, src, total, graded, failed, evals, second, best,
             judgements, lines, mid, endg, acc_w, acc_b, counts_w, counts_b, done)
        JOIN g ON g.ref = v.ref
      RETURNING 1
    )`);
  }

  const reviews = fixtures.flatMap((f) =>
    f.reviews.map((r) => Prisma.sql`(${f.game.ref}, ${r.color}::char(1), ${JSON.stringify(r.content)}::jsonb)`),
  );
  if (reviews.length > 0) {
    // player_reviews → game_players (gameId, color): the FK is checked at the end of the statement, after gp.
    ctes.push(Prisma.sql`pr AS (
      INSERT INTO player_reviews ("gameId", color, content, "textStatus", progress, "createdAt", "updatedAt")
      SELECT g.id, v.color, v.content, 'TEMPLATE', NULL, g."completedAt", g."completedAt"
        FROM (VALUES ${Prisma.join(reviews, ",\n")}) AS v(ref, color, content)
        JOIN g ON g.ref = v.ref
      RETURNING 1
    )`);
  }

  const jobs = fixtures.filter((f) => f.job).map((f) => {
    const j = f.job!;
    return Prisma.sql`(${f.game.ref}, ${j.status}::"JobStatus", ${j.priority}::smallint, ${j.reason}, ${j.attempts}::smallint,
      ${j.maxAttempts}::smallint, ${j.lastError}::varchar(1000), ${ts(j.createdAt)}, ${ts(j.startedAt)}, ${ts(j.finishedAt)})`;
  });
  if (jobs.length > 0) {
    ctes.push(Prisma.sql`j AS (
      INSERT INTO jobs (kind, status, priority, "fairSeq", "dedupeKey", "gameId", payload, "runAt", attempts, "maxAttempts", "lastError",
        "createdAt", "startedAt", "finishedAt")
      SELECT 'ANALYZE_GAME', v.status, v.priority, 0, 'analyze:' || g.id, g.id,
             jsonb_build_object('v', 1, 'gameId', g.id::text, 'gameRef', g.ref, 'reason', v.reason), v.created, v.attempts, v.max_attempts,
             v.last_error, v.created, v.started, v.finished
        FROM (VALUES ${Prisma.join(jobs, ",\n")}) AS v(ref, status, priority, reason, attempts, max_attempts, last_error, created, started, finished)
        JOIN g ON g.ref = v.ref
      RETURNING 1
    )`);
  }

  const legend = fixtures.flatMap((f) =>
    f.legend.map((l) => Prisma.sql`(${f.game.ref}, ${l.userId}::bigint, ${l.status}::"ComparisonStatus", ${JSON.stringify(l.facts)}::jsonb)`),
  );
  if (legend.length > 0) {
    ctes.push(Prisma.sql`lc AS (
      INSERT INTO legend_comparisons ("gameId", "userId", "chessPositionId", status, facts, attempts, "createdAt", "updatedAt")
      SELECT g.id, v.uid, g."chessPositionId", v.status, v.facts, 0, g."completedAt", g."completedAt"
        FROM (VALUES ${Prisma.join(legend, ",\n")}) AS v(ref, uid, status, facts)
        JOIN g ON g.ref = v.ref
      RETURNING 1
    )`);
  }

  return Prisma.sql`WITH ${Prisma.join(ctes, ",\n")}
    SELECT (SELECT count(*)::int FROM g) AS games, (SELECT count(*)::int FROM gp) AS players`;
}

/** Deletes the given games and their jobs (the analysis job and any legend job; jobs have no FK). */
export function deleteGamesSql(refs: readonly string[]): Prisma.Sql[] {
  return [
    Prisma.sql`DELETE FROM jobs j USING games g
                WHERE g."referenceId" = ANY(${refs}::text[])
                  AND (j."dedupeKey" = 'analyze:' || g.id OR j."dedupeKey" LIKE 'legend:' || g.id || ':%')`,
    Prisma.sql`DELETE FROM games WHERE "referenceId" = ANY(${refs}::text[])`,
  ];
}

export function bumpGamesVersionSql(userIds: readonly bigint[]): Prisma.Sql {
  const ids = [...new Set(userIds.map(String))];
  return Prisma.sql`UPDATE users SET "gamesVersion" = "gamesVersion" + 1 WHERE id = ANY(${ids}::bigint[])`;
}

/** Writes fixtures (replacing any earlier version of each), FIXTURE_CHUNK per transaction. Returns games written. */
export async function writeFixtures(
  db: PrismaClient,
  fixtures: readonly SeedFixture[],
  opts: { chunk?: number; log?: (line: string) => void } = {},
): Promise<number> {
  const chunk = opts.chunk ?? FIXTURE_CHUNK;
  let written = 0;
  for (let i = 0; i < fixtures.length; i += chunk) {
    const part = fixtures.slice(i, i + chunk);
    const refs = part.map((f) => f.game.ref);
    const results = await db.$transaction([
      ...deleteGamesSql(refs).map((s) => db.$executeRaw(s)),
      db.$queryRaw<{ games: number; players: number }[]>(insertFixturesSql(part)),
      db.$executeRaw(bumpGamesVersionSql(part.flatMap((f) => f.members))),
    ]);
    const inserted = results[2] as { games: number; players: number }[];
    const n = inserted[0]?.games ?? 0;
    if (n !== part.length) throw new Error(`writeFixtures: expected ${part.length} games, wrote ${n}`);
    written += n;
    opts.log?.(`  wrote ${written}/${fixtures.length}`);
  }
  return written;
}

// ── Members ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SeedUserSpec {
  email: string;
  code: string;
  googleId: string;
  name: string;
  /** The displayed rating the seed uses for this member's games. */
  rating: number | null;
}

/** A member by email (rating: the linked Chess.com blitz rating, else `fallbackRating`), or null. */
export async function memberByEmail(db: SqlClient, email: string, fallbackRating: number | null): Promise<SeedMember | null> {
  const rows = await db.$queryRaw<{ id: bigint; ref: string; name: string; rating: number | null }[]>(Prisma.sql`
    SELECT u.id, u."referenceId" AS ref, u.name, c."blitzRating" AS rating
      FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id
     WHERE u.email = ${email} LIMIT 1`);
  const u = rows[0];
  return u ? { id: u.id, ref: u.ref, name: u.name.slice(0, 40), rating: u.rating ?? fallbackRating } : null;
}

/**
 * A synthetic member (an opponent, the smoke or perf user): created when missing, with its legacy user_stats row.
 * These accounts have no Clerk identity and can never sign in. Returns null in a dry run when it does not exist.
 */
export async function ensureSeedUser(db: SqlClient, spec: SeedUserSpec, apply: boolean): Promise<{ member: SeedMember | null; created: boolean }> {
  const existing = await memberByEmail(db, spec.email, spec.rating);
  if (existing) return { member: { ...existing, rating: spec.rating }, created: false };
  if (!apply) return { member: null, created: true };
  const ref = seededRef("user", spec.email);
  await db.$executeRaw(Prisma.sql`
    WITH u AS (
      INSERT INTO users ("referenceId", code, "googleId", email, name, "isActive", onboarded, "createdAt", "updatedAt")
      VALUES (${ref}, ${spec.code}, ${spec.googleId}, ${spec.email}, ${spec.name}, true, true,
              (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    )
    INSERT INTO user_stats ("referenceId", "userId", "updatedAt")
    SELECT ${seededRef("user-stats", spec.email)}, u.id, (now() AT TIME ZONE 'UTC') FROM u
    ON CONFLICT ("userId") DO NOTHING`);
  const member = await memberByEmail(db, spec.email, spec.rating);
  if (!member) throw new SeedGuardError(`could not create the seed user ${spec.email}`);
  return { member: { ...member, rating: spec.rating }, created: true };
}

/** A placeholder member for a dry run (the user does not exist yet; its fixtures are reported as inserts). */
export function placeholderMember(spec: SeedUserSpec): SeedMember {
  return { id: -1n, ref: seededRef("user", spec.email), name: spec.name, rating: spec.rating };
}

// ── Shares ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function readShares(db: SqlClient, codes: readonly string[]) {
  const rows = await db.$queryRaw<{ code: string; expiresAt: Date | null; revokedAt: Date | null }[]>(Prisma.sql`
    SELECT code, ("expiresAt" AT TIME ZONE 'UTC') AS "expiresAt", ("revokedAt" AT TIME ZONE 'UTC') AS "revokedAt"
      FROM shares WHERE code = ANY(${codes}::text[])`);
  return new Map(rows.map((r) => [r.code, r]));
}

/** Shares whose stored row is missing or no longer in its seeded state. */
export function sharesToWrite<S extends ShareRow & { kind: SeedShareKind }>(
  shares: readonly S[],
  stored: Map<string, { expiresAt: Date | null; revokedAt: Date | null }>,
  now: Date,
): S[] {
  return shares.filter((s) => !shareInSeededState(s.kind, stored.get(s.code), now));
}

export async function writeShares(db: SqlClient, shares: readonly ShareRow[]): Promise<number> {
  let n = 0;
  for (const s of shares) {
    n += await db.$executeRaw(Prisma.sql`
      INSERT INTO shares (code, kind, "ownerId", "gameId", ply, color, themes, "showUsername", snapshot, "imageVersion", "expiresAt",
                          "revokedAt", "createdAt")
      SELECT ${s.code}, 'REVIEW', ${s.ownerId}::bigint, g.id, ${s.ply}::smallint, ${s.color}::char(1), '{}'::text[], ${s.showUsername},
             ${JSON.stringify(s.snapshot)}::jsonb, 1, ${ts(s.expiresAt)}, ${ts(s.revokedAt)}, ${ts(s.createdAt)}
        FROM games g WHERE g."referenceId" = ${s.gameRef}
      ON CONFLICT (code) DO UPDATE SET "ownerId" = EXCLUDED."ownerId", "gameId" = EXCLUDED."gameId", ply = EXCLUDED.ply,
        color = EXCLUDED.color, "showUsername" = EXCLUDED."showUsername", snapshot = EXCLUDED.snapshot,
        "imageVersion" = shares."imageVersion" + 1, "expiresAt" = EXCLUDED."expiresAt", "revokedAt" = EXCLUDED."revokedAt",
        "createdAt" = EXCLUDED."createdAt"`);
  }
  return n;
}

// ── Persona helpers (for scripts/dev/personas.ts, WP-H) ────────────────────────────────────────────────────────

/** Shared e2e letters A–R are never cleared (they only gain data); pool users and S are. */
export const SHARED_LETTER_EMAIL = /^e2e-player[a-r]\+/i;

/**
 * Deletes every game the member played (the `review-empty` persona: /games shows `empty`), with their jobs, and
 * bumps the gamesVersion of everyone who was in them. Refuses the shared e2e letters A–R.
 */
export async function clearMemberGames(db: PrismaClient, email: string): Promise<number> {
  if (SHARED_LETTER_EMAIL.test(email)) throw new SeedGuardError(`refusing to clear ${email}: a shared e2e user only gains data`);
  const rows = await db.$queryRaw<{ ref: string; members: bigint[] }[]>(Prisma.sql`
    SELECT g."referenceId" AS ref, ARRAY(SELECT gp2."userId" FROM game_players gp2 WHERE gp2."gameId" = g.id) AS members
      FROM games g JOIN game_players gp ON gp."gameId" = g.id JOIN users u ON u.id = gp."userId"
     WHERE u.email = ${email}`);
  if (rows.length === 0) return 0;
  const refs = rows.map((r) => r.ref);
  await db.$transaction([
    ...deleteGamesSql(refs).map((s) => db.$executeRaw(s)),
    db.$executeRaw(bumpGamesVersionSql(rows.flatMap((r) => r.members))),
  ]);
  return refs.length;
}

/** Clears the walkthrough state of the given fixtures' reviews (progress, started/completed) for a fresh run. */
export async function resetReviewProgress(db: SqlClient, refs: readonly string[]): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE player_reviews pr SET progress = NULL, "startedAt" = NULL, "completedAt" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM games g
     WHERE pr."gameId" = g.id AND g."referenceId" = ANY(${refs}::text[])
       AND (pr.progress IS NOT NULL OR pr."startedAt" IS NOT NULL OR pr."completedAt" IS NOT NULL)`);
}
