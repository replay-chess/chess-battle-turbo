import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRequestStore,
  createTimer,
  exemptWrites,
  getRequestStore,
  isWriteOperation,
  isWriteSql,
  recordQuery,
  runWithRequestStore,
  serverTimingHeader,
  sqlTextOf,
} from "./timing";

describe("request store", () => {
  it("sums db time and statements; counts writes outside exemptWrites only", async () => {
    const store = createRequestStore();
    await runWithRequestStore(store, async () => {
      recordQuery(2, false, "user.findUnique");
      await Promise.resolve();
      recordQuery(3, true, "user.update");
      await exemptWrites(async () => recordQuery(1, true, "$queryRawUnsafe"));
      assert.equal(getRequestStore(), store);
    });
    assert.equal(store.dbMs, 6);
    assert.equal(store.dbStatements, 3);
    assert.equal(store.writes, 1);
    assert.deepEqual(store.writeOps, ["user.update"]);
  });
  it("is a no-op outside a request and isolates concurrent requests", async () => {
    recordQuery(5, true, "x");
    assert.equal(getRequestStore(), undefined);
    const a = createRequestStore();
    const b = createRequestStore();
    await Promise.all([
      runWithRequestStore(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        recordQuery(1, false, "a");
      }),
      runWithRequestStore(b, async () => recordQuery(1, true, "b")),
    ]);
    assert.equal(a.writes, 0);
    assert.equal(b.writes, 1);
  });
});

describe("write classification", () => {
  it("model operations", () => {
    for (const op of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      assert.equal(isWriteOperation(op, {}), true, op);
    }
    for (const op of ["findUnique", "findMany", "count", "aggregate", "groupBy", "findFirst"]) {
      assert.equal(isWriteOperation(op, {}), false, op);
    }
  });
  it("raw SQL by its text", () => {
    assert.equal(isWriteSql("SELECT 1"), false);
    assert.equal(isWriteSql("  insert into t values (1)"), true);
    assert.equal(isWriteSql("UPDATE users SET a = 1"), true);
    assert.equal(isWriteSql("DELETE FROM t"), true);
    assert.equal(isWriteSql("WITH x AS (SELECT 1) SELECT * FROM x"), false);
    assert.equal(isWriteSql("WITH x AS (UPDATE users SET a = 1 RETURNING id) SELECT * FROM x"), true);
    assert.equal(isWriteSql("/* c */ -- note\nINSERT INTO t VALUES (1)"), true);
    assert.equal(isWriteOperation("$queryRawUnsafe", ["INSERT INTO rate_limit_buckets …", "k", 60]), true);
    assert.equal(isWriteOperation("$queryRaw", { strings: ["SELECT ", ""], values: [1] }), false);
    assert.equal(isWriteOperation("$executeRaw", [["DELETE FROM t WHERE id = ", ""], 1]), true);
  });
  it("sqlTextOf reads the shapes Prisma passes", () => {
    assert.equal(sqlTextOf({ sql: "SELECT 1" }), "SELECT 1");
    assert.equal(sqlTextOf([["SELECT ", " FROM t"], 1]), "SELECT ? FROM t");
    assert.equal(sqlTextOf(42), "");
  });
});

describe("Server-Timing", () => {
  it("formats rounded, summed segments", () => {
    assert.equal(
      serverTimingHeader([{ name: "auth", dur: 1.234 }, { name: "db", dur: 2 }, { name: "db", dur: 0.55 }]),
      "auth;dur=1.2, db;dur=2.6",
    );
  });
  it("createTimer marks consecutive segments and ignores bad names", () => {
    let t = 0;
    const timer = createTimer(() => (t += 2));
    timer.mark("auth");
    timer.mark("Bad Name");
    timer.mark("app");
    assert.deepEqual(timer.segments(), [{ name: "auth", dur: 2 }, { name: "app", dur: 2 }]);
  });
});
