// Home copy (phase-05 plan §4.1): every string is built from HomeData, for every board state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeFixture } from "@repo/contracts/http/fixtures/p05";
import { HomeData } from "@repo/contracts/http/home";
import {
  analysingLine,
  bankCountLabel,
  bankCta,
  bankLine,
  bankMinutes,
  continueBoardLabel,
  continueSentence,
  etaLabel,
  gamesThisWeekLabel,
  greetingText,
  homeViewState,
  importLabel,
  importSub,
  nothingDueLine,
  recentSub,
  reviewHref,
  thumbHref,
  weekLine,
} from "./copy";

const populated = homeFixture("populated");
const fresh = homeFixture("new_user");

test("the fixtures are contract-valid (the demo route renders these)", () => {
  for (const s of ["populated", "new_user", "import_running", "analysing", "clean", "nothing_due", "stress"] as const) {
    assert.equal(HomeData.safeParse(homeFixture(s)).success, true, s);
  }
});

test("greeting and the header stat", () => {
  assert.equal(greetingText(populated), "Good evening, knightowl_88.");
  assert.equal(greetingText({ ...populated, greeting: { part: "morning", name: "ana" } }), "Good morning, ana.");
  assert.equal(greetingText(fresh), "Welcome, knightowl_88.");
  assert.equal(gamesThisWeekLabel(4), "4 games this week");
  assert.equal(gamesThisWeekLabel(1), "1 game this week");
  assert.equal(gamesThisWeekLabel(0), "0 games this week");
});

test("the view state: import_running wins, else the data state", () => {
  assert.equal(homeViewState(populated), "populated");
  assert.equal(homeViewState(fresh), "new_user");
  assert.equal(homeViewState(homeFixture("import_running")), "import_running");
  assert.equal(homeViewState({ ...fresh, import: { provider: "lichess", imported: 0, total: null, etaSec: null } }), "import_running");
});

test("Continue: the moments sentence and the board label (V3Home populated)", () => {
  const c = populated.continue!;
  assert.equal(
    continueSentence(c),
    "Two Knights Defence vs tal_fan_77 (1203). You lost on move 28. The coach found 3 moments; the first is on the board.",
  );
  assert.equal(continueBoardLabel(c), "Your game vs tal_fan_77, before move 19. White to move.");
  assert.equal(continueSentence({ ...c, keyMomentCount: 1 }).endsWith("The coach found 1 moment; it is on the board."), true);
  assert.equal(continueSentence({ ...c, openingName: null, opponentRating: null, result: "win" }).startsWith("Your game vs tal_fan_77. You won on move 28."), true);
  assert.equal(continueSentence({ ...c, result: "draw" }).includes("Drawn on move 28."), true);
});

test("Continue: analysing counts moves, clean shows the accuracy", () => {
  const a = homeFixture("analysing").continue!;
  assert.equal(analysingLine(a.analysis), "Analysing · 7 of 19 moves");
  assert.equal(analysingLine({ status: "queued", done: 0, total: 0 }), "Analysing · queued");
  assert.match(continueSentence(a), /You lost on move 28\. Analysing · 7 of 19 moves\.$/);
  const c = homeFixture("clean").continue!;
  assert.match(continueSentence(c), /You won on move 34\. Clean game · accuracy 92\.$/);
  assert.equal(continueBoardLabel(c), "Your game vs tal_fan_77, final position. Black to move.");
  assert.match(continueSentence({ ...c, accuracy: null }), /Clean game\.$/);
});

test("Mistake Bank card: line, count, CTA and thumbnails", () => {
  assert.equal(bankCountLabel(4), "4 due");
  assert.equal(bankLine(populated.bank, false), "Loose pieces is your most common theme (7 in bank).");
  assert.equal(bankLine(fresh.bank, true), "Mistakes from your games land here as puzzles.");
  assert.equal(bankLine({ ...populated.bank, topTheme: null }, false), "23 positions in your bank.");
  const none = homeFixture("nothing_due").bank;
  assert.equal(bankLine(none, false), "Nothing due. Next batch tomorrow at 08:00.");
  // A payload without the day (an older build) still reads well.
  assert.equal(nothingDueLine({ nextBatch: { ...none.nextBatch!, whenLabel: undefined } }), "Nothing due. Next batch at 08:00.");
  assert.equal(nothingDueLine({ nextBatch: null }), "Nothing due.");
  assert.deepEqual(bankCta(populated.bank, false), { label: "Review 4 · About 3 min", href: "/train/bank/session", kind: "review" });
  assert.deepEqual(bankCta(none, false), { label: "Open Mistake Bank", href: "/train/bank", kind: "open" });
  assert.deepEqual(bankCta(fresh.bank, true), { label: "How It Works", href: "/how-we-grade", kind: "how" });
  assert.equal(bankMinutes(1), 1);
  assert.equal(bankMinutes(4), 3);
  assert.equal(bankMinutes(10), 8);
  assert.equal(thumbHref("m_AbC9"), "/train/bank/session?card=m_AbC9");
});

test("This week, the import row and recent rows", () => {
  assert.equal(weekLine(populated.week), "4 games · 12 puzzles");
  assert.equal(weekLine({ games: 1, puzzles: 1 }), "1 game · 1 puzzle");
  assert.equal(weekLine(fresh.week), "No games yet");
  const imp = homeFixture("import_running").import!;
  assert.equal(importLabel(imp), "Importing 212 / 480 games");
  assert.equal(importSub(imp), "Chess.com · about 2 min left");
  assert.equal(importLabel({ ...imp, total: null, imported: 1 }), "Importing 1 game");
  assert.equal(importSub({ ...imp, provider: "lichess", etaSec: null }), "Lichess");
  assert.equal(etaLabel(20), "less than a minute left");
  assert.equal(etaLabel(5400), "about 2 h left");
  assert.equal(recentSub(populated.recent[0]!), "Missed Rxf5 · move 19 · today");
  assert.equal(recentSub({ chip: null, dateLabel: "Oct 27" }), "Oct 27");
  assert.equal(reviewHref("cabc"), "/review/cabc");
});

test("no copy carries an exclamation mark or the board's sample numbers when the data differs", () => {
  const d = { ...populated, bank: { ...populated.bank, due: 9, topTheme: { label: "Forks", n: 2 } } };
  const all = [continueSentence(d.continue!), bankLine(d.bank, false), bankCta(d.bank, false).label, weekLine(d.week)].join(" ");
  assert.doesNotMatch(all, /!/);
  assert.match(all, /Review 9 · About 7 min/);
  assert.match(all, /Forks is your most common theme \(2 in bank\)/);
});
