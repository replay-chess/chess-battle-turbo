// Backfill: queue the analysis of existing finished games (phase-03 plan §6.8, owner decision P3-Q13: on dev, the
// newest 200; prod's old games are P13).
//
//   pnpm --filter @repo/db exec tsx scripts/backfill/enqueue-analysis.ts [--since 2026-10-01] [--limit 200]   # dry run
//   pnpm --filter @repo/db exec tsx scripts/backfill/enqueue-analysis.ts --limit 200 --apply
//   … --member <email>   only that member's games
//
// Candidates: COMPLETED games with ≥ ANALYSIS_MIN_PLIES plies, analysisStatus NONE, at least one member side, moves
// stored, not a seeded fixture (`gameData.p3Seed`: the seeds own those states), newest first, at most --limit.
// `fairSeq` = the game's rank among its member's candidates (row_number() OVER (PARTITION BY the first member's
// userId ORDER BY completedAt DESC)), so equal-priority jobs interleave users (R-05.1). Priority BACKLOG.
//
// Per batch of 500, one statement: INSERT the ANALYZE_GAME jobs ON CONFLICT ("dedupeKey") DO NOTHING, set those
// games NONE → QUEUED, and bump the members' gamesVersion (their archive rows change to "queued"). A second run
// finds no NONE candidates left, so it writes nothing. After the inserts, ONE signed kick wakes the worker when
// ANALYSIS_WORKER_URL and an `opswk` key (ops → worker) in INTERNAL_API_SECRET are in the shell; without them the worker takes the
// jobs at its next drain (boot, any kick, the daily cron backstop).
import { KickBodyV1, KICK_PATH, KICK_TIMEOUT_MS } from "@repo/contracts/internal/kick";
import { OPS_TO_WORKER_KID, parseKeyRing, restrictKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { ANALYSIS_MIN_PLIES, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { Prisma } from "#generated";
import type { PrismaClient } from "#generated";
import { MAX_TARGET_USERS } from "../../prisma/seed-guards";
import { createPrismaClient } from "../../src/client";
import { SEED_MARK } from "../../seed/builders";
import {
  checkTripwire,
  isEntryPoint,
  parseFlags,
  positiveInt,
  reportFailure,
  resolveWriteTarget,
  SeedGuardError,
} from "../../seed/target";

export const BATCH = 500;
export const DEFAULT_LIMIT = 200;
export const LIMIT_MAX = 5000;

export interface Candidate {
  id: bigint;
  ref: string;
  completedAt: Date;
  userId: bigint;
}

/** Plan §6.8's fairSeq: 1-based rank of each game among its member's candidates, newest first. Pure. */
export function fairSeqs(candidates: readonly Candidate[]): number[] {
  const seen = new Map<string, number>();
  return candidates.map((c) => {
    const n = (seen.get(c.userId.toString()) ?? 0) + 1;
    seen.set(c.userId.toString(), n);
    return n;
  });
}

/** `--since yyyy-mm-dd` → the UTC midnight it names. */
export function parseSince(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new SeedGuardError(`--since must be yyyy-mm-dd (got ${raw})`);
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw new SeedGuardError(`--since ${raw} is not a date`);
  return d;
}

const ELIGIBLE = Prisma.sql`g.status = 'COMPLETED' AND g."plyCount" >= ${ANALYSIS_MIN_PLIES} AND g."analysisStatus" = 'NONE'
  AND g.moves <> '' AND (g."gameData" ->> ${SEED_MARK}) IS NULL`;

/** The newest `limit` candidates (one statement; the eligibility is re-checked at insert time). */
export async function selectCandidates(
  db: PrismaClient,
  opts: { limit: number; since: Date | null; memberId?: bigint | null },
): Promise<Candidate[]> {
  const since = opts.since ? Prisma.sql`AND g."completedAt" >= (${opts.since.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty;
  const member = opts.memberId
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM game_players m WHERE m."gameId" = g.id AND m."userId" = ${opts.memberId}::bigint)`
    : Prisma.empty;
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT g.id, g."referenceId" AS ref, (g."completedAt" AT TIME ZONE 'UTC') AS "completedAt", gp."userId"
      FROM games g
      JOIN LATERAL (SELECT "userId" FROM game_players WHERE "gameId" = g.id ORDER BY color LIMIT 1) gp ON true
     WHERE ${ELIGIBLE} AND g."completedAt" IS NOT NULL ${since} ${member}
     ORDER BY g."completedAt" DESC, g.id DESC
     LIMIT ${opts.limit}`);
}

/** One batch: jobs + NONE → QUEUED + the members' gamesVersion, in one statement. */
export function enqueueBatchSql(batch: readonly Candidate[], seqs: readonly number[]): Prisma.Sql {
  const ids = batch.map((c) => c.id.toString());
  return Prisma.sql`
    WITH v AS (SELECT * FROM unnest(${ids}::bigint[], ${`{${seqs.join(",")}}`}::int[]) AS v(game_id, fair)),
    ins AS (
      INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "gameId", payload, "runAt", "maxAttempts", "createdAt")
      SELECT 'ANALYZE_GAME', ${JOB_PRIORITY.BACKLOG}::smallint, v.fair, 'analyze:' || g.id, g.id,
             jsonb_build_object('v', 1, 'gameId', g.id::text, 'gameRef', g."referenceId", 'reason', 'backfill'),
             (now() AT TIME ZONE 'UTC'), ${JOB_MAX_ATTEMPTS.ANALYZE_GAME}::smallint, (now() AT TIME ZONE 'UTC')
        FROM v JOIN games g ON g.id = v.game_id
       WHERE ${ELIGIBLE}
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING "gameId"
    ),
    st AS (
      UPDATE games g SET "analysisStatus" = 'QUEUED', "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM ins WHERE g.id = ins."gameId" AND g."analysisStatus" = 'NONE'
      RETURNING g.id
    ),
    bump AS (
      UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
        FROM (SELECT DISTINCT gp."userId" FROM game_players gp JOIN st ON st.id = gp."gameId") m
       WHERE u.id = m."userId"
      RETURNING u.id
    )
    SELECT (SELECT count(*)::int FROM ins) AS jobs, (SELECT count(*)::int FROM st) AS games, (SELECT count(*)::int FROM bump) AS members`;
}

export interface EnqueueResult {
  candidates: Candidate[];
  jobs: number;
  games: number;
  members: number;
}

export async function runEnqueueAnalysis(
  db: PrismaClient,
  opts: { apply: boolean; limit: number; since: Date | null; memberId?: bigint | null; batch?: number; log?: (line: string) => void },
): Promise<EnqueueResult> {
  const candidates = await selectCandidates(db, opts);
  const seqs = fairSeqs(candidates);
  const out: EnqueueResult = { candidates, jobs: 0, games: 0, members: 0 };
  if (!opts.apply) return out;
  const size = opts.batch ?? BATCH;
  for (let i = 0; i < candidates.length; i += size) {
    const part = candidates.slice(i, i + size);
    const [r] = await db.$queryRaw<{ jobs: number; games: number; members: number }[]>(enqueueBatchSql(part, seqs.slice(i, i + size)));
    out.jobs += r?.jobs ?? 0;
    out.games += r?.games ?? 0;
    out.members += r?.members ?? 0;
    opts.log?.(`  batch ${i / size + 1}: ${r?.jobs ?? 0} job(s), ${r?.games ?? 0} game(s) queued`);
  }
  return out;
}

/** `--member <email>` → users.id (only that member's games), or null for every member. */
export async function memberIdOf(db: PrismaClient, email: string | undefined): Promise<bigint | null> {
  if (email === undefined) return null;
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
  if (!rows[0]) throw new SeedGuardError(`no user ${email}`);
  return rows[0].id;
}

/**
 * The single post-backfill kick, signed with ops' worker-only key `opswk` (never `ops`: the worker must not hold the key
 * the socket accepts for drain and broadcast; CT/internal/auth.ts INTERNAL_KIDS). Returns a one-line outcome; never
 * throws.
 */
export async function kickWorker(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const base = env.ANALYSIS_WORKER_URL?.trim();
  let ring;
  try {
    ring = restrictKeyRing(parseKeyRing(env.INTERNAL_API_SECRET), [OPS_TO_WORKER_KID]);
  } catch (err) {
    return `no kick: INTERNAL_API_SECRET does not parse (${(err as Error).message})`;
  }
  if (!base || !ring.signingKid) {
    return "no kick: ANALYSIS_WORKER_URL and an `opswk` key in INTERNAL_API_SECRET are not both set; the worker takes the jobs at its next drain";
  }
  const body = JSON.stringify(KickBodyV1.parse({ v: 1, reason: "backfill", kinds: ["ANALYZE_GAME"] }));
  const headers = signInternal({ keys: ring, method: "POST", path: KICK_PATH, body, nowMs: Date.now() });
  const url = new URL(KICK_PATH, base);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    return `kick → ${url.host}: HTTP ${res.status}`;
  } catch (err) {
    return `kick → ${url.host} failed (${(err as Error).name}); the worker takes the jobs at its next drain`;
  }
}

async function main() {
  const { flags, values } = parseFlags(process.argv.slice(2), {
    booleans: ["--apply"],
    values: ["--limit", "--since", "--batch", "--member"],
  });
  const apply = flags.has("--apply");
  const limit = positiveInt("--limit", values.get("--limit"), DEFAULT_LIMIT, LIMIT_MAX);
  const batch = positiveInt("--batch", values.get("--batch"), BATCH, BATCH);
  const since = parseSince(values.get("--since"));
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  console.log(`select   newest ${limit}${since ? ` completed since ${since.toISOString().slice(0, 10)}` : ""}, priority BACKLOG`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const memberId = await memberIdOf(db, values.get("--member"));
    const r = await runEnqueueAnalysis(db, { apply, limit, since, memberId, batch, log: (l) => console.log(l) });
    const users = new Set(r.candidates.map((c) => c.userId.toString())).size;
    console.log(`found    ${r.candidates.length} candidate game(s) across ${users} member(s)`);
    if (r.candidates.length > 0) {
      const first = r.candidates[0]!;
      const last = r.candidates[r.candidates.length - 1]!;
      console.log(`         newest ${first.completedAt.toISOString()}  oldest ${last.completedAt.toISOString()}`);
    }
    if (!apply) {
      console.log("\ndry run: no writes.");
      return;
    }
    console.log(`\napplied: ${r.jobs} job(s) inserted, ${r.games} game(s) NONE → QUEUED, ${r.members} member(s) bumped.`);
    if (r.jobs > 0) console.log(await kickWorker());
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/enqueue-analysis", err));
