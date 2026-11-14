// session.ts: composition per kind, the due queue order, the cap, puzzle selection (window, widening, mix fallback,
// exclusions, due interleave, warm-up order), extend numbering and replays, re-queue, practice (phase-05 plan §8.6,
// §7.3 W2/W3, §12.1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { newCardRow, retrievability, type CardRow } from "./fsrs";
import {
  bandsInWindow,
  buildSession,
  displayWindow,
  extendItems,
  interleaveDue,
  itemsAfter,
  nextItemIds,
  orderDueQueue,
  puzzleBand,
  puzzleWindow,
  queueLabel,
  requeueAfterAgain,
  requeueIndex,
  seedOf,
  selectPuzzles,
  takeUnderCap,
  type BankCardIn,
  type PuzzleCardIn,
  type PuzzlePick,
  type PuzzleTuple,
} from "./session";

const NOW = new Date("2026-11-12T19:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function review(key: string, stability: number, lastReviewDaysAgo: number, dueDaysAgo = 0): BankCardIn {
  const card: CardRow = {
    due: ago(dueDaysAgo),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: Math.max(1, Math.round(lastReviewDaysAgo - dueDaysAgo)),
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: "REVIEW",
    lastReview: ago(lastReviewDaysAgo),
  };
  return { key, kind: "MISTAKE", card, lastPlayedAt: ago(30) };
}

function fresh(key: string, playedDaysAgo: number): BankCardIn {
  return { key, kind: "REVIEW_POSITION", card: newCardRow(ago(1)), lastPlayedAt: ago(playedDaysAgo) };
}

describe("the BANK due queue", () => {
  it("orders review cards by retrievability ascending, then NEW cards newest game first", () => {
    const cards = [fresh("n_old", 9), review("r_strong", 30, 10), fresh("n_new", 1), review("r_weak", 2, 10), review("r_mid", 5, 10), fresh("n_mid", 4)];
    const order = orderDueQueue(cards, NOW).map((c) => c.key);
    assert.deepEqual(order, ["r_weak", "r_mid", "r_strong", "n_new", "n_mid", "n_old"]);
    const rs = ["r_weak", "r_mid", "r_strong"].map((k) => retrievability(cards.find((c) => c.key === k)!.card, NOW));
    assert.ok(rs[0]! < rs[1]! && rs[1]! < rs[2]!);
  });

  it("breaks retrievability ties by the older due date, then the key", () => {
    const a = review("b", 4, 10, 1);
    const b = review("a", 4, 10, 3);
    const c = review("c", 4, 10, 3);
    assert.deepEqual(
      orderDueQueue([a, c, b], NOW).map((x) => x.key),
      ["a", "c", "b"],
    );
  });

  it("drops cards that are not due yet", () => {
    const later = review("later", 4, 1, -2);
    assert.deepEqual(orderDueQueue([later, review("now", 4, 5)], NOW).map((c) => c.key), ["now"]);
  });

  it("takes reviews first, NEW cards up to newRemaining, all under min(capRemaining, 20)", () => {
    const q = orderDueQueue([fresh("n1", 1), fresh("n2", 2), fresh("n3", 3), review("r1", 2, 10), review("r2", 3, 10)], NOW);
    assert.deepEqual(takeUnderCap(q, { capRemaining: 10, newRemaining: 2 }).map((c) => c.key), ["r1", "r2", "n1", "n2"]);
    assert.deepEqual(takeUnderCap(q, { capRemaining: 3, newRemaining: 2 }).map((c) => c.key), ["r1", "r2", "n1"]);
    assert.deepEqual(takeUnderCap(q, { capRemaining: 0, newRemaining: 2 }), []);
    const many = orderDueQueue(Array.from({ length: 30 }, (_, i) => review(`r${String(i).padStart(2, "0")}`, 2 + i, 40)), NOW);
    assert.equal(takeUnderCap(many, { capRemaining: 30, newRemaining: 5 }).length, 20);
  });
});

