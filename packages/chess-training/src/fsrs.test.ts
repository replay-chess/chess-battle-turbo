// fsrs.ts: the configuration and its golden values, measured with ts-fsrs 5.4.2 (phase-05 plan §8.2, §12.1; D-7, D-8).
// "±0 with fuzz off": a ts-fsrs upgrade that moves one of these numbers must re-measure and update this file.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { default_w, get_fuzz_range } from "ts-fsrs";
import {
  createScheduler,
  dayClock,
  fromFsrsCard,
  MAXIMUM_INTERVAL,
  newCardRow,
  PARAMS,
  previewAfterAgain,
  previewAll,
  retrievability,
  scheduleCard,
  toFsrsCard,
  W,
  type CardRow,
} from "./fsrs";
import { intervalLabel } from "./labels";

const NOW = new Date("2026-11-05T19:00:00.000Z");
const UTC = { timeZone: "UTC", releaseHour: 8 };
const exact = createScheduler({ fuzz: false });
const fallback = createScheduler({ fuzz: false, steps: "default-steps" });
const DAY = 86_400_000;
const MIN = 60_000;

const daysFrom = (iso: string, from: Date) => (Date.parse(iso) - from.getTime()) / DAY;

describe("configuration", () => {
  it("raises the initial stabilities Hard/Good/Easy to 2/4/9 days and keeps the rest of default_w", () => {
    assert.equal(W.length, default_w.length);
    assert.equal(W[0], default_w[0]);
    assert.deepEqual([W[1], W[2], W[3]], [2, 4, 9]);
    assert.deepEqual(W.slice(4), [...default_w].slice(4));
  });

  it("uses retention 0.9, a 180-day maximum, fuzz and short-term steps of 10 minutes", () => {
    assert.equal(PARAMS.request_retention, 0.9);
    assert.equal(PARAMS.maximum_interval, 180);
    assert.equal(MAXIMUM_INTERVAL, 180);
    assert.equal(PARAMS.enable_fuzz, true);
    assert.equal(PARAMS.enable_short_term, true);
    assert.deepEqual([...PARAMS.learning_steps], ["10m"]);
    assert.deepEqual([...PARAMS.relearning_steps], ["10m"]);
  });
});

describe("golden values (fuzz off)", () => {
  it("previews a new card as Again 10 min · Hard 2 days · Good 4 days · Easy 9 days (the again-only strategy)", () => {
    const p = previewAll(newCardRow(NOW), NOW, UTC, exact);
    assert.deepEqual(
      Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.label])),
      { again: "< 10 min", hard: "2 days", good: "4 days", easy: "9 days" },
    );
    assert.equal(p.again.due, new Date(NOW.getTime() + 10 * MIN).toISOString(), "Again is a 10-minute step, unsnapped");
    assert.deepEqual([p.hard.days, p.good.days, p.easy.days], [2, 4, 9]);
    // Snapped to 08:00 on the same calendar day as reviewedAt + n days.
    assert.equal(p.hard.due, "2026-11-07T08:00:00.000Z");
    assert.equal(p.good.due, "2026-11-09T08:00:00.000Z");
    assert.equal(p.easy.due, "2026-11-14T08:00:00.000Z");
  });

  it("gives Hard 15 min with the fallback strategy (D-8: ts-fsrs's own steps)", () => {
    const p = previewAll(newCardRow(NOW), NOW, UTC, fallback);
    assert.equal(p.again.label, "< 10 min");
    assert.equal(p.hard.label, "15 min");
    assert.equal(p.hard.due, new Date(NOW.getTime() + 15 * MIN).toISOString());
    assert.equal(p.good.label, "4 days");
    assert.equal(p.easy.label, "9 days");
  });

  it("reviews a Good card on its due day at Hard 13 / Good 19 / Easy 32 days", () => {
    const good = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    assert.equal(good.scheduledDays, 4);
    const at = good.dueRaw; // the unsnapped due: 4 × 24 h after the first review
    const p = previewAll(good.card, at, UTC, exact);
    assert.deepEqual([p.hard.days, p.good.days, p.easy.days], [13, 19, 32]);
    assert.equal(p.again.label, "< 10 min");
    assert.deepEqual([p.hard.label, p.good.label, p.easy.label], ["13 days", "3 weeks", "5 weeks"]);
  });

  it("sends a lapse to RELEARNING with a 10-minute step", () => {
    const good = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    const lapse = scheduleCard(good.card, "again", good.dueRaw, UTC, exact);
    assert.equal(lapse.card.state, "RELEARNING");
    assert.equal(lapse.card.lapses, 1);
    assert.equal(lapse.scheduledDays, 0);
    assert.equal(lapse.card.due.getTime() - good.dueRaw.getTime(), 10 * MIN);
    assert.equal(lapse.mastery, 0);
  });

  it("graduates a relearning card on Hard/Good/Easy (no second step) and snaps it", () => {
    const good = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    const lapse = scheduleCard(good.card, "again", good.dueRaw, UTC, exact);
    const back = scheduleCard(lapse.card, "good", lapse.card.due, UTC, exact);
    assert.equal(back.card.state, "REVIEW");
    assert.ok(back.scheduledDays >= 1);
    assert.equal(back.card.due.toISOString().slice(11), "08:00:00.000Z");
  });

  it("previews the pass-2 copy after an Again as the card Again leaves, graded 10 minutes later", () => {
    const card = newCardRow(NOW);
    const after = previewAfterAgain(card, NOW, UTC, exact);
    const again = scheduleCard(card, "again", NOW, UTC, exact);
    const direct = previewAll(again.card, new Date(NOW.getTime() + 10 * MIN), UTC, exact);
    assert.deepEqual(after, direct);
    assert.equal(after.again.label, "< 10 min");
    assert.deepEqual([after.hard.label, after.good.label, after.easy.label], ["1 day", "1 day", "1 day"]);
  });

  it("caps every interval at 180 days", () => {
    let card: CardRow = newCardRow(NOW);
    let at = NOW;
    for (let i = 0; i < 12; i++) {
      const s = scheduleCard(card, "easy", at, UTC, exact);
      assert.ok(s.scheduledDays <= 180, `review ${i}: ${s.scheduledDays} days`);
      card = s.card;
      at = s.dueRaw;
    }
    assert.equal(card.scheduledDays, 180, "a long run of Easy reaches the cap");
    assert.equal(previewAll(card, at, UTC, exact).easy.label, "6 months");
  });

  it("enforces the cap where ts-fsrs alone overshoots it (Good/Easy are pushed a day past Hard)", () => {
    let card: CardRow = newCardRow(NOW);
    let at = NOW;
    let rawMax = 0;
    for (let i = 0; i < 6; i++) {
      const raw = exact.repeat(toFsrsCard(card), at);
      rawMax = Math.max(rawMax, ...[2, 3, 4].map((g) => raw[g as 2 | 3 | 4].card.scheduled_days));
      const p = previewAll(card, at, UTC, exact);
      for (const g of ["hard", "good", "easy"] as const) assert.ok(p[g].days <= 180, `${g} ${p[g].days}`);
      const s = scheduleCard(card, "easy", at, UTC, exact);
      card = s.card;
      at = s.dueRaw;
    }
    assert.ok(rawMax > 180, `ts-fsrs 5.4.2 reaches ${rawMax} days on its own`);
  });
});

