// Phase-05 plan §4.3, §5.2 S3: the Mistake Bank's URL state, client filtering over a complete bank (instant for ≤ 300
// rows), group headers, selection, the CTA and every data-generated string, on WP-A's contract fixtures.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BankPage as BankPageSchema, BANK_COMPLETE_MAX_ROWS, SessionCreate } from "@repo/contracts/http/train";
import { bankPageFixture, bankRowsFixture, manyBankRows } from "@repo/contracts/http/fixtures/p05";
import {
  activeFilterCount,
  bankHref,
  bankQueryString,
  bankSessionBody,
  bodyOf,
  capOf,
  caughtUpOf,
  chipsOf,
  clearedFilters,
  countLabel,
  ctaOf,
  DEFAULT_BANK_DAILY_CAP,
  detailOf,
  EMPTY_FILTER,
  estMinutes,
  filterGroupsOf,
  footerOf,
  groupRows,
  headerTags,
  nextBatchTag,
  parseBankSearch,
  poolOf,
  rowBoardLabel,
  seeInGameHref,
  selectedRowOf,
  serverFilterOf,
  showLabel,
  sideToMoveOf,
  solveHref,
  toggled,
  viewOf,
  visibleRowsOf,
  withoutGroup,
  type BankFilterState,
} from "./model";

const f = (over: Partial<BankFilterState> = {}): BankFilterState => ({ ...EMPTY_FILTER, ...over });

describe("bank URL state", () => {
  it("parses every field and drops anything malformed (never an error page for a bad link)", () => {
    assert.deepEqual(parseBankSearch({ view: "due", theme: "fork", phase: "endgame", source: "missed", sel: "m_abc123" }), {
      view: "due",
      theme: "fork",
      phase: "endgame",
      source: "missed",
      sel: "m_abc123",
    });
    assert.deepEqual(parseBankSearch({}), { ...EMPTY_FILTER, sel: null });
    assert.deepEqual(parseBankSearch({ view: "later", theme: "<script>", phase: "opening!", source: "theirs", sel: "x_1" }), {
      ...EMPTY_FILTER,
      sel: null,
    });
    assert.equal(parseBankSearch({ theme: "rc:recapture" }).theme, "rc:recapture");
    assert.equal(parseBankSearch(new URLSearchParams("view=all&theme=pin")).view, "all");
    assert.equal(parseBankSearch({ view: ["due", "all"] }).view, "due", "the first of repeated params");
  });

  it("round-trips through the canonical query string; defaults are omitted", () => {
    const s = { view: "due" as const, theme: "fork", phase: "middlegame" as const, source: "own" as const, sel: "m_q1" };
    assert.equal(bankQueryString(s), "?view=due&theme=fork&phase=middlegame&source=own&sel=m_q1");
    assert.deepEqual(parseBankSearch(new URLSearchParams(bankQueryString(s).slice(1))), s);
    assert.equal(bankHref({ ...EMPTY_FILTER, sel: null }), "/train/bank");
    assert.equal(bankHref({ ...EMPTY_FILTER, view: "all", sel: null }), "/train/bank?view=all", "Browse All is an explicit tab");
    assert.equal(bankQueryString({ ...EMPTY_FILTER, theme: "rc:recapture", sel: null }), "?theme=rc%3Arecapture");
  });

  it("the server filter of a large bank (view due only when chosen; the selection is client state)", () => {
    assert.deepEqual(serverFilterOf(f()), { view: undefined, theme: undefined, phase: undefined, source: undefined });
    assert.deepEqual(serverFilterOf(f({ view: "due", theme: "fork", source: "own" })), {
      view: "due",
      theme: "fork",
      phase: undefined,
      source: "own",
    });
    assert.equal(viewOf(f()), "all");
  });
});

