import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { applyPurge, parsePurgeArgs, planPurge, purgeTargetsSql } from "./purge-imports";

const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("purge-imports", () => {
  it("parses the CLI; dry run by default; refuses bad input", () => {
    assert.deepEqual(parsePurgeArgs(["--provider", "chesscom"]), { provider: "chesscom", userRef: null, apply: false });
    assert.deepEqual(parsePurgeArgs(["--provider", "lichess", "--user", "cabcdefghijklmnopqrstuvwx", "--apply"]), {
      provider: "lichess",
      userRef: "cabcdefghijklmnopqrstuvwx",
      apply: true,
    });
    assert.throws(() => parsePurgeArgs([]));
    assert.throws(() => parsePurgeArgs(["--provider", "replay"]));
    assert.throws(() => parsePurgeArgs(["--provider", "chesscom", "--user", "x' OR 1=1"]));
    assert.throws(() => parsePurgeArgs(["--provider", "chesscom", "--force"]));
  });

  it("targets by source, optionally one member", () => {
    const all = purgeTargetsSql("chesscom", null);
    assert.ok(all.values.includes("CHESSCOM"));
    assert.equal(all.values.length, 1);
    const one = purgeTargetsSql("lichess", "cabcdefghijklmnopqrstuvwx");
    assert.deepEqual(one.values, ["LICHESS", "cabcdefghijklmnopqrstuvwx"]);
  });

  it("plans and queues one IMPORT_PURGE per member with the dedupe key and the payload", async () => {
    const seen: Prisma.Sql[] = [];
    const db = {
      $queryRaw: async <T>(q: Prisma.Sql) => {
        seen.push(q);
        return (seen.length === 1 ? [{ userId: 7n, userRef: "cuserseven00000000000000000", games: 12 }] : [{ id: 1 }]) as T;
      },
      $executeRaw: async () => 0,
    };
    const targets = await planPurge(db, { provider: "chesscom", userRef: null });
    assert.deepEqual(targets, [{ userId: 7n, userRef: "cuserseven00000000000000000", games: 12 }]);
    assert.equal(await applyPurge(db, "chesscom", targets, NOW), 1);
    const job = seen[1]!;
    assert.ok(job.values.includes("IMPORT_PURGE"));
    assert.ok(job.values.includes("importpurge:7:chesscom"));
    assert.ok(job.values.includes(JSON.stringify({ v: 1, userId: "7", provider: "CHESSCOM", requestedAt: NOW.toISOString() })));
  });
});
