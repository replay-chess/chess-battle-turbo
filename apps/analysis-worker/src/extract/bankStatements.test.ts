// extract/bankStatements.ts and extract/outcome.ts (phase-05 plan §7.6, §8.5): the statement list and its order, the
// "no statement reads another's RETURNING" rule (every statement takes only its own JSON/array parameters), the job
// clock instead of now(), bigints as decimal strings, `splitBankRows` / `bankOutcome` reading each statement's rows
// back (bankAdded plies ≤ 4, bankDue = the §8.5 cap formula), and the p05-bank extension contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capState } from "@repo/chess-training/caps";
import { NOW } from "../queue/claim";
import { p05BankExtension } from "../pipeline/final-batch/p05-bank";
import { FINAL_BATCH_EXTENSIONS, extensionRowsOf, planExtensions } from "../pipeline/final-batch";
import type { FinalBatchContext } from "../pipeline/final-batch";
import { bankStatements, splitBankRows } from "./bankStatements";
import type { BankPlan } from "./extractMistakes";
import { bankOutcome } from "./outcome";

const HASH = "-6917529027641081856"; // a negative int64: JSON must carry it as a string

function plan(over: Partial<BankPlan> = {}): BankPlan {
  return {
    gameId: "900",
    mistakes: [
      {
        referenceId: "cmistake000000000000000001",
        userId: "41",
        epdHash: HASH,
        color: "w",
        fen: "r2r2k1/p1q2pp1/2pb1n1p/5b2/2n5/2NNB2P/PPP1BPP1/R2Q1RK1 w - - 0 17",
        setupUci: null,
        solution: "d1c1",
        accept: null,
        playedUci: "b2b3",
        refuteUci: "c4e3",
        judgement: "INACCURACY",
        source: "OWN_ERROR",
        isPuzzle: false,
        uniquenessGap: 0,
        themes: ["rc:recapture", "middlegame"],
        primaryTheme: "rc:recapture",
        phase: "MIDDLEGAME",
        winBefore: 50,
        winAfterPlayed: 43,
        cpBest: 0,
        mateBest: null,
        timeClass: "BLITZ",
        ecoCode: "C50",
        moveNumber: 17,
        lastGameId: "900",
        lastPly: 32,
        lastPlayedAt: "2026-11-12 18:40:00.000",
        lastOpponentName: "tal_fan_77",
        due: "2026-11-13 13:00:00.000",
      },
    ],
    occurrences: [
      { userId: "41", epdHash: HASH, gameId: "900", ply: 32, playedAt: "2026-11-12 18:40:00.000", due: "2026-11-13 13:00:00.000", moment: true },
    ],
    cards: [
      { userId: "41", epdHash: HASH, gameId: "900", color: "w", ply: 32, kind: "REVIEW_POSITION", itemKey: "m_abc", due: "2026-11-13 13:00:00.000" },
    ],
    days: [{ userId: "41", day: "2026-11-12" }],
    userIds: ["41"],
    momentPlies: [32],
    version: 1,
    members: [
      {
        userId: "41",
        userRef: "cuserwhite000000000000001",
        color: "w",
        candidates: 1,
        puzzles: 0,
        reviewPositions: 1,
        momentPlies: [32],
        cap: 10,
        newPerDay: 5,
      },
    ],
    source: "live",
    extractMs: 12,
    lineSearches: 0,
    ...over,
  };
}

describe("bankStatements", () => {
  it("the §7.6 order: review lock, reset, upsert, occurrences, recount, cards, bankVersion, due counts, bankAdded (9, plan §9.1)", () => {
    const ss = bankStatements(plan());
    assert.equal(ss.length, 9);
    const heads = ss.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(" "));
    assert.match(ss[0]!.text, /FROM player_reviews WHERE "gameId" = \$1::bigint FOR UPDATE/);
    assert.match(ss[1]!.text, /^UPDATE training_cards c/);
    assert.match(ss[2]!.text, /^INSERT INTO mistakes/);
    assert.match(ss[3]!.text, /INSERT INTO mistake_occurrences/);
    assert.match(ss[4]!.text, /^UPDATE mistakes m SET occurrences/);
    assert.match(ss[5]!.text, /INSERT INTO training_cards/);
    assert.match(ss[6]!.text, /^UPDATE game_players SET "bankVersion"/);
    assert.match(ss[7]!.text, /FROM training_cards c/);
    assert.match(ss[8]!.text, /array_agg\(mo\.ply/);
    assert.equal(new Set(heads).size, heads.length);
  });

  it("a recurrence is any new occurrence of a carded mistake, key moment or not (plan §8.1 step 8, FIX-1)", () => {
    const occ = bankStatements(plan())[3]!.text;
    assert.match(occ, /UPDATE training_cards c SET due = LEAST\(c\.due, x\.due\)/);
    assert.doesNotMatch(occ, /x\.moment/);
  });

  it("only JSON and array parameters (no RETURNING crosses statements); the job clock, never now()", () => {
    for (const s of bankStatements(plan())) {
      assert.ok(s.values.length >= 1);
      for (const v of s.values) assert.ok(typeof v === "string" || Array.isArray(v) || typeof v === "number", typeof v);
      const bare = s.text.replace(NOW, "").replace(/now\(\) AT TIME ZONE 'UTC'/g, "");
      assert.doesNotMatch(bare, /now\(\)/i, "every instant is NOW (the job clock)");
      assert.doesNotMatch(s.text, /timestamptz|with time zone/i, "timestamp(3) without time zone only");
    }
    const upsert = bankStatements(plan())[2]!;
    const rows = JSON.parse(upsert.values[0] as string) as { epdHash: string }[];
    assert.equal(rows[0]!.epdHash, HASH, "an int64 travels as a decimal string");
  });

  it("drops the mistake statements without candidates and the card statement without moments", () => {
    const none = bankStatements(plan({ mistakes: [], occurrences: [], cards: [] }));
    assert.equal(none.length, 4, "review lock, bankVersion, due counts, bankAdded");
    assert.equal(bankStatements(plan({ cards: [] })).length, 8);
    assert.deepEqual(bankStatements(plan({ userIds: [] })), []);
  });

  it("the card insert respects hidden mistakes and the review's opt-outs, ON CONFLICT DO NOTHING", () => {
    const cards = bankStatements(plan())[5]!.text;
    assert.match(cards, /"hiddenAt" IS NULL/);
    assert.match(cards, /bankOptOut/);
    assert.match(cards, /ON CONFLICT \("userId", "itemKey"\) DO NOTHING/);
    assert.match(cards, /"bankCount" = theme_mastery."bankCount" \+ EXCLUDED."bankCount"/);
  });
});