describe("buildSession: bank", () => {
  const due = [review("r1", 2, 10), review("r2", 6, 10), fresh("n1", 1), fresh("n2", 2)];

  it("builds the due queue under the cap, counting toward it, with previews", () => {
    const s = buildSession("bank", { mode: "due", now: NOW, dueCards: due, capRemaining: 10, newRemaining: 1, filtered: false, dueRaw: 4 });
    assert.equal(s.kind, "bank");
    assert.equal(s.countsTowardCap, true);
    assert.deepEqual(s.items.map((i) => [i.itemId, i.key, i.kind, i.pass, i.previews]), [
      ["i1", "r1", "MISTAKE", 1, true],
      ["i2", "r2", "MISTAKE", 1, true],
      ["i3", "n1", "REVIEW_POSITION", 1, true],
    ]);
    assert.equal(s.empty, null);
  });

  it("puts a hub thumbnail's card first", () => {
    const s = buildSession("bank", { mode: "due", now: NOW, dueCards: due, capRemaining: 10, newRemaining: 2, firstKey: "n2", filtered: false, dueRaw: 4 });
    assert.deepEqual(s.items.map((i) => i.key), ["n2", "r1", "r2", "n1"]);
  });

  it("answers an empty session with the reason: cap reached, nothing matches the filter, caught up", () => {
    const cap = buildSession("bank", { mode: "due", now: NOW, dueCards: due, capRemaining: 0, newRemaining: 0, filtered: false, dueRaw: 4 });
    assert.deepEqual([cap.items.length, cap.empty], [0, "cap_reached"]);
    const none = buildSession("bank", { mode: "due", now: NOW, dueCards: [], capRemaining: 10, newRemaining: 5, filtered: true, dueRaw: 4 });
    assert.equal(none.empty, "nothing_matches");
    const done = buildSession("bank", { mode: "due", now: NOW, dueCards: [], capRemaining: 10, newRemaining: 5, filtered: false, dueRaw: 0 });
    assert.equal(done.empty, "caughtup");
  });

  it("drills the listed cards in list order without the cap ('Drill these n'), and explicit picks as given", () => {
    const list = buildSession("bank", { mode: "list", cards: [due[3]!, due[0]!] });
    assert.deepEqual(list.items.map((i) => i.key), ["n2", "r1"]);
    assert.equal(list.countsTowardCap, false);
    const picks = buildSession("bank", { mode: "explicit", cards: Array.from({ length: 25 }, (_, i) => review(`k${i}`, 3, 5)) });
    assert.equal(picks.items.length, 20, "explicit picks stop at 20");
    assert.equal(picks.countsTowardCap, false);
    assert.equal(picks.items[0]!.key, "k0");
    assert.equal(buildSession("bank", { mode: "explicit", cards: [] }).empty, "nothing_matches");
  });
});

// A fake shard set: `theme/band` → tuples rated band*100 … band*100+99.
function shards(spec: Record<string, number>): (theme: string, band: number) => readonly PuzzleTuple[] | undefined {
  return (theme, band) => {
    const n = spec[`${theme}/${band}`];
    if (n === undefined) return undefined;
    return Array.from({ length: n }, (_, i) => [`${theme.slice(0, 3)}${band}x${i}`.slice(0, 8).padEnd(5, "0"), "8/8/8/8/8/8/8/8 w - - 0 1", "a1a2 a2a3", band * 100 + ((i * 7) % 100), 1] as const);
  };
}

const full: Record<string, number> = {};
for (let b = 6; b <= 25; b++) {
  full[`fork/${b}`] = 40;
  full[`mix/${b}`] = 40;
}

