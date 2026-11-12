import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUNT_BUCKETS, countBucketOf, reviewClientEvents } from "@repo/analytics";
import { PAGE_STEP, isSearchShortcut, listKeyAction, moveIndex } from "./keys";
import { countBucket, filteredProps, viewedProps } from "./telemetry";

describe("archive keyboard", () => {
  it("moves within bounds and starts at the top when nothing is selected", () => {
    assert.equal(moveIndex(-1, "ArrowDown", 5), 0);
    assert.equal(moveIndex(-1, "ArrowUp", 5), 0);
    assert.equal(moveIndex(0, "ArrowDown", 5), 1);
    assert.equal(moveIndex(4, "ArrowDown", 5), 4);
    assert.equal(moveIndex(0, "ArrowUp", 5), 0);
    assert.equal(moveIndex(3, "Home", 5), 0);
    assert.equal(moveIndex(1, "End", 5), 4);
    assert.equal(moveIndex(0, "PageDown", 30), PAGE_STEP);
    assert.equal(moveIndex(3, "PageUp", 30), 0);
    assert.equal(moveIndex(9, "ArrowDown", 5), 4, "a stale index is clamped");
    assert.equal(moveIndex(0, "ArrowDown", 0), null);
    assert.equal(moveIndex(0, "Tab", 5), null);
  });

  it("Enter opens the review, C opens Compare only when the row has one, F focuses the search", () => {
    assert.deepEqual(listKeyAction({ key: "Enter" }, 2, 5, false), { type: "open", target: "review" });
    assert.equal(listKeyAction({ key: "Enter" }, -1, 5, false), null);
    assert.deepEqual(listKeyAction({ key: "c" }, 2, 5, true), { type: "open", target: "compare" });
    assert.deepEqual(listKeyAction({ key: "C", shiftKey: true }, 2, 5, true), { type: "open", target: "compare" });
    assert.equal(listKeyAction({ key: "c" }, 2, 5, false), null);
    assert.deepEqual(listKeyAction({ key: "f" }, 2, 5, false), { type: "search" });
    assert.deepEqual(listKeyAction({ key: "End" }, 0, 5, false), { type: "move", index: 4 });
  });

  it("leaves modified keys to the shell and the browser", () => {
    assert.equal(listKeyAction({ key: "c", metaKey: true }, 2, 5, true), null);
    assert.equal(listKeyAction({ key: "ArrowDown", altKey: true }, 2, 5, true), null);
    assert.equal(listKeyAction({ key: "f", ctrlKey: true }, 2, 5, true), null);
  });

  it("the page-level F skips text fields, dialogs and the listbox (which handles it itself)", () => {
    const el = (closest: string | null) => ({ isContentEditable: false, closest: (s: string) => (closest && s.includes(closest) ? {} : null) });
    assert.ok(isSearchShortcut({ key: "f", target: el(null) as unknown as EventTarget }));
    assert.ok(!isSearchShortcut({ key: "f", target: el("input") as unknown as EventTarget }));
    assert.ok(!isSearchShortcut({ key: "f", target: el("[role='dialog']") as unknown as EventTarget }));
    assert.ok(!isSearchShortcut({ key: "f", metaKey: true, target: el(null) as unknown as EventTarget }));
    assert.ok(!isSearchShortcut({ key: "g", target: el(null) as unknown as EventTarget }));
  });
});

describe("archive telemetry", () => {
  it("count buckets equal the registry's", () => {
    for (const n of [0, 1, 2, 9, 10, 29, 30, 99, 100, 5000]) assert.equal(countBucket(n), countBucketOf(n), String(n));
    assert.deepEqual(new Set([0, 1, 5, 20, 50, 200].map(countBucket)), new Set(COUNT_BUCKETS));
  });

  it("props parse against the event registry and never carry the search text", () => {
    const filtered = filteredProps({ q: "tal_fan", result: ["loss"], tc: ["rapid"], moments: true }, 7);
    assert.deepEqual(filtered, { result: ["loss"], tc: ["rapid"], moments: true, q_len: 7, results_bucket: "2-9" });
    reviewClientEvents.games_archive_filtered.parse(filtered);
    assert.ok(!JSON.stringify(filtered).includes("tal"));
    const viewed = viewedProps({ q: "tal", tc: ["blitz", "rapid"] }, 37);
    assert.deepEqual(viewed, { count_bucket: "30-99", filters_active: 2 });
    reviewClientEvents.games_archive_viewed.parse(viewed);
    reviewClientEvents.games_archive_viewed.parse(viewedProps({ q: "ab", result: ["win"], tc: ["blitz"], moments: true }, 0));
  });
});
