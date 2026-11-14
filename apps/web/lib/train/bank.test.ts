// R2's pure parts (phase-05 plan §7.3 R2): facets, the upcoming histogram, the next batch, the keyset cursor.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api/api-error";
import { bankCursor, facetsOfRows, facetsOfSql, filterHash, nextBatchOf, readBankCursor, upcomingOf } from "./bank.server";
import { bankRowOf } from "./dto.server";
import { cardRow, NOW } from "./test-rows";

const DAY = 86_400_000;

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
    const dues = [at(1), at(1), at(2), at(3), at(3), at(3), at(8), at(9), at(20), new Date(NOW.getTime() - DAY)];
    assert.deepEqual(upcomingOf(dues, NOW, "UTC"), [
      { label: "Tomorrow", n: 2 },
      { label: "Saturday", n: 1 },
      { label: "Sunday", n: 3 },
      { label: "Next week", n: 2 },
    ]);
    assert.equal(upcomingOf([at(1), at(2), at(3), at(4), at(5)], NOW, "UTC").length, 4);
  });

  it("the next batch is labelled in the zone; none when nothing is ahead", () => {
    const due = { dueReview: 0, dueNew: 0, total: 3, nextAt: new Date("2026-11-13T08:00:00Z"), nextBatchAt: new Date("2026-11-13T08:00:00Z"), nextBatch: 3 };
    assert.deepEqual(nextBatchOf(due, "Asia/Kolkata", new Date("2026-11-12T18:00:00Z")), {
      at: "2026-11-13T08:00:00.000Z",
      atLabel: "13:30",
      count: 3,
      whenLabel: "tomorrow at 13:30",
    });
    // The day word is the member's: the same instant is "today" once their local date has turned.
    assert.equal(nextBatchOf(due, "Asia/Kolkata", new Date("2026-11-12T19:00:00Z"))?.whenLabel, "today at 13:30");
    assert.equal(nextBatchOf({ dueReview: 0, dueNew: 0, total: 0, nextAt: null, nextBatchAt: null, nextBatch: 0 }, "UTC", new Date()), null);
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
