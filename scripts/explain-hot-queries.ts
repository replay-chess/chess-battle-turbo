/**
 * Hot-query gate (phase-02 plan 9.2, data-model "CI gate", optimization §3.5.4; FIX-A: only the index-existence half
 * existed, in packages/db/test/migrations.int.test.ts).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay pnpm tsx scripts/explain-hot-queries.ts
 *
 * 1. Every index named in docs/indexes.json must exist in pg_indexes (after `prisma migrate deploy`).
 * 2. Every hot query below is EXPLAINed; the gate fails on a Seq Scan over `games` or `game_players`, or a Sort over
 *    `game_players`. A throwaway CI database is nearly empty, where Postgres rightly prefers a Seq Scan for any
 *    query, so the plans are taken with `enable_seqscan` and `enable_sort` off: a Seq Scan or a Sort that survives
 *    that has no index path at all, which is exactly the regression this gate exists for (a dropped or renamed
 *    index, a query that no longer matches its index's prefix or order).
 *
 * The queries are planned with plain EXPLAIN (never executed), so writes are safe; still, only a local or CI
 * Postgres is accepted (localhost, 127.0.0.1, ::1, or the CI service `postgres`). Never a Neon URL.
 *
 * Phase 3 adds its hot queries (A1, the ETag probe, G1 pages and counts, the worker's claim and reaper, the kick CAS,
 * the opening, share and prune lookups) from packages/db/scripts/explain-hot.ts (`P3_HOT_QUERIES`); that script also
 * measures them with EXPLAIN (ANALYZE, BUFFERS) against the perf seed.
 *
 * Exit 0 = pass; 1 = a missing index or a bad plan (printed); 2 = setup error.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@repo/db";
import { createPrismaClient } from "../packages/db/src/client";
import { restoreCandidatesSql } from "../packages/db/src/live/loadLiveGame";
import { RESTORE_WINDOW_MS } from "../packages/db/src/live/restoreList";
import { P3_HOT_QUERIES, P4_ARCHIVE_HOT_QUERIES } from "../packages/db/scripts/explain-hot";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

/** `sql` is planned as written; a `Prisma.Sql` is the production statement itself, with its bind parameters. */
type HotQuery = { name: string; sql: string | Prisma.Sql; noSeqScan: string[]; noSort: string[] };

/** The P2 hot queries (packages/db/sql/explain-p2.sql, plan 9.2), with literal placeholders for the plans. */
export const HOT_QUERIES: HotQuery[] = [
  {
    name: "session load / snapshot by ref",
    sql: `SELECT g.id, g.status, g.moves, wu.name, bu.name, t."referenceId"
            FROM games g
            LEFT JOIN users wu ON wu.id = g."whitePlayerId"
            LEFT JOIN users bu ON bu.id = g."blackPlayerId"
            LEFT JOIN tournaments t ON t.id = g."tournamentId"
           WHERE g."referenceId" = 'cxxxxxxxxxxxxxxxxxxxxxxxx'`,
    noSeqScan: ["games"],
    noSort: [],
  },
  // The socket's boot restore, one statement (loadRestoreCandidates): the journal refs (games_referenceId_key) OR the
  // live games of the window (games_open_idx). Planned with journal files and without (an empty ANY array).
  {
    name: "socket boot restore candidates, with journal refs (referenceId key + games_open_idx)",
    sql: restoreCandidatesSql(["cxxxxxxxxxxxxxxxxxxxxxxxx", "cyyyyyyyyyyyyyyyyyyyyyyyy"], RESTORE_WINDOW_MS),
    noSeqScan: ["games"],
    noSort: [],
  },
  {
    name: "socket boot restore candidates, no journal files (games_open_idx)",
    sql: restoreCandidatesSql([], RESTORE_WINDOW_MS),
    noSeqScan: ["games"],
    noSort: [],
  },
  {
    name: "stale sweep candidates (games_open_idx)",
    sql: `SELECT id, "referenceId" FROM games
           WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT')
             AND "lastMoveAt" < now() - interval '30 minutes' LIMIT 50`,
    noSeqScan: ["games"],
    noSort: [],
  },
  {
    name: "my live games (game_players userId prefix)",
    sql: `SELECT "gameId" FROM game_players WHERE "userId" = 1 AND "endedAt" IS NULL`,
    noSeqScan: ["game_players"],
    noSort: ["game_players"],
  },
  {
    name: "archive keyset page (no Sort over game_players)",
    sql: `SELECT "gameId", "endedAt" FROM game_players
           WHERE "userId" = 1 AND ("endedAt", "gameId") < (now(), 9223372036854775807)
           ORDER BY "endedAt" DESC, "gameId" DESC LIMIT 31`,
    noSeqScan: ["game_players"],
    noSort: ["game_players"],
  },
  {
    name: "participant check (game_players_pkey)",
    sql: `SELECT 1 FROM game_players WHERE "gameId" = 1 AND "userId" = 1`,
    noSeqScan: ["game_players"],
    noSort: [],
  },
  {
    name: "checkpoint (PK)",
    sql: `UPDATE games SET moves = 'e2e4', "plyCount" = 1, "lastMoveAt" = now()
           WHERE id = 1 AND status = 'IN_PROGRESS' AND "plyCount" <= 1 RETURNING "plyCount"`,
    noSeqScan: ["games"],
    noSort: [],
  },
  {
    name: "finish CTE core (PK + game_players by gameId)",
    sql: `WITH g AS (
            UPDATE games SET status = 'COMPLETED' WHERE id = 1 AND status = 'IN_PROGRESS' RETURNING id
          ), gp AS (
            UPDATE game_players p SET result = 'WIN', "endedAt" = now() FROM g WHERE p."gameId" = g.id RETURNING p."userId"
          )
          SELECT (SELECT count(*) FROM g) AS finished, (SELECT count(*) FROM gp) AS players`,
    noSeqScan: ["games", "game_players"],
    noSort: ["game_players"],
  },
];

