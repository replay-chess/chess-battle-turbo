// Cron task `import-prune` (phase-04 §7.11): the two statements' shape and the runner's counts with a fake query.
// The SQL itself runs on Postgres in test/api/accounts.contract.int.test.ts ("import-prune").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { CRON_TASKS, type CronContext } from "./index";
import { cancelStaleWaitingRunsSql, createImportPrune, pruneFinishedRunsSql } from "./import-prune";

const NOW = new Date("2026-11-12T03:00:00.000Z");
const flat = (s: Prisma.Sql) => s.text.replace(/\s+/g, " ");

describe("import-prune", () => {
  it("is registered in the daily cron", () => {
    assert.ok(CRON_TASKS.some((t) => t.name === "import-prune"));
  });

  it("P23 cancels waiting runs older than 30 days and resets only accounts still waiting", () => {
    const sql = cancelStaleWaitingRunsSql(NOW);
    const text = flat(sql);
    assert.match(text, /UPDATE import_runs SET status = 'CANCELLED', "finishedAt" = /);
    assert.match(text, /WHERE status = 'WAITING_FOR_MEMBERSHIP' AND "createdAt" < .* - make_interval\(days => \$\d+::int\)/);
    assert.match(text, /UPDATE linked_accounts SET "importState" = 'IDLE'.* AND "importState" = 'WAITING_FOR_MEMBERSHIP'/);
    assert.ok(sql.values.includes(30));
    assert.ok(sql.values.includes(NOW.toISOString()));
  });

  it("P22 deletes DONE / CANCELLED after 30 days and FAILED after 90", () => {
    const sql = pruneFinishedRunsSql(NOW);
    assert.match(flat(sql), /status IN \('DONE', 'CANCELLED'\) AND "finishedAt" < .* OR \(status = 'FAILED' AND "finishedAt" < /);
    assert.ok(sql.values.includes(30));
    assert.ok(sql.values.includes(90));
  });

  it("runs P23 then P22 and reports both counts", async () => {
    const seen: string[] = [];
    const task = createImportPrune(async (sql) => {
      seen.push(flat(sql).includes("CANCELLED', \"finishedAt\"") ? "p23" : "p22");
      return [{ n: seen.length === 1 ? 2 : 5 }];
    });
    const ctx = { now: NOW } as CronContext;
    assert.deepEqual(await task.run(ctx), { count: 7, detail: { cancelled: 2, deleted: 5 } });
    assert.deepEqual(seen, ["p23", "p22"]);
  });
});