describe("fuzz", () => {
  it("stays inside ts-fsrs's fuzz range for review intervals", () => {
    const fuzzy = createScheduler({ fuzz: true });
    const good = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    for (let k = 0; k < 50; k++) {
      const at = new Date(good.dueRaw.getTime() + k * 3_600_000);
      const plain = previewAll(good.card, at, UTC, exact);
      const fuzzed = previewAll(good.card, at, UTC, fuzzy);
      const elapsed = Math.floor((at.getTime() - NOW.getTime()) / DAY);
      for (const g of ["good", "easy"] as const) {
        const { min_ivl, max_ivl } = get_fuzz_range(plain[g].days, elapsed, 180);
        assert.ok(fuzzed[g].days >= min_ivl && fuzzed[g].days <= max_ivl, `${g} ${fuzzed[g].days} outside [${min_ivl}, ${max_ivl}]`);
      }
    }
  });

  it("is deterministic for the same card and instant", () => {
    const a = previewAll(newCardRow(NOW), NOW, UTC);
    const b = previewAll(newCardRow(NOW), NOW, UTC);
    assert.deepEqual(a, b);
  });

  // FIX-1 fuzz: the buttons show the interval the grade schedules. The session is built, then each review card is
  // graded 45–58 s later (the reviewer's probe: 516 of 600 Hard/Good/Easy grades landed on another day before).
  it("a grade schedules the due its preview showed, though it runs seconds after the preview", () => {
    const first = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    let n = 0;
    for (let k = 0; k < 200; k++) {
      const card: CardRow = { ...first.card, fuzzKey: `m_card${String(k).padStart(7, "0")}` };
      const built = new Date(first.dueRaw.getTime() + k * 7_919);
      const graded = new Date(built.getTime() + 45_000 + (k % 13) * 1_000);
      const shown = previewAll(card, built, UTC);
      for (const g of ["hard", "good", "easy"] as const) {
        assert.equal(scheduleCard(card, g, graded, UTC).card.due.toISOString(), shown[g].due, `card ${k} ${g}`);
        n++;
      }
    }
    assert.equal(n, 600);
  });

  it("FIX-2: built at 23:55Z and graded at 00:05Z (US evening), the grade still schedules the previewed due (training-day clock)", () => {
    // The reviewer's p2: America/Los_Angeles, a card due Nov 8, the session built at 23:55Z, graded 10 minutes later.
    const LA = { timeZone: "America/Los_Angeles", releaseHour: 8, dayStartHour: 4 };
    const reviewed = new Date("2026-11-04T18:00:00.000Z");
    const first = scheduleCard(newCardRow(reviewed), "good", reviewed, LA, exact);
    let n = 0;
    for (let k = 0; k < 200; k++) {
      const card: CardRow = { ...first.card, fuzzKey: `m_eve${String(k).padStart(8, "0")}` };
      const built = new Date("2026-11-08T23:55:00.000Z");
      const graded = new Date("2026-11-09T00:05:00.000Z");
      const shown = previewAll(card, built, LA);
      for (const g of ["hard", "good", "easy"] as const) {
        assert.equal(scheduleCard(card, g, graded, LA).card.due.toISOString(), shown[g].due, `card ${k} ${g}`);
        n++;
      }
    }
    assert.equal(n, 600);
    // Across the member's own day start (04:00 local) the training day changes, and so may the interval: that boundary
    // is the one the member sees (the cap, the streak and the plan roll over there too).
    assert.equal(dayClock(new Date("2026-11-09T11:59:00.000Z"), LA).toISOString().slice(0, 10), "2026-11-08", "03:59 local is still Nov 8's training day");
    assert.equal(dayClock(new Date("2026-11-09T12:01:00.000Z"), LA).toISOString().slice(0, 10), "2026-11-09");
  });

  it("the pass-2 copy's previews are what grading it does after the Again", () => {
    const first = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    const card: CardRow = { ...first.card, fuzzKey: "m_card0000042" };
    const built = new Date(first.dueRaw.getTime() + 3 * 3_600_000);
    const shown = previewAfterAgain(card, built, UTC);
    const again = scheduleCard(card, "again", new Date(built.getTime() + 30_000), UTC);
    assert.equal(again.card.fuzzKey, "m_card0000042", "a graded card keeps its fuzz identity");
    const pass2At = new Date(built.getTime() + 11 * MIN);
    for (const g of ["hard", "good", "easy"] as const) {
      assert.equal(scheduleCard(again.card, g, pass2At, UTC).card.due.toISOString(), shown[g].due, g);
    }
  });

  it("different cards in the same state still spread (the key is part of the seed)", () => {
    const first = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    const at = new Date(first.dueRaw.getTime() + 3_600_000);
    const days = new Set<number>();
    for (let k = 0; k < 40; k++) days.add(previewAll({ ...first.card, fuzzKey: `m_spread${k}` }, at, UTC).good.days);
    assert.ok(days.size > 1, `one interval for 40 cards: ${[...days].join(",")}`);
  });
});

