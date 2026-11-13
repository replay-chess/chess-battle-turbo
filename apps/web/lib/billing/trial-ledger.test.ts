// Phase-04 plan 8.4, 12.1 (`trial-ledger.test.ts`): email normalisation, hash stability (P10's deletion path imports
// the same function, so the vector below must never change), verified-only enforcement and the two statements.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  HASH_PEPPER_MIN_LENGTH,
  HashPepperMissingError,
  HashPepperWeakError,
  LEDGER_PROBE_SQL,
  LEDGER_WRITE_SQL,
  checkTrialLedger,
  enforcedHashes,
  handleHash,
  normaliseEmail,
  recordTrialLedger,
  recordedHashes,
  trialLedgerEmailHash,
  type LedgerDb,
} from "./trial-ledger";

const PEPPER = "test-pepper-0123456789abcdef-0123456789";
const savedPepper = process.env.HASH_PEPPER;
afterEach(() => {
  if (savedPepper === undefined) delete process.env.HASH_PEPPER;
  else process.env.HASH_PEPPER = savedPepper;
});

describe("normaliseEmail", () => {
  it("Gmail: dots and +tags folded, googlemail.com → gmail.com, case and spaces dropped", () => {
    assert.equal(normaliseEmail("  Kas.Par.Ov@Gmail.com "), "kasparov@gmail.com");
    assert.equal(normaliseEmail("kasparov+chess@gmail.com"), "kasparov@gmail.com");
    assert.equal(normaliseEmail("k.asparov+a+b@googlemail.com"), "kasparov@gmail.com");
  });

  it("other domains keep their dots but drop a +tag", () => {
    assert.equal(normaliseEmail("garry.kasparov@example.com"), "garry.kasparov@example.com");
    assert.equal(normaliseEmail("garry.kasparov+trial2@Example.COM"), "garry.kasparov@example.com");
  });

  it("splits at the last @ and leaves a malformed string lowercased", () => {
    assert.equal(normaliseEmail('"a@b"+x@example.com'), '"a@b"@example.com');
    assert.equal(normaliseEmail("NoAtSign"), "noatsign");
    assert.equal(normaliseEmail("trailing@"), "trailing@");
  });
});

describe("hashes", () => {
  it("trialLedgerEmailHash is sha256hex(pepper + newline + normalised email): pinned vector", () => {
    const expected = "2a67483b07ec7cc38803d2bc8d50e214592585657d01a07b47b863ed9c8f157d";
    assert.equal(trialLedgerEmailHash("Kas.parov+x@googlemail.com", PEPPER), expected);
    assert.equal(trialLedgerEmailHash("kasparov@gmail.com", PEPPER), expected);
    assert.match(expected, /^[0-9a-f]{64}$/);
  });

  it("reads HASH_PEPPER at call time and refuses to hash without it", () => {
    delete process.env.HASH_PEPPER;
    assert.throws(() => trialLedgerEmailHash("a@b.com"), HashPepperMissingError);
    assert.throws(() => handleHash("lichess", "x", true), HashPepperMissingError);
    process.env.HASH_PEPPER = PEPPER;
    assert.equal(trialLedgerEmailHash("kasparov@gmail.com"), trialLedgerEmailHash("kasparov@gmail.com", PEPPER));
  });

  it("regression: hash-pepper-strength (FIX-1): a pepper under 32 characters is refused, from the env or passed in", () => {
    assert.throws(() => trialLedgerEmailHash("a@b.com", "short-pepper"), HashPepperWeakError);
    assert.throws(() => handleHash("lichess", "x", true, "x".repeat(HASH_PEPPER_MIN_LENGTH - 1)), HashPepperWeakError);
    process.env.HASH_PEPPER = "guessable";
    assert.throws(() => trialLedgerEmailHash("a@b.com"), HashPepperWeakError);
    process.env.HASH_PEPPER = PEPPER;
    assert.match(trialLedgerEmailHash("a@b.com", "x".repeat(HASH_PEPPER_MIN_LENGTH)), /^[0-9a-f]{64}$/);
  });

  it("a different pepper gives a different hash", () => {
    assert.notEqual(trialLedgerEmailHash("kasparov@gmail.com", PEPPER), trialLedgerEmailHash("kasparov@gmail.com", "other-pepper-0123456789abcdef-01234567"));
  });

  it("handleHash: v:/u: prefix + sha256hex(pepper + newline + provider:username), case-insensitive", () => {
    const hex = "01df3bc7f1af278da7619d365da47a9ddb4314cd4c496bb64d85cf24da2e61cf";
    assert.equal(handleHash("chesscom", "knightowl_88", false, PEPPER), `u:${hex}`);
    assert.equal(handleHash("chesscom", "KnightOwl_88", true, PEPPER), `v:${hex}`);
    assert.notEqual(handleHash("lichess", "knightowl_88", true, PEPPER), `v:${hex}`);
  });

  it("eligibility enforces verified handles only; the write records every handle (D4-10)", () => {
    const handles = [
      { provider: "chesscom" as const, usernameLower: "squatted", verified: false },
      { provider: "lichess" as const, usernameLower: "knightowl88", verified: true },
    ];
    const enforced = enforcedHashes("a@example.com", handles, PEPPER);
    assert.deepEqual(enforced.handleHashes, [handleHash("lichess", "knightowl88", true, PEPPER)]);
    const recorded = recordedHashes("a@example.com", [...handles, handles[1]!], PEPPER);
    assert.equal(recorded.handleHashes.length, 2);
    assert.deepEqual(recorded.handleHashes, [...recorded.handleHashes].sort());
    assert.ok(recorded.handleHashes.includes(handleHash("chesscom", "squatted", false, PEPPER)));
  });
});

