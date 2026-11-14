// Property test over 1,000 random card states (phase-05 plan §12.1, testing P5 gap): fixed seed, fuzz on and off,
// the plan's test zones. A state is reached the way real cards are: a random history of grades at random review times.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createScheduler, newCardRow, previewAfterAgain, previewAll, scheduleCard, type CardRow, type GradePreviews } from "./fsrs";
import { GRADE_KEYS } from "./grade";
import { mulberry32 } from "./session";
import { calendarDaysBetween, localDate } from "./tz";

const STATES = 1_000;
const ZONES = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Lord_Howe", "Pacific/Chatham"];
const START = Date.parse("2026-01-01T00:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

interface Sample {
  card: CardRow;
  at: Date;
  tz: string;
  releaseHour: number;
  /** The scheduling prefs (`timeZone`, `releaseHour`) this state is graded with. */
  prefs: { timeZone: string; releaseHour: number };
}

function samples(seed: number): Sample[] {
  const rnd = mulberry32(seed);
  const exact = createScheduler({ fuzz: false });
  const out: Sample[] = [];
  for (let i = 0; i < STATES; i++) {
    const tz = ZONES[Math.floor(rnd() * ZONES.length)]!;
    const releaseHour = 5 + Math.floor(rnd() * 8);
    let at = new Date(START + Math.floor(rnd() * 300 * DAY));
    let card = newCardRow(at);
    const reviews = Math.floor(rnd() * 9);
    for (let k = 0; k < reviews; k++) {
      const grade = GRADE_KEYS[Math.floor(rnd() * 4)]!;
      card = scheduleCard(card, grade, at, { timeZone: tz, releaseHour }, exact).card;
      // Next review: early, on time or late against the due date.
      const due = card.due.getTime();
      const jitter = (rnd() - 0.3) * Math.max(10 * MIN, due - at.getTime());
      at = new Date(Math.max(at.getTime() + MIN, due + jitter));
    }
    out.push({ card, at, tz, releaseHour, prefs: { timeZone: tz, releaseHour } });
  }
  return out;
}

function checkOrder(p: GradePreviews, where: string) {
  assert.ok(p.again.days < p.hard.days, `${where}: Again ${p.again.days} < Hard ${p.hard.days}`);
  assert.ok(p.hard.days <= p.good.days, `${where}: Hard ${p.hard.days} ≤ Good ${p.good.days}`);
  assert.ok(p.good.days <= p.easy.days, `${where}: Good ${p.good.days} ≤ Easy ${p.easy.days}`);
}

for (const fuzz of [false, true]) {
  describe(`FSRS over ${STATES} random card states (fuzz ${fuzz ? "on" : "off"})`, () => {
    const sched = createScheduler({ fuzz });
    const all = samples(fuzz ? 0x5eed_f00d : 0x5eed_0ff0);

    it("orders the intervals Again < Hard ≤ Good ≤ Easy", () => {
      for (const [i, s] of all.entries()) checkOrder(previewAll(s.card, s.at, s.prefs), `state ${i} (${s.card.state}, ${s.tz})`);
    });

    it("never schedules before the review, nor past the 180-day maximum", () => {
      for (const [i, s] of all.entries()) {
        const p = previewAll(s.card, s.at, s.prefs);
        for (const g of GRADE_KEYS) {
          const due = Date.parse(p[g].due);
          assert.ok(due >= s.at.getTime(), `state ${i} ${g}: due ${p[g].due} before ${s.at.toISOString()}`);
          assert.ok(p[g].days <= 180, `state ${i} ${g}: ${p[g].days} days`);
          // Never past the local day that is 180 × 24 h after the review (a DST change can make that 181 local
          // calendar days: 23:30 standard time + 180 × 24 h is 00:30 summer time).
          const span = calendarDaysBetween(localDate(s.at, s.tz), localDate(new Date(due), s.tz));
          const limit = calendarDaysBetween(localDate(s.at, s.tz), localDate(new Date(s.at.getTime() + 180 * DAY), s.tz));
          assert.ok(span <= limit, `state ${i} ${g}: due ${span} local days after the review (limit ${limit})`);
        }
      }
    });

    it("snaps day-or-longer intervals to the release hour on the unsnapped due's local day, and nothing shorter", () => {
      for (const [i, s] of all.entries()) {
        for (const g of GRADE_KEYS) {
          const r = scheduleCard(s.card, g, s.at, s.prefs, sched);
          if (r.scheduledDays >= 1) {
            assert.deepEqual(localDate(r.card.due, s.tz), localDate(r.dueRaw, s.tz), `state ${i} ${g}: snap changed the local day`);
            const local = new Intl.DateTimeFormat("en-GB", { timeZone: s.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(r.card.due);
            assert.equal(local, `${String(s.releaseHour).padStart(2, "0")}:00`, `state ${i} ${g}: not on the release hour`);
            assert.ok(r.card.due.getTime() > s.at.getTime(), `state ${i} ${g}: a snapped due is never earlier than the review`);
          } else {
            assert.equal(r.card.due.getTime(), r.dueRaw.getTime(), `state ${i} ${g}: a sub-day step was snapped`);
          }
        }
      }
    });

    it("previews exactly what grading does", () => {
      for (const [i, s] of all.entries()) {
        const p = previewAll(s.card, s.at, s.prefs, sched);
        for (const g of GRADE_KEYS) {
          assert.equal(scheduleCard(s.card, g, s.at, s.prefs, sched).card.due.toISOString(), p[g].due, `state ${i} ${g}`);
        }
      }
    });

    it("previews the pass-2 copy as previewAll(next(card, Again)) ten minutes later", () => {
      for (const [i, s] of all.entries()) {
        const after = previewAfterAgain(s.card, s.at, s.prefs, sched);
        const again = scheduleCard(s.card, "again", s.at, s.prefs, sched);
        assert.deepEqual(after, previewAll(again.card, new Date(s.at.getTime() + 10 * MIN), s.prefs, sched), `state ${i}`);
      }
    });
  });
}
