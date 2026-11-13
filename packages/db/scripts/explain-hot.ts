// Phase 3 hot-query plans (phase-03 plan §6.4, §9.2, §9.3, §12.7 "Query plans").
//
//   pnpm --filter @repo/db exec tsx scripts/explain-hot.ts [--email <perf member>] [--report <file.json>]
//
// Two passes per query, against the Neon dev branch or a local Postgres that holds the perf seed
// (`seed/perf-archive.ts`, the 2,000-row member):
//   1. shape: plain EXPLAIN with enable_seqscan and enable_sort off. A Seq Scan on games / game_players / jobs (or the
//      table a query names) or a Sort over game_players that survives that has no index path at all.
//   2. measure: EXPLAIN (ANALYZE, BUFFERS) with the planner's own choices, inside a transaction that is rolled back
//      (the claim, the reaper, the kick CAS and the prunes are writes). Fails on a selective Seq Scan over a listed
//      table (one that holds at least SEQSCAN_MIN_ROWS rows and keeps under a tenth of them: an index would have
//      read less), a Sort over game_players, or shared buffers above the plan's targets (A1 ≤ 30, G1 pages ≤ 200).
//      A Seq Scan that keeps most of its table (the counts of a member who owns most of a test database's games,
//      a prune that deletes most rows) is the right plan and is reported as a note. Times are reported.
// Exit 0 = pass, 1 = a plan problem (printed), 2 = setup error. `--report` writes the results as JSON (CI artifact,
// TST X18 `perf/results/p03-explain-<sha>.json`).
//
// `P3_HOT_QUERIES` (placeholder literals) is also run by the repo's index-and-plan gate
// (`scripts/explain-hot-queries.ts`, CI "Hot-query gate"), which only needs the shape pass.
import { writeFileSync } from "node:fs";
import { Prisma, type PrismaClient } from "#generated";
import { P3_JOB_KINDS, PAYLOAD_V_MAX } from "@repo/contracts/internal/jobs";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import { PERF_USER } from "../seed/perf-archive";
import { checkTripwire, isEntryPoint, parseFlags, reportFailure, resolveWriteTarget, SeedGuardError } from "../seed/target";
// The worker's queue statements themselves, not copies, so a change to the worker's SQL cannot slip past this gate
// (FIX-2). A gate script reading an app's source is the one place packages/db looks into apps/analysis-worker.
import { adoptOrClaimStatement, claimStatement } from "../../../apps/analysis-worker/src/queue/claim";
import { reapStatement } from "../../../apps/analysis-worker/src/queue/outcome";
import { queueSummaryStatement } from "../../../apps/analysis-worker/src/queue/summary";

export interface HotQuery {
  name: string;
  sql: string;
  noSeqScan: string[];
  noSort: string[];
  /** Shared buffers (hit + read) the measured plan may touch (plan §9.2, §9.3). */
  maxSharedBuffers?: number;
  /** The plan's latency target, reported (not gated: it is a server number taken from a laptop). */
  targetMs?: number;
}

