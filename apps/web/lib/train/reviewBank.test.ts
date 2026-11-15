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

  it("A2: null before extraction while no card exists, else the cards that exist now", () => {
    assert.equal(reviewBankOf([], 0), null);
    // A moment added through A6 before the side was extracted (browser pass D1) counts.
    assert.deepEqual(reviewBankOf(cards.slice(0, 1), 0), { count: 1, plies: [cards[0]!.ply] });
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

  // P5-FZ-4: Train's day words count the training day (default start 04:00), so a card just added comes back
  // "tomorrow" until 04:00 local even when its 08:00 release is later the same calendar day. regression:
  // review-complete-hour (CI 43662852275, e2e review-to-bank at 01:32 UTC expected the calendar word "today").
  it("complete: a card due at the next 08:00 release reads by the training day at 23:30, 00:30, 03:30, 04:30 local", () => {
    // [zone, the release instant (08:00 local on 2026-11-15), [local time, its UTC instant, the word]]
    const cases = [
      ["UTC", "2026-11-15T08:00:00.000Z", [
        ["23:30", "2026-11-14T23:30:00.000Z", "tomorrow"],
        ["00:30", "2026-11-15T00:30:00.000Z", "tomorrow"],
        ["03:30", "2026-11-15T03:30:00.000Z", "tomorrow"],
        ["04:30", "2026-11-15T04:30:00.000Z", "today"],
      ]],
      ["Asia/Calcutta", "2026-11-15T02:30:00.000Z", [
        ["23:30", "2026-11-14T18:00:00.000Z", "tomorrow"],
        ["00:30", "2026-11-14T19:00:00.000Z", "tomorrow"],
        ["03:30", "2026-11-14T22:00:00.000Z", "tomorrow"],
        ["04:30", "2026-11-14T23:00:00.000Z", "today"],
      ]],
    ] as const;
    for (const [timeZone, due, hours] of cases) {
      const card = [{ ply: 6, key: "m_k", due: new Date(due) }];
      for (const [local, at, word] of hours) {
        const ctx = bankContextOf({ user: { timeZone } }, Date.parse(at));
        assert.equal(completeBankOf(card, "g", ctx).nextDueLabel, word, `${timeZone} ${local}`);
        assert.equal(momentBankOf(card, 6, ctx).card?.dueLabel, word === "today" ? "Today" : "Tomorrow", `${timeZone} ${local} (A1)`);
      }
    }
  });

  it("the labels use the viewer's zone (UTC for an unknown one)", () => {
    assert.equal(bankContextOf({ user: { timeZone: "Asia/Kolkata" } }, 0).timeZone, "Asia/Kolkata");
    assert.equal(bankContextOf({ user: { timeZone: "Nope/Zone" } }, 0).timeZone, "UTC");
  });
});