type PlanNode = { "Node Type": string; "Relation Name"?: string; Plans?: PlanNode[] };

/** Every node of a JSON plan, with the relations its subtree scans (a Sort's input names the table it sorts). */
function walk(node: PlanNode, out: { type: string; relations: string[] }[]): string[] {
  const below = (node.Plans ?? []).flatMap((child) => walk(child, out));
  const relations = node["Relation Name"] ? [node["Relation Name"], ...below] : below;
  out.push({ type: node["Node Type"], relations });
  return relations;
}

/** The plan problems of one query (empty = fine). Exported for the unit test. */
export function planProblems(plan: PlanNode, q: Pick<HotQuery, "noSeqScan" | "noSort">): string[] {
  const nodes: { type: string; relations: string[] }[] = [];
  walk(plan, nodes);
  const problems: string[] = [];
  for (const n of nodes) {
    if (n.type === "Seq Scan" && q.noSeqScan.includes(n.relations[0] ?? "")) problems.push(`Seq Scan on ${n.relations[0]}`);
    if ((n.type === "Sort" || n.type === "Incremental Sort") && n.relations.some((r) => q.noSort.includes(r))) {
      problems.push(`${n.type} over ${n.relations.filter((r) => q.noSort.includes(r)).join(", ")}`);
    }
  }
  return problems;
}

function localUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`refusing to run against ${host}: a local or CI Postgres only`);
  return url;
}

async function main(): Promise<number> {
  let url: string;
  try {
    url = localUrl();
  } catch (err) {
    console.error(`explain-hot-queries: ${(err as Error).message}`);
    return 2;
  }
  const db = createPrismaClient({ datasourceUrl: url });
  let failed = false;
  try {
    const doc = JSON.parse(readFileSync(path.join(ROOT, "docs/indexes.json"), "utf8")) as { indexes: { name: string }[] };
    const rows = await db.$queryRawUnsafe<{ n: string }[]>(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public'`);
    const have = new Set(rows.map((r) => r.n));
    const missing = doc.indexes.map((i) => i.name).filter((n) => !have.has(n));
    for (const n of missing) console.error(`MISSING index ${n} (docs/indexes.json)`);
    if (missing.length) failed = true;
    else console.log(`indexes: ${doc.indexes.length} listed, all present`);

    for (const q of [...HOT_QUERIES, ...P3_HOT_QUERIES, ...P4_ARCHIVE_HOT_QUERIES]) {
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
        type Explained = { "QUERY PLAN": [{ Plan: PlanNode }] }[];
        const r =
          typeof q.sql === "string"
            ? await tx.$queryRawUnsafe<Explained>(`EXPLAIN (FORMAT JSON) ${q.sql}`)
            : await tx.$queryRaw<Explained>(Prisma.sql`EXPLAIN (FORMAT JSON) ${q.sql}`);
        return r[0]!["QUERY PLAN"][0].Plan;
      });
      const problems = planProblems(plan, q);
      if (problems.length) {
        failed = true;
        console.error(`FAIL ${q.name}: ${problems.join("; ")}`);
      } else console.log(`ok   ${q.name}`);
    }
  } catch (err) {
    console.error(`explain-hot-queries: ${(err as Error).message}`);
    return 2;
  } finally {
    await db.$disconnect();
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