describe("splitBankRows and bankOutcome", () => {
  const rows = [
    [{ locked: 1 }], // L review lock
    [], // 0 reset
    [{ userId: "41", inserted: true }], // 1 upsert
    [{ userId: "41", occurrences: 1, recurrences: 0 }], // 2 occurrences
    [], // 3 recount
    [{ userId: "41", cardsAdded: 1, themes: 1 }], // 4 cards
    [], // 5 bankVersion
    [{ userId: "41", dueReview: 7, dueNew: 4, total: 30, bankReviewed: 3, newIntroduced: 1 }], // 6
    [{ userId: "41", plies: [32, 36, 40, 44, 48] }], // 7
  ];

  it("maps each statement's rows back", () => {
    const split = splitBankRows(plan(), rows);
    assert.equal(split.mistakes.length, 1);
    assert.equal(split.cards[0]!.cardsAdded, 1);
    assert.equal(split.due[0]!.total, 30);
    assert.deepEqual(split.added[0]!.plies, [32, 36, 40, 44, 48]);
  });

  it("bankDue is the §8.5 cap formula, bankAdded holds ≤ 4 plies", () => {
    const out = bankOutcome(plan(), rows).get("cuserwhite000000000000001")!;
    const caps = capState({ cap: 10, newPerDay: 5, bankReviewed: 3, newIntroduced: 1, dueReview: 7, dueNew: 4 });
    assert.equal(out.bankDue, caps.dueShown);
    assert.equal(out.bankDue, 7, "min(7 + min(4, 4), 7)");
    assert.equal(out.dueRaw, 11);
    assert.deepEqual(out.bankAdded, { count: 4, plies: [32, 36, 40, 44] });
    assert.deepEqual([out.cardsAdded, out.recurrences, out.touched, out.total], [1, 0, 1, 30]);
  });

  it("a member with no rows reads zeros", () => {
    const out = bankOutcome(plan({ mistakes: [], occurrences: [], cards: [] }), [[], [], [], []]).get(
      "cuserwhite000000000000001",
    )!;
    assert.deepEqual(out.bankAdded, { count: 0, plies: [] });
    assert.equal(out.bankDue, 0);
  });
});

describe("the p05-bank extension", () => {
  const ctx = (bank: BankPlan | null): FinalBatchContext => ({
    gameId: "900",
    gameRef: "cgame00000000000000000001",
    startPly: 0,
    moves: [],
    members: [],
    result: {} as FinalBatchContext["result"],
    memberSides: [],
    regrade: false,
    bank,
  });

  it("is registered after P4's and adds nothing without a plan (J1 off)", () => {
    assert.deepEqual(
      FINAL_BATCH_EXTENSIONS.map((e) => e.id),
      ["p04-import", "p05-bank"],
    );
    assert.deepEqual(p05BankExtension.statements(ctx(null)), []);
  });

  it("a regrade with J1 on marks the sides for re-extraction and queues EXTRACT_MISTAKES in its own batch (FIX-1)", () => {
    const members = [
      { color: "w" as const, userId: "41", userRef: "cuserwhite000000000000001", result: null },
      { color: "b" as const, userId: "42", userRef: "cuserblack000000000000001", result: null },
    ];
    const base = { ...ctx(null), regrade: true, members, memberSides: ["w" as const], analysisVersion: 3 };
    assert.deepEqual(p05BankExtension.statements(base), [], "J1 off: nothing");
    const [st, ...rest] = p05BankExtension.statements({ ...base, bankReextract: true });
    assert.equal(rest.length, 0);
    assert.match(st!.text, /UPDATE game_players SET "bankVersion" = 0/);
    assert.match(st!.text, /INSERT INTO jobs/);
    assert.match(st!.text, /'EXTRACT_MISTAKES'/);
    assert.match(st!.text, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
    assert.deepEqual(st!.values.slice(0, 4), ["900", ["41"], 1, 3], "only the reviewed side, the regrade's analysis version");
  });

  it("its statements are the plan's, and extensionRowsOf hands its own rows back", () => {
    const p = plan();
    const planned = planExtensions(FINAL_BATCH_EXTENSIONS, ctx(p));
    assert.equal(planned.statements.length, 9);
    const all = Array.from({ length: 9 }, (_, i) => [{ i }]);
    assert.deepEqual(extensionRowsOf(planned, "p05-bank", all), all);
    assert.equal(extensionRowsOf(planned, "nope", all), null);
  });
});
