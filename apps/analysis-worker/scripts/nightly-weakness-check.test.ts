// The nightly dev recompute check's pure parts (phase-06 plan §12.4 "Nightly on dev"): the guards (never the production
// site, never a database but the Neon dev endpoint or a local Postgres), the normalisation that takes times out of the
// metrics document, and the diff that names each differing path. The database half ran against the local e2e stack.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTarget, CheckError, diffPaths, normalise, parseArgs, utcOf } from "./nightly-weakness-check";

describe("nightly-weakness-check", () => {
  it("arguments: the user and the site, the timeout bounds, never the production domain", () => {
    assert.deepEqual(parseArgs(["--user", "p@x.dev", "--user-ref", "cwpool24refabcdef0000", "--base-url", "https://dev.example.app/"]), {
      user: "p@x.dev",
      userRef: "cwpool24refabcdef0000",
      baseUrl: "https://dev.example.app",
      timeoutSec: 120,
      out: null,
    });
    assert.throws(() => parseArgs(["--user", "p@x.dev"]), CheckError);
    // regression: nightly-check-email-grant (FIX-1): the database row is found by its ref, never by email.
    assert.throws(() => parseArgs(["--user", "p@x.dev", "--base-url", "https://dev.example.app"]), /user-ref/);
    assert.throws(() => parseArgs(["--user", "p@x.dev", "--user-ref", "x'; drop", "--base-url", "https://dev.example.app"]), /reference id/);
    assert.throws(() => parseArgs(["--user", "p@x.dev", "--user-ref", "cwpool24refabcdef0000", "--base-url", "https://playchess.tech"]), /production/);
    assert.throws(() => parseArgs(["--user", "p@x.dev", "--user-ref", "cwpool24refabcdef0000", "--base-url", "https://www.playchess.tech"]), /production/);
    assert.throws(() => parseArgs(["--user", "p@x.dev", "--user-ref", "cwpool24refabcdef0000", "--base-url", "https://d.app", "--timeout-sec", "5"]), /10\.\.900/);
  });

  it("the database: the Neon dev endpoint or a local Postgres, nothing else", () => {
    assert.equal(assertTarget("postgresql://u:p@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb"), "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech");
    assert.equal(assertTarget("postgresql://u:p@127.0.0.1:5432/replay"), "127.0.0.1");
    assert.throws(() => assertTarget("postgresql://u:p@ep-shiny-shape-b8lvr0f5.c-14.us-east-1.aws.neon.tech/neondb"), /refusing/);
    assert.throws(() => assertTarget(undefined), /WORKER_DATABASE_URL/);
  });

  it("normalise: instants become <time>, computedAt and inputs.at go, floats are rounded", () => {
    const a = normalise({ computedAt: "x", inputs: { at: "2026-11-18T03:00:00.000Z", baseline: "v1" }, rows: [{ you: 3.1000000004, since: "2026-06-01T00:00:00.000Z" }] });
    assert.deepEqual(a, { inputs: { baseline: "v1" }, rows: [{ you: 3.1, since: "<time>" }] });
  });

  it("diffPaths names each differing path", () => {
    assert.deepEqual(diffPaths({ a: 1, rows: [{ p: "fork" }] }, { a: 1, rows: [{ p: "fork" }] }), []);
    assert.deepEqual(diffPaths({ a: 1, rows: [{ p: "fork" }] }, { a: 2, rows: [{ p: "pin" }] }), ['$.a: 1 ≠ 2', '$.rows[0].p: "fork" ≠ "pin"']);
  });

  it("utcOf reads timestamp(3) text as UTC", () => {
    assert.equal(utcOf("2026-11-18T03:59:28.315Z").toISOString(), "2026-11-18T03:59:28.315Z");
    assert.equal(utcOf("2026-11-18 03:59:28.315").toISOString(), "2026-11-18T03:59:28.315Z");
  });
});