describe("puzzle selection", () => {
  it("windows the rating at [R − 100, R + 150] and widens by ±100 per step", () => {
    assert.deepEqual(puzzleWindow(1512, 0), { from: 1412, to: 1662 });
    assert.deepEqual(puzzleWindow(1512, 2), { from: 1212, to: 1862 });
    assert.equal(puzzleBand(1512), 15);
    assert.equal(puzzleBand(400), 6);
    assert.equal(puzzleBand(2900), 25);
    assert.deepEqual(bandsInWindow({ from: 1412, to: 1662 }), [14, 15, 16]);
    assert.deepEqual(displayWindow({ from: 1312, to: 1762 }), { from: 1300, to: 1800 });
  });

  it("serves 10 new puzzles inside the window, rating ascending, deterministic for a seed", async () => {
    const input = { rating: 1512, theme: "fork", excludeIds: new Set<string>(), loadBand: shards(full), seed: 7 };
    const pick = await selectPuzzles(input);
    assert.equal(pick.items.length, 10);
    assert.equal(pick.theme, "fork");
    assert.equal(pick.widened, null);
    const ratings = pick.items.map((p) => (p.source === "shard" ? p.puzzle[3] : -1));
    assert.ok(ratings.every((r) => r >= 1412 && r <= 1662), ratings.join(","));
    assert.deepEqual(ratings, [...ratings].sort((a, b) => a - b));
    assert.deepEqual(await selectPuzzles(input), pick, "same seed, same batch");
    const other = await selectPuzzles({ ...input, seed: 8 });
    assert.notDeepEqual(other.items, pick.items, "another seed samples differently");
  });

  it("excludes recently attempted ids and ids already in the session", async () => {
    const all = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: new Set(), loadBand: shards({ "fork/14": 6, "fork/15": 6, "fork/16": 6 }), seed: 1, count: 18 });
    const ids = all.items.map((p) => (p.source === "shard" ? p.puzzle[0] : ""));
    const recent = new Set(ids.slice(0, 5));
    const inSession = new Set(ids.slice(5, 8));
    const again = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: recent, sessionIds: inSession, loadBand: shards(full), seed: 1, count: 10 });
    for (const p of again.items) {
      const id = p.source === "shard" ? p.puzzle[0] : p.card.puzzleId;
      assert.ok(!recent.has(id) && !inSession.has(id), id);
    }
  });

  it("interleaves due PUZZLE cards at every third slot, at most 30 % of the batch", async () => {
    const dueCards: PuzzleCardIn[] = Array.from({ length: 5 }, (_, i) => ({ key: `p_due0${i}`, puzzleId: `due0${i}`, rating: 1500, due: ago(5 - i) }));
    const pick = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: new Set(), dueCards, loadBand: shards(full), seed: 3 });
    assert.equal(pick.items.length, 10);
    const slots = pick.items.flatMap((p, i) => (p.source === "card" ? [i] : []));
    assert.deepEqual(slots, [2, 5, 8]);
    assert.deepEqual(
      pick.items.filter((p) => p.source === "card").map((p) => (p.source === "card" ? p.card.key : "")),
      ["p_due00", "p_due01", "p_due02"],
      "most overdue first",
    );
    const ratings = pick.items.flatMap((p) => (p.source === "shard" ? [p.puzzle[3]] : []));
    assert.deepEqual(ratings, [...ratings].sort((a, b) => a - b));
  });

  it("widens the window until 15 candidates remain and reports it", async () => {
    // Only 4 puzzles a band near 1512, so the theme needs two more bands each side.
    const sparse: Record<string, number> = {};
    for (let b = 6; b <= 25; b++) sparse[`fork/${b}`] = 4;
    const pick = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: new Set(), loadBand: shards(sparse), seed: 2 });
    assert.equal(pick.theme, "fork");
    assert.notEqual(pick.widened, null);
    assert.ok(pick.window.from < 1412 && pick.window.to > 1662);
    assert.equal(pick.items.length, 10);
  });

  it("falls back to mix (widened) when the theme has too few puzzles", async () => {
    const pick = await selectPuzzles({ rating: 1512, theme: "pawnEndgame", excludeIds: new Set(), loadBand: shards({ ...full, "pawnEndgame/15": 3 }), seed: 2 });
    assert.equal(pick.theme, "mix");
    assert.deepEqual(pick.widened, displayWindow(puzzleWindow(1512, 0)));
    assert.equal(pick.items.length, 10);
  });

  it("keeps the theme's own (widened) pool when even mix runs dry", async () => {
    const pick = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: new Set(), loadBand: shards({ "fork/15": 2 }), seed: 2 });
    assert.equal(pick.theme, "fork");
    assert.equal(pick.items.length, 2);
    assert.deepEqual(pick.widened, displayWindow(puzzleWindow(1512, 4)));
    const none = await selectPuzzles({ rating: 1512, theme: "fork", excludeIds: new Set(), loadBand: shards({}), seed: 2 });
    assert.equal(none.items.length, 0);
  });

  it("interleaves leftover due cards at the end when new puzzles run out", () => {
    assert.deepEqual(interleaveDue(["a", "b"], ["X", "Y", "Z"]), ["a", "b", "X", "Y", "Z"]);
    assert.deepEqual(interleaveDue(["a", "b", "c", "d"], ["X"]), ["a", "b", "X", "c", "d"]);
  });

  it("seeds from text", () => {
    assert.equal(seedOf("abc"), seedOf("abc"));
    assert.notEqual(seedOf("abc"), seedOf("abd"));
  });
});