export interface QueryParams {
  viewerId: string;
  ref: string;
  gameId: string;
  /** The keyset cursor of G1 page 3 (the 60th row of page 1 + 2), or null when the member has fewer rows. */
  page3: { endedAt: string; gameId: string } | null;
  epds: string[];
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const NOW = `(now() AT TIME ZONE 'UTC')`;
const HOT = ["games", "game_players", "jobs"];

/** A1 (§9.2): the review read, one statement. */
export function a1Sql(p: Pick<QueryParams, "viewerId" | "ref">): string {
  return `SELECT g.id, g."referenceId", g.mode, g.source, g."startingFen", g."startPly", g.moves, g."moveClocksMs",
       g."whitePlayerId", g."blackPlayerId", g."botElo", g.outcome, g."endMethod", g."completedAt", g."timeClass",
       g."ecoCode", g."openingName", g."initialTimeSeconds", g."incrementSeconds",
       g."analysisStatus", g."chessPositionId", g.meta->'position' AS position,
       gp.color, gp."opponentUserId", gp."opponentName", gp."opponentRating", gp."ratingBefore",
       u.name AS "youName",
       a.version, a.engine, a."totalPlies", a."gradedPlies", a."failedAtPly", a.evals, a.best, a.judgements,
       a."middlegamePly", a."endgamePly", a."accuracyWhite", a."accuracyBlack", a."countsWhite", a."countsBlack", a."depthP50",
       pr.content, pr."textStatus", pr.progress, pr."startedAt", pr."completedAt" AS "reviewCompletedAt", pr."updatedAt" AS "reviewUpdatedAt",
       opp.accuracy AS "oppAccuracy", opp."phaseAccuracy" AS "oppPhaseAccuracy",
       me.accuracy AS "myAccuracy", me."phaseAccuracy" AS "myPhaseAccuracy",
       j.status AS "jobStatus", j.attempts, j."maxAttempts", j."runAt", j."heartbeatAt", j.priority, j."lastError",
       s.code AS "shareCode", s."expiresAt" AS "shareExpiresAt", s."showUsername"
FROM games g
JOIN game_players gp        ON gp."gameId" = g.id AND gp."userId" = ${p.viewerId}
JOIN users u                ON u.id = gp."userId"
LEFT JOIN game_players opp  ON opp."gameId" = g.id AND opp.color <> gp.color
LEFT JOIN game_players me   ON me."gameId" = g.id AND me.color = gp.color
LEFT JOIN game_analyses a   ON a."gameId" = g.id
LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
LEFT JOIN jobs j            ON j."dedupeKey" = 'analyze:' || g.id
LEFT JOIN LATERAL (SELECT code, "expiresAt", "showUsername" FROM shares
                   WHERE "ownerId" = ${p.viewerId} AND kind = 'REVIEW' AND "gameId" = g.id AND "revokedAt" IS NULL AND "expiresAt" > ${NOW}
                   ORDER BY "createdAt" DESC LIMIT 1) s ON true
WHERE g."referenceId" = ${lit(p.ref)}`;
}

// player_reviews is keyed on (gameId, color): both come from `gp`, so the planner always has the two-column
// parameterised lookup. With `pr."gameId" = g.id` it could pick a path parameterised by `gp` alone (Index Cond on
// color only, gameId as a join filter: 41 rows, 19 buffers on the perf seed) whenever the table was small enough for
// the costs to tie (FIX-1; regression: p3-a1-player-reviews-key, seeds.int).

/** The A1/A2 ETag probe (§6.4). */
export function probeSql(p: Pick<QueryParams, "viewerId" | "ref">): string {
  return `SELECT g."analysisStatus", a."gradedPlies", a."totalPlies", a.version, a."failedAtPly", pr."updatedAt", j.status, j.attempts,
       j."maxAttempts", j."runAt", j."heartbeatAt", j."lastKickAt", s.code
FROM games g
JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${p.viewerId}
LEFT JOIN game_analyses a ON a."gameId" = g.id
LEFT JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
LEFT JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id
LEFT JOIN LATERAL (SELECT code FROM shares WHERE "ownerId" = ${p.viewerId} AND "gameId" = g.id AND kind = 'REVIEW'
                   AND "revokedAt" IS NULL AND "expiresAt" > ${NOW} ORDER BY "createdAt" DESC LIMIT 1) s ON true
WHERE g."referenceId" = ${lit(p.ref)}`;
}

/** G1 (§9.3): one archive page, default filters (WIN/LOSS/DRAW), keyset cursor. */
export function g1Sql(viewerId: string, cursor: QueryParams["page3"]): string {
  const keyset = cursor
    ? `AND (gp."endedAt", gp."gameId") < (${lit(cursor.endedAt)}::timestamp(3), ${cursor.gameId}::bigint)`
    : "";
  return `SELECT g."referenceId", gp.color, gp.result, gp."timeClass", gp.mode, gp."endedAt",
       gp."opponentName", gp."opponentRating", gp."opponentUserId", gp."ratingDelta",
       gp.accuracy, gp.headline, gp."momentsCount", gp."ecoCode",
       g.source, g."analysisStatus", g.fen, g."chessPositionId", g."openingName",
       g."initialTimeSeconds", g."incrementSeconds", g.meta->'position'->>'name' AS "positionTitle",
       (lc."gameId" IS NOT NULL) AS "hasComparison"
FROM game_players gp
JOIN games g ON g.id = gp."gameId"
LEFT JOIN legend_comparisons lc ON lc."gameId" = gp."gameId" AND lc."userId" = gp."userId"
WHERE gp."userId" = ${viewerId}
  AND gp.result = ANY('{WIN,LOSS,DRAW}'::"PlayerResult"[])
  ${keyset}
ORDER BY gp."endedAt" DESC, gp."gameId" DESC
LIMIT 31`;
}

/** G1 counts (page 1 and limit=0 only, AP-38), with a time-class filter as the filtered total. */
export function countsSql(viewerId: string): string {
  return `SELECT count(*) FILTER (WHERE gp."timeClass" = 'RAPID' AND gp."momentsCount" > 0) AS "filteredTotal", count(*) AS all
FROM game_players gp JOIN games g ON g.id = gp."gameId"
WHERE gp."userId" = ${viewerId} AND gp.result = ANY('{WIN,LOSS,DRAW}'::"PlayerResult"[])`;
}

/** A SQL literal for one bound value (EXPLAIN needs the statement with its values inlined). */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return lit(`{${v.map((x) => `"${String(x).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`);
  return lit(String(v));
}

/** A worker `Statement` (`$n` placeholders + values) as one SQL text with the values inlined. */
export function inlineStatement(s: { text: string; values: readonly unknown[] }): string {
  return s.text.replace(/\$(\d+)/g, (_, n: string) => sqlLiteral(s.values[Number(n) - 1]));
}

const EXPLAIN_WORKER = "dev-worker";
const EXPLAIN_ME = "dev-worker-explain0";

/** The worker's claim (§8.12; WK/src/queue/claim.ts claimStatement). */
export function claimSql(): string {
  return inlineStatement(claimStatement(EXPLAIN_ME, P3_JOB_KINDS, PAYLOAD_V_MAX));
}

/** The claim's retry form after a lost response (claim.ts adoptOrClaimStatement), with two rows already handed out. */
export function adoptOrClaimSql(): string {
  return inlineStatement(adoptOrClaimStatement(EXPLAIN_ME, P3_JOB_KINDS, PAYLOAD_V_MAX, ["1", "2"]));
}

/** The drain-end reaper (§8.12; WK/src/queue/outcome.ts reapStatement), and its retry form after a lost response. */
export function reaperSql(retry = false): string {
  const s = reapStatement({ workerId: EXPLAIN_WORKER, me: EXPLAIN_ME, drainEnd: true, token: "explain" });
  return inlineStatement(retry && typeof s.retry === "object" ? s.retry : s);
}

/** The drain-end queue summary (WK/src/queue/summary.ts). */
export function summarySql(): string {
  return inlineStatement(queueSummaryStatement(P3_JOB_KINDS, PAYLOAD_V_MAX));
}

/** The A1/A2 lost-kick heal: compare-and-set on lastKickAt (§7.3 healKick, AP-09). */
export function kickCasSql(gameId: string): string {
  return `UPDATE jobs SET "lastKickAt" = ${NOW}
WHERE "dedupeKey" = 'analyze:' || ${gameId}::bigint AND status = 'QUEUED' AND "runAt" < ${NOW} - interval '30 seconds'
  AND ("lastKickAt" IS NULL OR "lastKickAt" < ${NOW} - interval '30 seconds')
RETURNING id`;
}

/** Every P3 hot query for the given parameters. */
export function p3Queries(p: QueryParams): HotQuery[] {
  const epds = `ARRAY[${(p.epds.length ? p.epds : ["-"]).map(lit).join(", ")}]::text[]`;
  const q: HotQuery[] = [
    { name: "P3 A1 review read (§9.2)", sql: a1Sql(p), noSeqScan: [...HOT, "users", "game_analyses", "player_reviews", "shares"], noSort: [], maxSharedBuffers: 30, targetMs: 1 },
    { name: "P3 A1/A2 ETag probe (§6.4)", sql: probeSql(p), noSeqScan: [...HOT, "game_analyses", "player_reviews", "shares"], noSort: [], targetMs: 0.5 },
    { name: "P3 G1 archive page 1 (§9.3)", sql: g1Sql(p.viewerId, null), noSeqScan: [...HOT, "legend_comparisons"], noSort: ["game_players"], maxSharedBuffers: 200, targetMs: 2 },
  ];
  if (p.page3) {
    q.push({ name: "P3 G1 archive page 3 (§9.3)", sql: g1Sql(p.viewerId, p.page3), noSeqScan: [...HOT, "legend_comparisons"], noSort: ["game_players"], maxSharedBuffers: 200, targetMs: 2 });
  }
  q.push(
    { name: "P3 G1 counts (§9.3)", sql: countsSql(p.viewerId), noSeqScan: HOT, noSort: ["game_players"], targetMs: 3 },
    { name: "P3 worker claim (jobs_ready_idx)", sql: claimSql(), noSeqScan: HOT, noSort: [], targetMs: 1 },
    { name: "P3 worker claim retry: adopt or claim (jobs_running_idx, jobs_ready_idx)", sql: adoptOrClaimSql(), noSeqScan: ["jobs"], noSort: [] },
    // The reaper's OR (stale heartbeat, an earlier boot's lockedBy prefix, this boot at drain end) is answered from the
    // RUNNING partial index; its retry form adds the rows it reaped (jobs_ready_idx, jobs_finished_idx).
    { name: "P3 worker reaper (jobs_running_idx)", sql: reaperSql(), noSeqScan: ["jobs"], noSort: [] },
    { name: "P3 worker reaper retry form (jobs_running_idx, jobs_ready_idx, jobs_finished_idx)", sql: reaperSql(true), noSeqScan: ["jobs"], noSort: [] },
    { name: "P3 worker drain-end summary (jobs_ready_idx)", sql: summarySql(), noSeqScan: ["jobs"], noSort: [] },
    { name: "P3 kick CAS (jobs_dedupeKey_key)", sql: kickCasSql(p.gameId), noSeqScan: HOT, noSort: [] },
    {
      name: "P3 worker opening lookup (openings_epd_idx)",
      sql: `SELECT eco, name FROM openings WHERE epd = ANY(${epds}) AND "isActive"`,
      noSeqScan: ["openings"],
      noSort: [],
    },
    {
      name: "P3 A10 share reuse (shares_owner_idx)",
      sql: `SELECT code, "expiresAt" FROM shares WHERE "ownerId" = ${p.viewerId} AND kind = 'REVIEW' AND "gameId" = ${p.gameId}
              AND "revokedAt" IS NULL AND "expiresAt" > ${NOW} AND "showUsername" = true ORDER BY "createdAt" DESC LIMIT 1`,
      noSeqScan: ["shares"],
      noSort: [],
    },
    {
      name: "P3 A10 daily cap (shares_owner_idx)",
      sql: `SELECT count(*) FROM shares WHERE "ownerId" = ${p.viewerId} AND kind = 'REVIEW' AND "createdAt" > ${NOW} - interval '1 day'`,
      noSeqScan: ["shares"],
      noSort: [],
    },
    {
      name: "P3 HOUSEKEEPING prune-jobs (jobs_finished_idx)",
      sql: `DELETE FROM jobs WHERE status = 'DONE' AND "finishedAt" < ${NOW} - interval '14 days'`,
      noSeqScan: ["jobs"],
      noSort: [],
    },
    {
      name: "P3 HOUSEKEEPING prune-shares (shares_expires_idx)",
      sql: `DELETE FROM shares WHERE kind = 'REVIEW' AND "expiresAt" < ${NOW} - interval '7 days'`,
      noSeqScan: ["shares"],
      noSort: [],
    },
  );
  return q;
}

/** Placeholder literals for the CI shape gate (an empty database: only the plan shape matters). */
export const P3_HOT_QUERIES: HotQuery[] = p3Queries({
  viewerId: "1",
  ref: "cxxxxxxxxxxxxxxxxxxxxxxxx",
  gameId: "1",
  page3: { endedAt: "2026-11-01 00:00:00", gameId: "9223372036854775807" },
  epds: ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"],
});

// ── Plan inspection ────────────────────────────────────────────────────────────────────────────────────────────

export interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
}

