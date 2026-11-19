// R2's pure parts (phase-05 plan §7.3 R2): facets, the upcoming histogram and the next batch under the cap, the keyset
// cursor.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api/api-error";
import type { Arrival } from "@repo/chess-training/caps";
import { ZERO_DAY, type DayCounters } from "./badges.server";
import { bankCursor, batchesOf, facetsOfRows, facetsOfSql, filterHash, nextBatchOf, readBankCursor, upcomingOf } from "./bank.server";
import { trainClock } from "./day.server";
import { bankRowOf } from "./dto.server";
import { cardRow, NOW } from "./test-rows";

const DAY = 86_400_000;
const PROFILE = { bankDailyCap: 10, newPerDay: 5 };

/** One REVIEW card (or `n`, or NEW ones) falling due at `at`. */
const arr = (at: Date, n = 1, isNew = false): Arrival => ({ at, n, isNew });

/** The served days for due counts and arrivals at `now` (the default profile, `day` today). */
function batches(
  o: { dueReview?: number; dueNew?: number; arrivals?: Arrival[]; now?: Date; tz?: string; dsh?: number; day?: DayCounters; cap?: number },
) {
  const clock = trainClock(o.now ?? NOW, o.tz ?? "UTC", { dayStartHour: o.dsh ?? 0, releaseHour: 8 });
  const due = { dueReview: o.dueReview ?? 0, dueNew: o.dueNew ?? 0, arrivals: o.arrivals ?? [] };
  return { days: batchesOf(due, { ...PROFILE, bankDailyCap: o.cap ?? 10 }, o.day ?? ZERO_DAY, clock), clock };
}

