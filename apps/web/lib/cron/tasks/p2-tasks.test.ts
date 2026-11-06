// P2 cron tasks (phase-02 plan §6.6.8, §7.7): the stale bot-game sweep and the idempotency-key prune.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { createIdempotencyPrune } from "./idempotency-prune";
import { createStaleBotGames } from "./stale-bot-games";

const ctx = { now: new Date(0), clock: () => 0, sleep: async () => undefined, after: () => undefined, deadlineMs: 1 };
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

describe("stale-bot-games", () => {
  it("runs the one-statement sweep: BOT games idle 7 days → ABORTED, players closed, gamesVersion bumped", async () => {
    const seen: Prisma.Sql[] = [];
    const task = createStaleBotGames(async (sql) => {
      seen.push(sql);
      return [{ aborted: 3 }];
    });
    assert.equal(task.name, "stale-bot-games");
    assert.deepEqual(await task.run(ctx), { count: 3 });
    const text = textOf(seen[0]!);
    assert.match(text, /UPDATE games SET status = 'ABORTED'/);
    assert.match(text, /mode = 'BOT'/);
    assert.match(text, /status = 'IN_PROGRESS'/);
    assert.match(text, /UPDATE game_players SET result = 'ABORTED'/);
    assert.match(text, /"gamesVersion" = u\."gamesVersion" \+ 1/);
    assert.deepEqual(seen[0]!.values, [7]);
  });

  it("counts 0 when nothing is stale", async () => {
    assert.deepEqual(await createStaleBotGames(async () => []).run(ctx), { count: 0 });
  });
});

describe("idempotency-prune", () => {
  it("deletes rows older than 24 h", async () => {
    const seen: Prisma.Sql[] = [];
    const task = createIdempotencyPrune(async (sql) => {
      seen.push(sql);
      return 5;
    });
    assert.equal(task.name, "idempotency-prune");
    assert.deepEqual(await task.run(ctx), { count: 5 });
    assert.match(textOf(seen[0]!), /DELETE FROM idempotency_keys WHERE "createdAt" < now\(\)/);
    assert.deepEqual(seen[0]!.values, [24]);
  });
});