interface FlatNode {
  type: string;
  relation: string | undefined;
  /** Rows the node returned over all loops (ANALYZE plans only). */
  actualRows: number | undefined;
  /** Relations scanned in this node's subtree (a Sort's input names the table it sorts). */
  below: string[];
}

function flatten(node: PlanNode, out: FlatNode[]): string[] {
  const below = (node.Plans ?? []).flatMap((c) => flatten(c, out));
  const rel = node["Relation Name"];
  const all = rel ? [rel, ...below] : below;
  const actualRows = node["Actual Rows"] === undefined ? undefined : node["Actual Rows"] * (node["Actual Loops"] ?? 1);
  out.push({ type: node["Node Type"], relation: rel, actualRows, below: all });
  return all;
}

/** Seq Scans over listed tables and Sorts over `noSort` tables. `rows` = table size (natural plans only). */
export function planIssues(
  plan: PlanNode,
  q: Pick<HotQuery, "noSeqScan" | "noSort">,
  rows?: ReadonlyMap<string, number>,
  minRows: number = SEQSCAN_MIN_ROWS,
): { problems: string[]; notes: string[] } {
  const nodes: FlatNode[] = [];
  flatten(plan, nodes);
  const problems: string[] = [];
  const notes: string[] = [];
  for (const n of nodes) {
    if (n.type === "Seq Scan" && n.relation && q.noSeqScan.includes(n.relation)) {
      const size = rows?.get(n.relation);
      if (rows && size !== undefined && size < minRows) {
        notes.push(`Seq Scan on ${n.relation} (${size} rows: the right plan at that size)`);
      } else if (rows && size !== undefined && n.actualRows !== undefined && n.actualRows * SEQSCAN_SELECTIVE >= size) {
        notes.push(`Seq Scan on ${n.relation} keeps ${n.actualRows} of ${size} rows (the right plan at that selectivity)`);
      } else {
        problems.push(`Seq Scan on ${n.relation}${size !== undefined ? ` (${size} rows${n.actualRows !== undefined ? `, kept ${n.actualRows}` : ""})` : ""}`);
      }
    }
    if ((n.type === "Sort" || n.type === "Incremental Sort") && n.below.some((r) => q.noSort.includes(r))) {
      problems.push(`${n.type} over ${n.below.filter((r) => q.noSort.includes(r)).join(", ")}`);
    }
  }
  return { problems, notes };
}