describe("bank filters", () => {
  it("groups are single-choice: a second tap clears; Clear All keeps the tab", () => {
    let s = toggled(f({ view: "due" }), "theme", "fork");
    assert.equal(s.theme, "fork");
    s = toggled(s, "theme", "pin");
    assert.equal(s.theme, "pin");
    s = toggled(s, "theme", "pin");
    assert.equal(s.theme, null);
    s = toggled(toggled(s, "phase", "endgame"), "source", "missed");
    assert.equal(activeFilterCount(s), 2);
    assert.deepEqual(withoutGroup(s, "phase"), { ...s, phase: null });
    assert.deepEqual(clearedFilters(s), f({ view: "due" }));
    assert.equal(toggled(f(), "phase", "bogus").phase, null);
  });

  it("filters a complete bank on the client: the design's Theme Fork → 6 rows, all scheduled later", () => {
    const rows = bankRowsFixture();
    const fork = f({ theme: "fork" });
    assert.equal(poolOf(rows, fork).length, 6);
    assert.equal(visibleRowsOf(rows, fork).length, 6);
    assert.equal(visibleRowsOf(rows, { ...fork, view: "due" }).length, 0);
    assert.equal(visibleRowsOf(rows, f({ view: "due" })).length, 4);
    assert.equal(visibleRowsOf(rows, f({ phase: "endgame", source: "own" })).length, 4);
    assert.deepEqual(
      visibleRowsOf(rows, f()).map((r) => r.cardRef),
      rows.map((r) => r.cardRef),
      "server order (by next review) is kept",
    );
  });

  it("is instant for a complete bank at its 300-row limit", () => {
    const rows = manyBankRows(BANK_COMPLETE_MAX_ROWS);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) visibleRowsOf(rows, f({ theme: i % 2 ? "fork" : "hangingPiece", view: i % 3 ? "all" : "due" }));
    const per = (performance.now() - t0) / 50;
    assert.ok(per < 4, `one filter pass over 300 rows took ${per.toFixed(2)} ms`);
  });

  it("chips name the active filters from the facets; the groups come from the facets", () => {
    const facets = bankPageFixture("default").facets;
    assert.deepEqual(chipsOf(f({ theme: "fork", source: "missed" }), facets), [
      { group: "theme", key: "fork", label: "Fork" },
      { group: "source", key: "missed", label: "Missed punishments" },
    ]);
    assert.equal(chipsOf(f({ theme: "unknownTheme" }), facets)[0]!.label, "unknownTheme");
    assert.deepEqual(
      filterGroupsOf(facets).map((g) => [g.title, g.options.length]),
      [
        ["Theme", 6],
        ["Phase", 3],
        ["Source", 2],
      ],
    );
    assert.deepEqual(filterGroupsOf(bankPageFixture("empty").facets), [], "an empty bank has no groups");
  });

  it("Show n Positions", () => {
    assert.equal(showLabel(4), "Show 4 Positions");
    assert.equal(showLabel(1), "Show 1 Position");
    assert.equal(showLabel(null), "Show Positions");
  });
});

describe("bank list", () => {
  it("All: Due today · n then Scheduled later · n; Due: one group without a header", () => {
    const rows = bankRowsFixture();
    const all = groupRows(rows, "all");
    assert.deepEqual(
      all.map((g) => [g.id, g.header, g.rows.length]),
      [
        ["due", "Due today · 4", 4],
        ["later", "Scheduled later · 19", 19],
      ],
    );
    assert.deepEqual(
      groupRows(visibleRowsOf(rows, f({ view: "due" })), "due").map((g) => [g.header, g.rows.length]),
      [[null, 4]],
    );
    assert.deepEqual(groupRows([], "all"), []);
    assert.deepEqual(
      groupRows(visibleRowsOf(rows, f({ theme: "fork" })), "all").map((g) => g.header),
      ["Scheduled later · 6"],
    );
  });

  it("selection: the URL's card when visible, else the first visible row, else none", () => {
    const rows = bankRowsFixture();
    assert.equal(selectedRowOf(rows, rows[5]!.cardRef)?.cardRef, rows[5]!.cardRef);
    const fork = visibleRowsOf(rows, f({ theme: "fork" }));
    assert.equal(selectedRowOf(fork, rows[0]!.cardRef)?.cardRef, fork[0]!.cardRef, "filtered away → first row");
    assert.equal(selectedRowOf([], rows[0]!.cardRef), null);
  });

  it("the CTA: due cards → Review n Due · ~m min; nothing due → Drill These n · Nothing Due (practice); none", () => {
    const rows = bankRowsFixture();
    const review = ctaOf(poolOf(rows, f()), visibleRowsOf(rows, f()));
    assert.deepEqual(review, { kind: "review", label: "Review 4 Due · ~3 min", due: 4, practice: false });
    const fork = f({ theme: "fork" });
    assert.deepEqual(ctaOf(poolOf(rows, fork), visibleRowsOf(rows, fork)), {
      kind: "drill",
      label: "Drill These 6 · Nothing Due",
      count: 6,
      practice: true,
    });
    assert.deepEqual(ctaOf([], []), { kind: "none" });
    assert.equal(estMinutes(1), 1);
    assert.equal(estMinutes(10), 8);
  });

  it("W2's body carries the active filters only, and practice when nothing is due", () => {
    const review = bankSessionBody(f({ view: "due" }), { kind: "review", label: "", due: 4, practice: false });
    assert.deepEqual(review, { kind: "bank", source: "bank", practice: false });
    const drill = bankSessionBody(f({ theme: "fork", phase: "middlegame" }), { kind: "drill", label: "", count: 6, practice: true });
    assert.deepEqual(drill, { kind: "bank", source: "bank", filter: { theme: "fork", phase: "middlegame" }, practice: true });
    assert.equal(SessionCreate.safeParse(review).success, true);
    assert.equal(SessionCreate.safeParse(drill).success, true);
  });

  it("row and detail strings (the best move is never among them)", () => {
    const row = bankRowsFixture()[0]!;
    assert.equal(rowBoardLabel(row), "Loose piece position from your game vs tal_fan_77, move 19");
    const d = detailOf(row);
    assert.equal(d.eyebrow, "Due today · White to move");
    assert.equal(d.title, "Loose piece");
    assert.equal(d.played, "you played Qd2");
    assert.equal(d.meta, "Miss · vs tal_fan_77 · today · move 19 · Middlegame");
    assert.equal(d.mastery, "Mastery 0 of 5 · best move hidden until you try");
    assert.equal(d.boardLabel, "Loose piece position from your game vs tal_fan_77. White to move. Find the better move.");
    const later = bankRowsFixture()[4]!;
    assert.equal(detailOf(later).eyebrow, "Next review Tomorrow · White to move");
    assert.equal(sideToMoveOf("8/8/8/8/8/8/8/8 b - - 0 1"), "Black");
    assert.equal(solveHref("m_abc"), "/train/bank/session?card=m_abc");
    assert.equal(seeInGameHref({ gameRef: "cmgame", gamePly: 36 }), "/review/cmgame?ply=36&from=bank");
    assert.equal(seeInGameHref({ gameRef: "cmgame", gamePly: null }), "/review/cmgame?from=bank");
  });
});