describe("R2 helpers", () => {
  it("facets: themes by count, phases and sources in their fixed order; the SQL form agrees", () => {
    const rows = [
      bankRowOf(cardRow({ itemKey: "m_a1", theme: "fork" }), NOW, "UTC")!,
      bankRowOf(cardRow({ itemKey: "m_a2", theme: "fork", source: "MISSED_PUNISH", cardPhase: "ENDGAME" }), NOW, "UTC")!,
      bankRowOf(cardRow({ itemKey: "m_a3", theme: "pin", cardPhase: "OPENING" }), NOW, "UTC")!,
    ];
    const f = facetsOfRows(rows);
    assert.deepEqual(f.theme, [{ key: "fork", label: "Fork", n: 2 }, { key: "pin", label: "Pin", n: 1 }]);
    assert.deepEqual(f.phase.map((x) => x.key), ["opening", "middlegame", "endgame"]);
    assert.deepEqual(f.source, [{ key: "own", label: "My blunders", n: 2 }, { key: "missed", label: "Missed punishments", n: 1 }]);
    const sql = facetsOfSql([
      { theme: "fork", phase: null, source: null, gt: 0, gp: 1, n: 2 },
      { theme: "pin", phase: null, source: null, gt: 0, gp: 1, n: 1 },
      { theme: null, phase: "OPENING", source: null, gt: 1, gp: 0, n: 1 },
      { theme: null, phase: "MIDDLEGAME", source: null, gt: 1, gp: 0, n: 1 },
      { theme: null, phase: "ENDGAME", source: null, gt: 1, gp: 0, n: 1 },
      { theme: null, phase: null, source: "OWN_ERROR", gt: 1, gp: 1, n: 2 },
      { theme: null, phase: null, source: "MISSED_PUNISH", gt: 1, gp: 1, n: 1 },
    ]);
    assert.deepEqual(sql, f);
  });

  it("upcoming: per local day for 6 days (non-zero), then Next week, at most 4 rows", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, 12 + d, 8));
    const dues = [at(1), at(1), at(2), at(3), at(3), at(3), at(8), at(9), at(20), new Date(NOW.getTime() - DAY)].map((d) => arr(d));
    assert.deepEqual(upcomingOf(batches({ arrivals: dues }).days), [
      { label: "Tomorrow", n: 2 },
      { label: "Saturday", n: 1 },
      { label: "Sunday", n: 3 },
      { label: "Next week", n: 2 },
    ]);
    assert.equal(upcomingOf(batches({ arrivals: [at(1), at(2), at(3), at(4), at(5)].map((d) => arr(d)) }).days).length, 4);
  });

  it("regression staging-next-batch-cap: the next batch and Coming up never pass the daily cap; held cards roll to later days", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, 12 + d, 8));
    // 23 reviews fall due tomorrow at 08:00: tomorrow serves the cap (10), the rest roll to Saturday and Sunday.
    const big = batches({ arrivals: [arr(at(1), 23), arr(at(3), 2)] });
    assert.deepEqual(nextBatchOf(big.days, big.clock), {
      at: at(1).toISOString(),
      atLabel: "08:00",
      count: 10,
      whenLabel: "tomorrow at 08:00",
      dayStartHour: 0,
      // FIX-4 (D-P6-FIX4-2): the training days the browser's word counts.
      dayKey: "2026-11-13",
      todayKey: "2026-11-12",
      todayEndsAt: "2026-11-13T00:00:00.000Z",
    });
    assert.deepEqual(upcomingOf(big.days), [
      { label: "Tomorrow", n: 10 },
      { label: "Saturday", n: 10 },
      { label: "Sunday", n: 5 },
    ]);
    // NEW cards (a fresh import): at most newPerDay of them a day.
    const fresh = batches({ arrivals: [arr(at(1), 69, true)] });
    assert.equal(nextBatchOf(fresh.days, fresh.clock)!.count, 5);
    assert.deepEqual(upcomingOf(fresh.days).slice(0, 3), [
      { label: "Tomorrow", n: 5 },
      { label: "Saturday", n: 5 },
      { label: "Sunday", n: 5 },
    ]);
    // The cap reached today with 31 due: tomorrow's batch is 10 of them, served from the day's start (00:00 here),
    // although nothing new falls due; the next batch was null before (nothing scheduled ahead).
    const held = batches({ dueReview: 31, day: { ...ZERO_DAY, bankReviewed: 10 } });
    assert.deepEqual(nextBatchOf(held.days, held.clock), {
      at: "2026-11-13T00:00:00.000Z",
      atLabel: "00:00",
      count: 10,
      whenLabel: "tomorrow at 00:00",
      dayStartHour: 0,
      dayKey: "2026-11-13",
      todayKey: "2026-11-12",
      todayEndsAt: "2026-11-13T00:00:00.000Z",
    });
    assert.deepEqual(upcomingOf(held.days), [
      { label: "Tomorrow", n: 10 },
      { label: "Saturday", n: 10 },
      { label: "Sunday", n: 10 },
      { label: "Monday", n: 1 },
    ]);
    // A lower cap (W8 bankDailyCap 5) is the cap every line uses.
    assert.deepEqual(upcomingOf(batches({ arrivals: [arr(at(1), 6)], cap: 5 }).days), [
      { label: "Tomorrow", n: 5 },
      { label: "Saturday", n: 1 },
    ]);
  });

  it("browser pass D4: at 01:00 Sunday IST (Saturday's training day) the 08:00 cards are Tomorrow, in rows and the histogram", () => {
    const now = new Date("2026-11-14T19:30:00Z"); // 01:00 Sunday Asia/Calcutta
    const sunday8 = new Date("2026-11-15T02:30:00Z"); // 08:00 Sunday local
    const row = bankRowOf(cardRow({ due: sunday8 }), now, "Asia/Calcutta", 4)!;
    assert.equal(row.isDue, false);
    assert.equal(row.nextLabel, "Tomorrow", "was \"Today\" under SCHEDULED LATER");
    assert.equal(bankRowOf(cardRow({ due: sunday8 }), now, "Asia/Calcutta")!.nextLabel, "Today", "the calendar word without the day start");
    assert.deepEqual(upcomingOf(batches({ arrivals: [arr(sunday8), arr(new Date(sunday8.getTime() + DAY))], now, tz: "Asia/Calcutta", dsh: 4 }).days), [
      { label: "Tomorrow", n: 1 },
      { label: "Monday", n: 1 },
    ]);
  });

  it("the next batch is labelled in the zone; none when nothing is ahead", () => {
    const arrivals = [arr(new Date("2026-11-13T08:00:00Z"), 3)];
    const next = (now: Date) => {
      const b = batches({ arrivals, now, tz: "Asia/Kolkata", dsh: 4 });
      return nextBatchOf(b.days, b.clock);
    };
    assert.deepEqual(next(new Date("2026-11-12T18:00:00Z")), {
      at: "2026-11-13T08:00:00.000Z",
      atLabel: "13:30",
      count: 3,
      whenLabel: "tomorrow at 13:30",
      dayStartHour: 4,
      dayKey: "2026-11-13",
      todayKey: "2026-11-12",
      todayEndsAt: "2026-11-12T22:30:00.000Z",
    });
    // The day word is the member's training day (P5-FZ-4): at 00:30 local it is still yesterday's day, so tomorrow;
    // once the day starts (04:00 local) the same instant is today.
    assert.equal(next(new Date("2026-11-12T19:00:00Z"))?.whenLabel, "tomorrow at 13:30");
    assert.equal(next(new Date("2026-11-12T22:30:00Z"))?.whenLabel, "today at 13:30");
    assert.equal(nextBatchOf(batches({}).days, batches({}).clock), null);
  });

  it("the cursor round-trips for its filter and is refused for another (cursor_filter_mismatch) or when malformed", () => {
    const f = { view: "all" as const, theme: "fork" };
    const c = bankCursor({ due: NOW, cardId: 123456789012n }, f);
    assert.match(c, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(readBankCursor(c, f), { due: NOW, id: 123456789012n });
    assert.notEqual(filterHash(f), filterHash({ view: "due", theme: "fork" }));
    assert.throws(() => readBankCursor(c, { view: "all", theme: "pin" }), (e: unknown) => e instanceof ApiError && e.details?.reason === "cursor_filter_mismatch");
    assert.throws(() => readBankCursor("nope", f), (e: unknown) => e instanceof ApiError && e.code === "validation_failed");
  });
});