/** A natural-plan Seq Scan on a table smaller than this is reported, not failed. */
export const SEQSCAN_MIN_ROWS = 1000;
/** …and so is one that keeps at least 1/SEQSCAN_SELECTIVE of its table. */
export const SEQSCAN_SELECTIVE = 10;

export interface QueryReport {
  name: string;
  shape: { ok: boolean; problems: string[] };
  measured: {
    ok: boolean;
    problems: string[];
    notes: string[];
    executionMs: number;
    sharedHit: number;
    sharedRead: number;
    maxSharedBuffers: number | null;
    targetMs: number | null;
  } | null;
}

class Rollback extends Error {}

async function explain(db: PrismaClient, sql: string, mode: "shape" | "measure"): Promise<{ plan: PlanNode; executionMs: number }> {
  let out: { plan: PlanNode; executionMs: number } | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
        if (mode === "shape") {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
        }
        const prefix = mode === "shape" ? "EXPLAIN (FORMAT JSON)" : "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)";
        const r = await tx.$queryRawUnsafe<{ "QUERY PLAN": [{ Plan: PlanNode; "Execution Time"?: number }] }[]>(`${prefix} ${sql}`);
        const doc = r[0]!["QUERY PLAN"][0];
        out = { plan: doc.Plan, executionMs: doc["Execution Time"] ?? 0 };
        throw new Rollback("rollback");
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  if (!out) throw new Error("explain: no plan");
  return out;
}

