// Phase 4 hot-query plans (phase-04 plan §9.2, §12.7 "Query plans"; WP-C / WP-G requests to the explain gate): the web's
// own P4 statements, exactly as the routes send them, must have an index path. Same shape pass as P3's
// packages/db/scripts/explain-hot.ts (`enable_seqscan` / `enable_sort` off, plain EXPLAIN, rolled back): a Seq Scan or a
// Sort that survives that has no index at all (a dropped index, a query that lost its index prefix).
//
//   GET /api/me            VIEWER_SQL: LATERALs on linked_accounts_userId_provider_key / import_runs_userId_createdAt_idx
//   ACC-1, ACC-3, ACC-6    linkedAccountsSql (all, one provider); verifiedElsewhereSql (linked_accounts_verified_key)
//   ACC-7                  importStatusSql; healImportKickSql (jobs_dedupeKey_key)
//   fan-out (8.5.4)        releaseWaitingImportsSql (import_runs_waiting_idx)
//   G1 `?source=`          archivePageSql / archiveCountsSql with the source tab (game_players_userId_endedAt_gameId_idx)
//
// Skipped unless TEST_DATABASE_URL is set (a throwaway local Postgres with every migration; never Neon).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { inlineStatement, planIssues, type PlanNode } from "../../../../packages/db/scripts/explain-hot";

const url = process.env.TEST_DATABASE_URL;
const HOT = ["games", "game_players", "jobs", "users", "linked_accounts", "import_runs", "import_cursors"];

type Query = { name: string; sql: string; noSeqScan: string[]; noSort: string[] };

describe("P4 hot-query plans (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: import("@repo/db").PrismaClient;
  const queries: Query[] = [];

  before(async () => {
    const { createPrismaClient } = await import("@repo/db");
    db = createPrismaClient({ datasourceUrl: url! });
    const { VIEWER_SQL, VIEWER_BY_ID_SQL } = await import("@/lib/auth/viewer");
    const { linkedAccountsSql, verifiedElsewhereSql } = await import("@/lib/data/accounts");
    const { importStatusSql } = await import("@/lib/data/imports");
    const { healImportKickSql, releaseWaitingImportsSql } = await import("@/lib/jobs/import");
    const { archivePageSql, archiveCountsSql } = await import("@/lib/services/analysis/archive-sql");
    const inline = (s: Prisma.Sql) => inlineStatement({ text: s.text, values: s.values });
    const now = new Date("2026-11-12T09:30:00Z");
    const filter: Parameters<typeof archivePageSql>[1] = { source: "chesscom" };
    queries.push(
      { name: "GET /api/me viewer (by Clerk id)", sql: VIEWER_SQL.replace(/\$1/g, "'user_explain'"), noSeqScan: HOT, noSort: [] },
      { name: "viewer by id (provisioning re-read)", sql: VIEWER_BY_ID_SQL.replace(/\$1/g, "'1'"), noSeqScan: HOT, noSort: [] },
      { name: "ACC-1 linked accounts", sql: inline(linkedAccountsSql(1n)), noSeqScan: HOT, noSort: [] },
      { name: "ACC-3/6 one linked account", sql: inline(linkedAccountsSql(1n, "CHESSCOM")), noSeqScan: HOT, noSort: [] },
      { name: "linked elsewhere (linked_accounts_verified_key)", sql: inline(verifiedElsewhereSql("LICHESS", "someone", 1n)), noSeqScan: HOT, noSort: [] },
      { name: "ACC-7 import status", sql: inline(importStatusSql(1n)), noSeqScan: HOT, noSort: ["import_runs"] },
      { name: "ACC-7 kick CAS (jobs_dedupeKey_key)", sql: inline(healImportKickSql("import:1")), noSeqScan: HOT, noSort: [] },
      { name: "fan-out release waiting imports (import_runs_waiting_idx)", sql: inline(releaseWaitingImportsSql(1n, now)), noSeqScan: HOT, noSort: [] },
      { name: "G1 ?source=chesscom page 1", sql: inline(archivePageSql(1n, filter, null, 20)), noSeqScan: HOT, noSort: ["game_players"] },
      { name: "G1 counts with the source tab", sql: inline(archiveCountsSql(1n, filter)), noSeqScan: HOT, noSort: ["game_players"] },
    );
  });

  after(async () => {
    await db?.$disconnect();
  });

  it("every P4 web statement keeps an index path (no Seq Scan on a listed table, no Sort over game_players)", async () => {
    const failures: string[] = [];
    for (const q of queries) {
      let plan: PlanNode | null = null;
      await db
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
          const r = await tx.$queryRawUnsafe<{ "QUERY PLAN": [{ Plan: PlanNode }] }[]>(`EXPLAIN (FORMAT JSON) ${q.sql}`);
          plan = r[0]!["QUERY PLAN"][0].Plan;
          throw new Error("rollback");
        })
        .catch((e: unknown) => {
          if (!(e instanceof Error) || e.message !== "rollback") throw e;
        });
      const { problems } = planIssues(plan!, q);
      if (problems.length) failures.push(`${q.name}: ${problems.join("; ")}`);
    }
    assert.deepEqual(failures, []);
    assert.equal(queries.length, 10);
  });
});
