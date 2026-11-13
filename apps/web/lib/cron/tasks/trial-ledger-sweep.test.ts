// Cron task trial-ledger-sweep (FIX-2): the backstop of the fan-out's ledger write. The SQL runs on Postgres in
// test/integration/fanout.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordedHashes } from "@/lib/billing/trial-ledger";
import { createTrialLedgerSweep, sweepRows, type SweepCandidate } from "./trial-ledger-sweep";

const PEPPER = "sweep-test-pepper-0123456789abcdef0123";
const ctx = { now: new Date("2026-11-13T04:00:00Z"), clock: () => 0, sleep: async () => {}, after: () => {}, deadlineMs: 45_000 };

describe("trial-ledger-sweep", () => {
  it("writes the same hashes as the fan-out (every handle, verified or not), with the trial's start", () => {
    const c: SweepCandidate = {
      email: "Some.One+x@googlemail.com",
      trialStartedAt: new Date("2026-11-10T09:00:00Z"),
      handles: [
        { provider: "chesscom", usernameLower: "owl", verified: false },
        { provider: "lichess", usernameLower: "owl", verified: true },
      ],
    };
    const [row] = sweepRows([c], PEPPER);
    const expected = recordedHashes(c.email, c.handles, PEPPER);
    assert.deepEqual(row, { e: expected.emailHash, h: expected.handleHashes, t: "2026-11-10T09:00:00.000Z" });
  });

  it("one write for every candidate; nothing to do → no write", async () => {
    const writes: unknown[][] = [];
    const db = (candidates: SweepCandidate[]) => ({
      candidates: async () => candidates,
      write: async (rows: unknown[]) => (writes.push(rows), { inserted: 1, swept: rows.length }),
    });
    const none = await createTrialLedgerSweep(db([]), PEPPER).run(ctx);
    assert.deepEqual(none, { count: 0, detail: { swept: 0, recovered: 0 } });
    assert.equal(writes.length, 0);
    const two = [0, 1].map((i) => ({ email: `p${i}@example.test`, trialStartedAt: new Date("2026-11-12T00:00:00Z"), handles: [] }));
    const out = await createTrialLedgerSweep(db(two), PEPPER).run(ctx);
    assert.deepEqual(out, { count: 1, detail: { swept: 2, recovered: 1 } });
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.length, 2);
  });
});