/** Each node's own shared buffers (its total minus its children's), for the failure message. */
export function bufferBreakdown(plan: PlanNode): string {
  const out: string[] = [];
  const walk = (n: PlanNode, depth: number) => {
    const total = (n["Shared Hit Blocks"] ?? 0) + (n["Shared Read Blocks"] ?? 0);
    const kids = (n.Plans ?? []).reduce((sum, c) => sum + (c["Shared Hit Blocks"] ?? 0) + (c["Shared Read Blocks"] ?? 0), 0);
    out.push(`${"·".repeat(depth)}${n["Node Type"]}${n["Index Name"] ? ` ${n["Index Name"]}` : n["Relation Name"] ? ` ${n["Relation Name"]}` : ""}=${total - kids}`);
    for (const c of n.Plans ?? []) walk(c, depth + 1);
  };
  walk(plan, 0);
  return out.join(", ");
}

/** Runs both passes for every query. The measure pass runs each query twice and keeps the second (warm) run. */
export async function runExplain(db: PrismaClient, queries: readonly HotQuery[], opts: { measure: boolean }): Promise<QueryReport[]> {
  const sizes = await db.$queryRaw<{ t: string; n: number }[]>(Prisma.sql`
    SELECT relname AS t, GREATEST(reltuples, 0)::float8 AS n FROM pg_class
     WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`);
  const rows = new Map(sizes.map((s) => [s.t, Number(s.n)]));
  const reports: QueryReport[] = [];
  for (const q of queries) {
    const shape = planIssues((await explain(db, q.sql, "shape")).plan, q);
    const report: QueryReport = { name: q.name, shape: { ok: shape.problems.length === 0, problems: shape.problems }, measured: null };
    if (opts.measure) {
      await explain(db, q.sql, "measure");
      const m = await explain(db, q.sql, "measure");
      const issues = planIssues(m.plan, q, rows);
      const hit = m.plan["Shared Hit Blocks"] ?? 0;
      const read = m.plan["Shared Read Blocks"] ?? 0;
      if (q.maxSharedBuffers !== undefined && hit + read > q.maxSharedBuffers) {
        issues.problems.push(`${hit + read} shared buffers > ${q.maxSharedBuffers} (${bufferBreakdown(m.plan)})`);
      }
      report.measured = {
        ok: issues.problems.length === 0,
        problems: issues.problems,
        notes: issues.notes,
        executionMs: Math.round(m.executionMs * 1000) / 1000,
        sharedHit: hit,
        sharedRead: read,
        maxSharedBuffers: q.maxSharedBuffers ?? null,
        targetMs: q.targetMs ?? null,
      };
    }
    reports.push(report);
  }
  return reports;
}

