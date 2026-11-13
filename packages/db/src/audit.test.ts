// @repo/db/audit (phase-04 plan 6.1; R-04): shape checks in every mode; PII (email/token/password/secret keys at any
// depth, email-looking values or targetId) throws in strict mode and is dropped in production; one INSERT statement.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuditMetaError, auditSql, checkAuditEntry, type AuditEntry } from "./audit";

const base: AuditEntry = { category: "ACCOUNT", action: "account.linked", actorKind: "USER", actorUserId: 7n, targetType: "linked_account", targetId: "chesscom" };

describe("audit entries", () => {
  it("accepts a dotted action and serialises bigints in meta", () => {
    const e = checkAuditEntry({ ...base, meta: { verified: false, games: 480n, providers: ["chesscom"] } }, true);
    assert.deepEqual(e.meta, { verified: false, games: "480", providers: ["chesscom"] });
    assert.equal(e.actorUserId, 7n);
  });

  it("refuses bad shapes in every mode", () => {
    for (const strict of [true, false]) {
      assert.throws(() => checkAuditEntry({ ...base, action: "Account.Linked" }, strict), AuditMetaError);
      assert.throws(() => checkAuditEntry({ ...base, action: "linked" }, strict), AuditMetaError);
      assert.throws(() => checkAuditEntry({ ...base, category: "NOPE" as never }, strict), AuditMetaError);
      assert.throws(() => checkAuditEntry({ ...base, targetType: "x".repeat(33) }, strict), AuditMetaError);
      assert.throws(() => checkAuditEntry({ ...base, meta: { blob: "x".repeat(5000) } }, strict), AuditMetaError);
    }
  });

  it("strict mode throws on PII; production drops it and still writes", () => {
    const pii: AuditEntry = {
      ...base,
      targetId: "sam@example.com",
      meta: { userEmail: "x", nested: { accessToken: "t", ok: 1, note: "mail sam@example.com" }, list: [{ password: "p" }, "fine"] },
    };
    assert.throws(() => checkAuditEntry(pii, true), /meta\.userEmail.*forbidden key/);
    const kept = checkAuditEntry(pii, false);
    assert.equal(kept.targetId, null);
    assert.deepEqual(kept.meta, { nested: { ok: 1 }, list: [{}, "fine"] });
  });

  it("builds one parameterised INSERT with the UTC clock by default", () => {
    const sql = auditSql({ ...base, meta: null });
    assert.match(sql.sql, /^INSERT INTO audit_logs \(at, category, action/);
    assert.match(sql.sql, /now\(\) AT TIME ZONE 'UTC'/);
    assert.ok(sql.values.includes("account.linked"));
    const at = auditSql({ ...base, at: new Date("2026-11-10T09:30:00Z") });
    assert.ok(at.values.includes("2026-11-10T09:30:00.000Z"));
  });
});
