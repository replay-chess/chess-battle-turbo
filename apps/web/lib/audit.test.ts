// WEB/lib/audit.ts (phase-04 plan 6.1, 12.1): one INSERT through the given transaction client; strict outside
// production (PII throws before any statement), lenient in production (PII dropped, the row still written).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@repo/db";
import { audit, auditIsStrict, AuditMetaError } from "./audit";

function fakeTx() {
  const calls: Prisma.Sql[] = [];
  return {
    calls,
    $executeRaw(query: Prisma.Sql) {
      calls.push(query);
      return Promise.resolve(1);
    },
    $queryRaw<T>(): Promise<T> {
      return Promise.reject(new Error("audit must not read"));
    },
  };
}

describe("audit()", () => {
  it("writes one parameterised INSERT on the caller's transaction", async () => {
    const tx = fakeTx();
    await audit(tx, {
      category: "ACCOUNT",
      action: "account.unlinked",
      actorKind: "USER",
      actorUserId: 12n,
      targetType: "linked_account",
      targetId: "lichess",
      requestId: "req_abc",
      meta: { provider: "lichess", deleteGames: true },
    }, { appEnv: "dev" });
    assert.equal(tx.calls.length, 1);
    assert.match(tx.calls[0]!.sql, /^INSERT INTO audit_logs/);
    assert.ok(tx.calls[0]!.values.includes("account.unlinked"));
    assert.ok(tx.calls[0]!.values.includes(JSON.stringify({ provider: "lichess", deleteGames: true })));
  });

  it("is strict in dev, test and local builds: an email key throws before any statement", async () => {
    for (const appEnv of ["dev", "test", ""]) {
      const tx = fakeTx();
      await assert.rejects(
        audit(tx, { category: "BILLING", action: "billing.duplicate_trial_cancelled", actorKind: "WEBHOOK", meta: { customerEmail: "a@b.co" } }, { appEnv }),
        AuditMetaError,
      );
      assert.equal(tx.calls.length, 0);
    }
    assert.equal(auditIsStrict("dev"), true);
    assert.equal(auditIsStrict(undefined), true);
    assert.equal(auditIsStrict("production"), false);
  });

  it("in production drops the PII and still writes the row", async () => {
    const tx = fakeTx();
    await audit(
      tx,
      { category: "ACCOUNT", action: "account.link_coclaim", actorKind: "USER", targetId: "sam@example.com", meta: { accessToken: "t", n: 2 } },
      { appEnv: "production" },
    );
    assert.equal(tx.calls.length, 1);
    const values = tx.calls[0]!.values;
    assert.ok(!values.some((v) => typeof v === "string" && (v.includes("sam@example.com") || v.includes("accessToken"))));
    assert.ok(values.includes(JSON.stringify({ n: 2 })));
  });
});
