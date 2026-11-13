import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ledgerRowsFor, type LedgerHasher } from "./trial-ledger";

/** A transparent hasher: what goes in is visible in the output, so the test reads the row's composition. */
const hasher: LedgerHasher = {
  emailHash: (email) => `E(${email.trim().toLowerCase().replace(/\+[^@]*/, "")})`,
  handleHash: (p, u, v) => `${v ? "v" : "u"}:${p}:${u}`,
};

describe("B9 ledgerRowsFor", () => {
  it("one row per email with every linked handle (verified and unverified) and the trial start", () => {
    const rows = ledgerRowsFor(
      [
        {
          email: "Sam@Example.com",
          trialStartedAt: new Date("2026-09-01T10:00:00Z"),
          handles: [
            { provider: "CHESSCOM", usernameLower: "knightowl_88", verified: false },
            { provider: "LICHESS", usernameLower: "knightowl88", verified: true },
          ],
        },
        { email: "solo@example.com", trialStartedAt: new Date("2026-10-01T00:00:00Z"), handles: null },
      ],
      hasher,
    );
    assert.deepEqual(rows, [
      {
        emailHash: "E(sam@example.com)",
        handleHashes: ["u:chesscom:knightowl_88", "v:lichess:knightowl88"],
        firstTrialAt: "2026-09-01T10:00:00.000Z",
      },
      { emailHash: "E(solo@example.com)", handleHashes: [], firstTrialAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("accounts whose emails normalise alike share one row: handles merged, the earliest trial kept", () => {
    const rows = ledgerRowsFor(
      [
        { email: "sam+chess@example.com", trialStartedAt: new Date("2026-10-05T00:00:00Z"), handles: [{ provider: "CHESSCOM", usernameLower: "a_1", verified: false }] },
        { email: "SAM@example.com", trialStartedAt: new Date("2026-08-05T00:00:00Z"), handles: [{ provider: "LICHESS", usernameLower: "b2", verified: true }] },
      ],
      hasher,
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { emailHash: "E(sam@example.com)", handleHashes: ["u:chesscom:a_1", "v:lichess:b2"], firstTrialAt: "2026-08-05T00:00:00.000Z" });
  });

  it("no users, no rows", () => {
    assert.deepEqual(ledgerRowsFor([], hasher), []);
  });
});