/** The perf member's parameters: a DONE game for A1, the G1 page-3 cursor, the opening EPDs of that game. */
export async function perfParams(db: PrismaClient, email: string): Promise<QueryParams> {
  const users = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
  const viewer = users[0];
  if (!viewer) throw new SeedGuardError(`no user ${email}: run seed/perf-archive.ts --apply first`);
  const games = await db.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`
    SELECT g.id, g."referenceId" AS ref FROM game_players gp JOIN games g ON g.id = gp."gameId"
     WHERE gp."userId" = ${viewer.id} AND g."analysisStatus" = 'DONE'
     ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 1`);
  const game = games[0];
  if (!game) throw new SeedGuardError(`${email} has no analysed game: run seed/perf-archive.ts --apply first`);
  const page = await db.$queryRaw<{ endedAt: string; gameId: bigint }[]>(Prisma.sql`
    SELECT to_char(gp."endedAt", 'YYYY-MM-DD HH24:MI:SS.MS') AS "endedAt", gp."gameId" FROM game_players gp
     WHERE gp."userId" = ${viewer.id} AND gp.result = ANY('{WIN,LOSS,DRAW}'::"PlayerResult"[])
     ORDER BY gp."endedAt" DESC, gp."gameId" DESC OFFSET 59 LIMIT 1`);
  const cursor = page[0];
  const epds = await db.$queryRaw<{ epd: string }[]>(Prisma.sql`SELECT epd FROM openings WHERE epd IS NOT NULL ORDER BY id LIMIT 30`);
  return {
    viewerId: viewer.id.toString(),
    ref: game.ref,
    gameId: game.id.toString(),
    page3: cursor ? { endedAt: cursor.endedAt, gameId: cursor.gameId.toString() } : null,
    epds: epds.map((e) => e.epd),
  };
}

export function printReports(reports: readonly QueryReport[]): boolean {
  let ok = true;
  for (const r of reports) {
    const m = r.measured;
    const pass = r.shape.ok && (m?.ok ?? true);
    ok &&= pass;
    const stats = m ? `  ${m.executionMs} ms (target ${m.targetMs ?? "-"}), buffers ${m.sharedHit + m.sharedRead}${m.maxSharedBuffers !== null ? `/${m.maxSharedBuffers}` : ""}` : "";
    console.log(`${pass ? "ok  " : "FAIL"} ${r.name}${stats}`);
    for (const p of [...r.shape.problems.map((x) => `shape: ${x}`), ...(m?.problems ?? [])]) console.log(`       ${p}`);
    for (const n of m?.notes ?? []) console.log(`       note: ${n}`);
  }
  return ok;
}

async function main(): Promise<number> {
  const { values } = parseFlags(process.argv.slice(2), { booleans: [], values: ["--email", "--report"] });
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const email = values.get("--email") ?? PERF_USER.email;
    const params = await perfParams(db, email);
    const reports = await runExplain(db, p3Queries(params), { measure: true });
    const ok = printReports(reports);
    const report = values.get("--report");
    if (report) {
      writeFileSync(report, `${JSON.stringify({ target: target.kind, at: new Date().toISOString(), ok, reports }, null, 2)}\n`);
      console.log(`report   ${report}`);
    }
    return ok ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      reportFailure("explain-hot", err);
      process.exit(2);
    },
  );
}