describe("buildSession: puzzles, daily, practice, extend", () => {
  const pick: PuzzlePick = {
    items: [
      { source: "shard", puzzle: ["00Aas", "fen", "a1a2 a2a3", 1400, 1] },
      { source: "shard", puzzle: ["00BJm", "fen", "a1a2 a2a3", 1450, 1] },
      { source: "card", card: { key: "p_00Evs", puzzleId: "00Evs", rating: 1500, due: ago(1) } },
    ],
    theme: "fork",
    window: { from: 1412, to: 1662 },
    widened: null,
  };

  it("streams a puzzle session unless a count is given", () => {
    const s = buildSession("puzzles", { pick });
    assert.equal(s.stream, true);
    assert.equal(s.targetCount, null);
    assert.equal(s.countsTowardCap, false);
    assert.deepEqual(s.items.map((i) => [i.itemId, i.key, i.kind, Boolean(i.puzzle)]), [
      ["i1", "p_00Aas", "LICHESS_PUZZLE", true],
      ["i2", "p_00BJm", "LICHESS_PUZZLE", true],
      ["i3", "p_00Evs", "LICHESS_PUZZLE", false],
    ]);
    const fixed = buildSession("puzzles", { pick, count: 3 });
    assert.deepEqual([fixed.stream, fixed.targetCount], [false, 3]);
    assert.equal(buildSession("puzzles", { pick: { ...pick, items: [] } }).empty, "nothing_matches");
  });

  it("builds DAILY from the frozen plan keys still due, then the plan's puzzles", () => {
    const dueCards = [review("m_a", 2, 10), review("m_b", 3, 10), review("m_c", 9, 10)];
    const s = buildSession("daily", { now: NOW, frozenKeys: ["m_c", "m_gone", "m_a"], dueCards, capRemaining: 10, newRemaining: 5, puzzles: pick });
    assert.deepEqual(s.items.map((i) => i.key), ["m_c", "m_a", "p_00Aas", "p_00BJm", "p_00Evs"]);
    assert.equal(s.countsTowardCap, true);
    assert.equal(s.theme, "fork");
    const capped = buildSession("daily", { now: NOW, frozenKeys: ["m_c", "m_a"], dueCards, capRemaining: 1, newRemaining: 5, puzzles: null });
    assert.deepEqual(capped.items.map((i) => i.key), ["m_c"]);
    const unplanned = buildSession("daily", { now: NOW, frozenKeys: null, dueCards, capRemaining: 2, newRemaining: 5, puzzles: null });
    assert.deepEqual(unplanned.items.map((i) => i.key), ["m_a", "m_b"]);
    const empty = buildSession("daily", { now: NOW, frozenKeys: ["m_x"], dueCards: [], capRemaining: 10, newRemaining: 5, puzzles: null });
    assert.equal(empty.empty, "caughtup");
  });

  it("makes PRACTICE items without previews, once per key (pass-2 copies dropped)", () => {
    const s = buildSession("practice", {
      from: [
        { key: "m_a", kind: "MISTAKE", pass: 1 },
        { key: "m_b", kind: "REVIEW_POSITION", pass: 1 },
        { key: "m_a", kind: "MISTAKE", pass: 2 },
        { key: "p_00Aas", kind: "LICHESS_PUZZLE", pass: 1, puzzle: ["00Aas", "fen", "a1a2 a2a3", 1400, 1] },
      ],
    });
    assert.deepEqual(s.items.map((i) => [i.itemId, i.key, i.previews]), [
      ["i1", "m_a", false],
      ["i2", "m_b", false],
      ["i3", "p_00Aas", false],
    ]);
    assert.ok(s.items[2]!.puzzle);
    assert.equal(s.countsTowardCap, false);
  });

  it("numbers extend items after the existing ones and replays return the same items", () => {
    const existing = [...nextItemIds([], 10).map((itemId) => ({ itemId, pass: 1 as const })), { itemId: "i3b", pass: 2 as const }];
    const added = extendItems(existing, pick);
    assert.deepEqual(added.map((i) => i.itemId), ["i11", "i12", "i13"]);
    const all = [...existing, ...added];
    assert.deepEqual(itemsAfter(all, "i10").map((i) => i.itemId), ["i11", "i12", "i13"]);
    assert.deepEqual(itemsAfter(all, "i13"), []);
  });

  it("re-exports the re-queue rule (min(i + 4, length), one copy, never twice)", () => {
    assert.equal(requeueIndex(2, 5), 5);
    const items = nextItemIds([], 5).map((itemId) => ({ itemId, pass: 1 as const }));
    const r = requeueAfterAgain(items, 0, (x) => x);
    assert.deepEqual(r.items.map((i) => i.itemId), ["i1", "i2", "i3", "i4", "i1b", "i5"]);
    assert.equal(requeueAfterAgain(r.items, 4, (x) => x).requeued, false);
  });

  it("labels the queue", () => {
    assert.equal(queueLabel("tal_fan_77", 17, "Recapture first"), "tal_fan_77 · move 17 · Recapture first");
  });
});