describe("statements", () => {
  function fakeDb(rows: unknown[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: LedgerDb = {
      $queryRawUnsafe: async <T>(sql: string, ...values: unknown[]) => {
        calls.push({ sql, values });
        return rows as T;
      },
    };
    return { db, calls };
  }

  it("checkTrialLedger sends the email hash and the verified handle hashes; maps the hit kind", async () => {
    const miss = fakeDb([]);
    const handles = [{ provider: "chesscom" as const, usernameLower: "x_y", verified: false }];
    assert.deepEqual(await checkTrialLedger(miss.db, { email: "A@B.com", handles }, PEPPER), { hit: false, kind: null });
    assert.equal(miss.calls[0]!.sql, LEDGER_PROBE_SQL);
    assert.deepEqual(miss.calls[0]!.values, [trialLedgerEmailHash("a@b.com", PEPPER), []]);

    const hit = fakeDb([{ kind: "handle" }]);
    assert.deepEqual(await checkTrialLedger(hit.db, { email: "a@b.com", handles: [] }, PEPPER), { hit: true, kind: "handle" });
  });

  it("recordTrialLedger merges all handles with ON CONFLICT and passes firstTrialAt as UTC", async () => {
    const f = fakeDb([{ inserted: true }]);
    const at = new Date("2026-11-01T10:00:00.000Z");
    const inserted = await recordTrialLedger(
      f.db,
      { email: "a@b.com", handles: [{ provider: "lichess", usernameLower: "abc", verified: true }], firstTrialAt: at },
      PEPPER,
    );
    assert.equal(inserted, true);
    assert.equal(f.calls[0]!.sql, LEDGER_WRITE_SQL);
    assert.deepEqual(f.calls[0]!.values, [trialLedgerEmailHash("a@b.com", PEPPER), [handleHash("lichess", "abc", true, PEPPER)], at.toISOString()]);
    assert.match(LEDGER_WRITE_SQL, /ON CONFLICT \("emailHash"\) DO UPDATE/);

    const again = fakeDb([{ inserted: false }]);
    assert.equal(await recordTrialLedger(again.db, { email: "a@b.com", handles: [] }, PEPPER), false);
    assert.equal(again.calls[0]!.values[2], null);
  });
});
