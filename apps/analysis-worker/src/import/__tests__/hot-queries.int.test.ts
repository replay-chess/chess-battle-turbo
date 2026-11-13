// The worker's P4 read paths keep an index (phase-04 plan §9.2, §9.4; the explain gate's P4 worker rows): the import
// context (one statement per attempt, incl. the pending-purge probe on jobs_dedupeKey_key), the known filter (per 500
// games), the purge target read and the daily-sync backstop (linked_accounts_autosync_idx). Shape pass as P3's
// packages/db/scripts/explain-hot.ts: `enable_seqscan` / `enable_sort` off, plain EXPLAIN on the public schema.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inlineStatement, planIssues, type PlanNode } from "../../../../../packages/db/scripts/explain-hot";
import { importBackstopStatement } from "../../scheduler/recurring/import-backstop";
import { purgeTargetStatement } from "../../jobs/import-purge";
import { setupInt, skipInt, type IntEnv } from "../../testing/pg";
import { loadImportContextStatement } from "../context";
import { knownStatement } from "../known";

const HOT = ["games", "game_players", "jobs", "users", "linked_accounts", "import_runs", "import_cursors"];

describe("P4 worker hot-query plans (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  before(async () => {
    env = await setupInt("imphot");
  });
  after(async () => {
    await env?.close();
  });

  it("context, known filter, purge target and backstop keep an index path", async () => {
    const queries = [
      { name: "import context (+ pending purge probe)", s: loadImportContextStatement("1", "2") },
      { name: "import context, no run id", s: loadImportContextStatement("1", null) },
      { name: "known filter", s: knownStatement("1", "CHESSCOM", ["111", "222"], ["111~1", "222~1"]) },
      { name: "purge target", s: purgeTargetStatement("1", "LICHESS") },
      { name: "daily-sync backstop", s: importBackstopStatement() },
    ];
    const failures: string[] = [];
    const c = await env.owner.connect();
    try {
      for (const q of queries) {
        await c.query("BEGIN");
        await c.query("SET LOCAL search_path = public");
        await c.query("SET LOCAL enable_seqscan = off");
        await c.query("SET LOCAL enable_sort = off");
        const r = await c.query<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(`EXPLAIN (FORMAT JSON) ${inlineStatement(q.s)}`);
        await c.query("ROLLBACK");
        const { problems } = planIssues(r.rows[0]!["QUERY PLAN"][0].Plan, { noSeqScan: HOT, noSort: ["game_players"] });
        if (problems.length) failures.push(`${q.name}: ${problems.join("; ")}`);
      }
    } finally {
      c.release();
    }
    assert.deepEqual(failures, []);
  });
});