describe("rows, mastery and retrievability", () => {
  it("round-trips a row through the ts-fsrs card", () => {
    const s = scheduleCard(newCardRow(NOW), "hard", NOW, UTC, exact);
    assert.deepEqual(fromFsrsCard(toFsrsCard(s.card)), s.card);
    assert.equal(newCardRow(NOW).state, "NEW");
    assert.equal(newCardRow(NOW).lastReview, null);
  });

  it("returns the new row with the snapped due, the raw due and the mastery dots", () => {
    const s = scheduleCard(newCardRow(NOW), "easy", NOW, UTC, exact);
    assert.equal(s.card.state, "REVIEW");
    assert.equal(s.card.reps, 1);
    assert.equal(s.stateBefore, "NEW");
    assert.equal(s.dueRaw.toISOString(), "2026-11-14T19:00:00.000Z");
    assert.equal(s.card.due.toISOString(), "2026-11-14T08:00:00.000Z");
    assert.equal(s.mastery, 2, "stability 9 → 2 dots");
    assert.equal(daysFrom(s.card.due.toISOString(), NOW) < 9, true, "snapping to 08:00 on the due day can come earlier than the raw time");
  });

  it("orders retrievability: NEW is 0, recall falls as time passes", () => {
    assert.equal(retrievability(newCardRow(NOW), NOW), 0);
    const s = scheduleCard(newCardRow(NOW), "good", NOW, UTC, exact);
    const r1 = retrievability(s.card, new Date(NOW.getTime() + 1 * DAY), exact);
    const r4 = retrievability(s.card, new Date(NOW.getTime() + 4 * DAY), exact);
    const r20 = retrievability(s.card, new Date(NOW.getTime() + 20 * DAY), exact);
    assert.ok(r1 > r4 && r4 > r20 && r20 > 0, `${r1} > ${r4} > ${r20}`);
    assert.ok(Math.abs(r4 - 0.9) < 0.01, "recall is ~90 % at the scheduled interval (retention 0.9)");
  });
});

describe("preview labels", () => {
  it("formats the interval labels the plan lists", () => {
    assert.equal(intervalLabel(10 / 1440), "< 10 min");
    assert.equal(intervalLabel(1), "1 day");
    assert.equal(intervalLabel(4), "4 days");
    assert.equal(intervalLabel(14), "2 weeks");
    assert.equal(intervalLabel(90), "3 months");
  });
});
