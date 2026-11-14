// The review's bank fields (phase-05 plan §7.3 "Review bank fields"): A1's moment cards, A2's {count, plies}, the
// complete page's "added" line and Drill link.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReviewBank } from "@repo/contracts/http/train";
import { bankCardsOf, bankContextOf, completeBankOf, momentBankOf, reviewBankOf } from "./reviewBank.server";
import { NOW } from "./test-rows";

describe("review bank fields", () => {
  const raw = [
    { ply: 36, key: "m_k1", due: "2026-11-13T08:00:00.000Z" },
    { ply: 32, key: "m_k2", due: "2026-11-14T08:00:00.000Z" },
  ];
  const cards = bankCardsOf(JSON.stringify(raw));
  const ctx = { nowMs: NOW.getTime(), timeZone: "UTC" };

  it("moment cards: in the bank exactly when a card exists", () => {
    assert.deepEqual(momentBankOf(cards, 36, ctx), { inBank: true, card: { ref: "m_k1", dueLabel: "Tomorrow" } });
    assert.deepEqual(momentBankOf(cards, 40, ctx), { inBank: false, card: null });
    assert.deepEqual(bankCardsOf(null), []);
  });

  it("A2: null before extraction, else the cards that exist now", () => {
    assert.equal(reviewBankOf(cards, 0), null);
    assert.deepEqual(ReviewBank.parse(reviewBankOf(cards, 1)), { count: 2, plies: [36, 32] });
    assert.deepEqual(reviewBankOf([], 1), { count: 0, plies: [] });
  });

  it("complete: the earliest due as a lower-case day word, the Drill link to the game's cards", () => {
    assert.deepEqual(completeBankOf(cards, "cm3k9x2p10007slzpqa8hd4fe", ctx), {
      added: 2,
      nextDueAt: "2026-11-13T08:00:00.000Z",
      nextDueLabel: "tomorrow",
      drillHref: "/train/bank/session?game=cm3k9x2p10007slzpqa8hd4fe",
    });
    assert.deepEqual(completeBankOf([], "x", ctx), { added: 0, nextDueAt: null, nextDueLabel: null, drillHref: null });
  });

  it("the labels use the viewer's zone (UTC for an unknown one)", () => {
    assert.equal(bankContextOf({ user: { timeZone: "Asia/Kolkata" } }, 0).timeZone, "Asia/Kolkata");
    assert.equal(bankContextOf({ user: { timeZone: "Nope/Zone" } }, 0).timeZone, "UTC");
  });
});