describe("bank page states", () => {
  it("the body: empty, caught up (no tab or filter chosen), else the list", () => {
    assert.equal(bodyOf(bankPageFixture("empty"), f()), "empty");
    assert.equal(bodyOf(bankPageFixture("caughtup"), f()), "caughtup");
    assert.equal(bodyOf(bankPageFixture("caughtup"), f({ view: "all" })), "list", "Browse All 23 Positions");
    assert.equal(bodyOf(bankPageFixture("caughtup"), f({ theme: "fork" })), "list");
    assert.equal(bodyOf(bankPageFixture("default"), f()), "list");
  });

  it("header tags, the next batch and the footer", () => {
    const page = bankPageFixture("default");
    assert.deepEqual(headerTags(page), { due: "4 due today", total: "23 in bank" });
    assert.equal(nextBatchTag(page.nextBatch, "tomorrow"), "Next batch tomorrow 08:00");
    assert.equal(nextBatchTag(page.nextBatch, null), "Next batch 08:00");
    assert.equal(nextBatchTag(null, "tomorrow"), null);
    assert.equal(footerOf(page, "all", "tomorrow"), "Sorted by next review · FSRS keeps it to 10 a day");
    assert.equal(footerOf(page, "due", "tomorrow"), "19 more scheduled for later days · next batch tomorrow");
    assert.equal(countLabel(4, "due"), "4 due");
    assert.equal(countLabel(23, "all"), "23 in bank");
  });

  it("caught up: reviewed today = cap − capRemaining; the cap as the reason; the next batch", () => {
    const c = caughtUpOf(bankPageFixture("caughtup"), "tomorrow");
    assert.equal(c.body, "You reviewed today’s 4 positions. The next batch of 6 arrives tomorrow at 08:00.");
    assert.equal(c.browseLabel, "Browse All 23 Positions");
    assert.equal(c.upcomingMax, 9);
    assert.equal(c.cap, 10);
    const cap = caughtUpOf(bankPageFixture("cap_reached"), "tomorrow");
    assert.equal(cap.body, "You reviewed today’s 10 positions. The next batch of 6 arrives tomorrow at 08:00.");
    const quiet = caughtUpOf({ ...bankPageFixture("caughtup"), counts: { due: 0, dueRaw: 0, all: 5, capRemaining: 10 }, nextBatch: null }, null);
    assert.equal(quiet.body, "Nothing is due today.");
  });

  it("the cap: a page's counts.cap when present, else the profile default", () => {
    assert.equal(capOf(bankPageFixture("default")), DEFAULT_BANK_DAILY_CAP);
    assert.equal(capOf({ counts: { ...bankPageFixture("default").counts, cap: 15 } }), 15);
  });

  it("every fixture state parses with the contract (the screen is fed real shapes)", () => {
    for (const s of ["default", "empty", "caughtup", "cap_reached", "stress"] as const) {
      assert.equal(BankPageSchema.safeParse(bankPageFixture(s)).success, true, s);
    }
  });
});
