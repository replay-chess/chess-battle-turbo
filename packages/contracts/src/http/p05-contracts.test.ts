// P5 HTTP contracts (phase-05 plan §7.1, §7.2, §11): every fixture state parses with its schema, the security-relevant
// refinements hold (strict bodies, the hidden best move, owner refs), the review's reserved slots are widened without
// breaking a P3 payload, and the registry entries carry the plan's auth, cache tier, limits and body sizes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewStatusFixture } from "./fixtures/review";
import {
  attemptsFixture,
  attemptsResultFixture,
  badgesFixture,
  BANK_PAGE_STATES,
  bankNextPageFixture,
  bankPageFixture,
  extendResultFixture,
  fixtureCardKey,
  HOME_STATES,
  homeFixture,
  momentBankOutFixture,
  reportBodyFixture,
  reportResultFixture,
  SESSION_STATES,
  sessionPayloadFixture,
  sessionSummaryFixture,
  skipResultFixture,
  SUMMARY_STATES,
  themesResultFixture,
  TODAY_STATES,
  trainPrefsFixture,
  trainTodayFixture,
} from "./fixtures/p05";
import { HomeData } from "./home";
import { getEndpoint } from "./registry/index";
import { REPORT_BURST_LIMIT, ReportBody, ReportResult } from "./reports";
import { MomentBankResponse, MomentDTO, ReviewCompleteView, ReviewStatusDTO } from "./review";
import {
  AttemptIn,
  AttemptsBody,
  AttemptsResult,
  Badges,
  BankNextPage,
  BankPage,
  BankQuery,
  BankRow,
  ExtendResult,
  ItemKey,
  SessionCreate,
  SessionGetResult,
  SessionPayload,
  SessionSummary,
  SkipResult,
  ThemeKey,
  ThemesResult,
  TRAIN_SESSION_BURST_LIMIT,
  TRAIN_WRITE_LIMIT,
  TrainPrefs,
  TrainPrefsPatch,
  TrainToday,
} from "./train";

const ok = (schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } }, value: unknown, label: string) => {
  const r = schema.safeParse(value);
  assert.equal(r.success, true, `${label}: ${r.success ? "" : r.error?.message}`);
};

describe("P5 fixtures parse with their contracts", () => {
  it("every TrainToday, BankPage, SessionPayload, SessionSummary and HomeData state", () => {
    for (const s of TODAY_STATES) ok(TrainToday, trainTodayFixture(s), `today ${s}`);
    for (const s of BANK_PAGE_STATES) ok(BankPage, bankPageFixture(s), `bank ${s}`);
    ok(BankNextPage, bankNextPageFixture(), "bank next page");
    for (const s of SESSION_STATES) ok(SessionPayload, sessionPayloadFixture(s), `session ${s}`);
    for (const s of SUMMARY_STATES) ok(SessionSummary, sessionSummaryFixture(s), `summary ${s}`);
    for (const s of HOME_STATES) ok(HomeData, homeFixture(s), `home ${s}`);
  });

  it("the small payloads: extend, themes, badges, prefs, skip, attempts, A6, report", () => {
    ok(ExtendResult, extendResultFixture(), "extend");
    ok(ThemesResult, themesResultFixture(), "themes");
    ok(Badges, badgesFixture(), "badges");
    ok(TrainPrefs, trainPrefsFixture(), "prefs");
    ok(SkipResult, skipResultFixture(), "skip");
    ok(AttemptsBody, { attempts: attemptsFixture(50) }, "attempts body");
    ok(AttemptsResult, attemptsResultFixture(12), "attempts result");
    ok(MomentBankResponse, momentBankOutFixture(true), "A6 on");
    ok(MomentBankResponse, momentBankOutFixture(false), "A6 off");
    ok(ReportBody, reportBodyFixture(), "report body");
    ok(ReportResult, reportResultFixture(true), "report result");
  });

  it("R3 answers either shape", () => {
    ok(SessionGetResult, sessionPayloadFixture("bank"), "R3 items");
    ok(SessionGetResult, sessionSummaryFixture("default"), "R3 summary");
  });

  it("bank states follow §4.3: empty has no rows, caughtup has nothing due, default has 4 due of 23", () => {
    assert.equal(bankPageFixture("empty").rows.length, 0);
    assert.ok(bankPageFixture("caughtup").rows.every((r) => !r.isDue));
    const d = bankPageFixture("default");
    assert.equal(d.rows.filter((r) => r.isDue).length, 4);
    assert.equal(d.rows.length, 23);
    assert.equal(bankPageFixture("stress").rows.length, 300);
    assert.equal(new Set(bankPageFixture("stress").rows.map((r) => r.cardRef)).size, 300, "card refs are unique");
  });

  it("a perfect summary has every item first try; a saving summary has fewer graded than the client sent", () => {
    const p = sessionSummaryFixture("perfect");
    assert.equal(p.stats.firstTry, p.stats.total);
    assert.ok(sessionSummaryFixture("saving").graded < sessionSummaryFixture("default").graded);
  });
});

describe("P5 schema rules", () => {
  it("BankRow is strict: a best move can never ride along", () => {
    const row = bankPageFixture("default").rows[0]!;
    assert.equal(BankRow.safeParse({ ...row, bestSan: "Rxf5" }).success, false);
    assert.equal(BankRow.safeParse({ ...row, solution: ["f1f5"] }).success, false);
  });

  it("ItemKey and ThemeKey", () => {
    for (const k of [fixtureCardKey(0), "p_0009B", "o_abc"]) assert.equal(ItemKey.safeParse(k).success, true, k);
    for (const k of ["x_abc", "m_", "m_abc-def", `m_${"a".repeat(25)}`, "cm3k9x2p10007slzpqa8hd4fe"]) {
      assert.equal(ItemKey.safeParse(k).success, false, k);
    }
    for (const k of ["fork", "backRankMate", "rc:recapture", "mateIn2"]) assert.equal(ThemeKey.safeParse(k).success, true, k);
    for (const k of ["f", "rc:", "fork!", "x:fork"]) assert.equal(ThemeKey.safeParse(k).success, false, k);
  });

  it("AttemptIn needs a cardRef, or a puzzleId with a sessionRef; bodies are strict and ≤ 50", () => {
    const [bank, puzzle] = attemptsFixture(2) as [AttemptIn, AttemptIn];
    assert.equal(AttemptIn.safeParse(bank).success, true);
    assert.equal(AttemptIn.safeParse(puzzle).success, true);
    assert.equal(AttemptIn.safeParse({ ...puzzle, sessionRef: null }).success, false);
    assert.equal(AttemptIn.safeParse({ ...bank, cardRef: null }).success, false);
    assert.equal(AttemptIn.safeParse({ ...bank, userId: "1" }).success, false, "strict");
    assert.equal(AttemptIn.safeParse({ ...bank, hintsUsed: 3 }).success, false);
    assert.equal(AttemptIn.safeParse({ ...bank, timeMs: 3_600_001 }).success, false);
    assert.equal(AttemptIn.safeParse({ ...bank, wrongMovesUci: Array(11).fill("e2e4") }).success, false);
    assert.equal(AttemptsBody.safeParse({ attempts: attemptsFixture(51) }).success, false);
    assert.equal(AttemptsBody.safeParse({ attempts: [] }).success, false);
  });

  it("SessionCreate: the four P5 kinds, strict, with the plan's defaults; weakness waits for P6", () => {
    assert.deepEqual(SessionCreate.parse({ kind: "daily" }), { kind: "daily", source: "plan" });
    assert.deepEqual(SessionCreate.parse({ kind: "bank", source: "bank" }), { kind: "bank", source: "bank", practice: false });
    assert.equal(SessionCreate.safeParse({ kind: "bank", source: "solve_one", cardRefs: [fixtureCardKey(0)] }).success, true);
    assert.equal(SessionCreate.safeParse({ kind: "bank", source: "bank", cardRefs: [] }).success, false);
    assert.equal(SessionCreate.safeParse({ kind: "puzzles", source: "picker", theme: "pin", count: 3 }).success, true);
    assert.equal(SessionCreate.safeParse({ kind: "puzzles", source: "picker", count: 11 }).success, false);
    assert.equal(SessionCreate.safeParse({ kind: "practice", fromSessionRef: "cm5t9s3ss0001slzpbankdrl1" }).success, true);
    assert.equal(SessionCreate.safeParse({ kind: "weakness", pattern: "fork" }).success, false);
    assert.equal(SessionCreate.safeParse({ kind: "bank", source: "bank", filter: { theme: "fork", rating: 1 } }).success, false);
  });

  it("TrainPrefsPatch: every field validated, an unknown zone and an empty patch refused", () => {
    assert.equal(TrainPrefsPatch.safeParse({ timeZone: "Asia/Kolkata" }).success, true);
    assert.equal(TrainPrefsPatch.safeParse({ timeZone: "Mars/Olympus" }).success, false);
    assert.equal(TrainPrefsPatch.safeParse({}).success, false);
    assert.equal(TrainPrefsPatch.safeParse({ dayStartHour: 7 }).success, false);
    assert.equal(TrainPrefsPatch.safeParse({ releaseHour: 4 }).success, false);
    assert.equal(TrainPrefsPatch.safeParse({ bankDailyCap: 31 }).success, false);
    assert.equal(TrainPrefsPatch.safeParse({ newPerDay: 0, autoGrade: true }).success, true);
  });

  it("BankQuery coerces the page size and defaults the view to all", () => {
    assert.deepEqual(BankQuery.parse({}), { view: "all", limit: 50 });
    assert.equal(BankQuery.parse({ limit: "20", view: "due", theme: "fork" }).limit, 20);
    assert.equal(BankQuery.safeParse({ limit: "51" }).success, false);
    assert.equal(BankQuery.safeParse({ source: "theirs" }).success, false);
  });

  it("ReportBody: P5's targets only, note ≤ 500, strict", () => {
    const body = reportBodyFixture();
    assert.equal(ReportBody.safeParse({ ...body, targetType: "user" }).success, false, "P10 adds user and game");
    assert.equal(ReportBody.safeParse({ ...body, note: "x".repeat(501) }).success, false);
    // FIX-2: a NUL (Postgres 22021) or another control character is a 400, never a 500; newlines and tabs stay.
    assert.equal(ReportBody.safeParse({ ...body, note: "bad\u0000note" }).success, false);
    assert.equal(ReportBody.safeParse({ ...body, note: "bell\u0007" }).success, false);
    assert.equal(ReportBody.safeParse({ ...body, targetRef: "pz\u0000" }).success, false);
    assert.equal(ReportBody.safeParse({ ...body, note: "line one\nline two\twith a tab\r\n" }).success, true);
    assert.equal(ReportBody.safeParse({ ...body, reporterId: "1" }).success, false);
  });
});

describe("P3's review slots, widened by P5 (skew-safe)", () => {
  it("ReviewStatusDTO.bank: {count, plies ≤ 4} or null; P3's null payload still parses", () => {
    const p3 = reviewStatusFixture("done");
    ok(ReviewStatusDTO, p3, "P3 payload");
    ok(ReviewStatusDTO, { ...p3, bank: { count: 2, plies: [24, 36] } }, "P5 payload");
    assert.equal(ReviewStatusDTO.safeParse({ ...p3, bank: { count: 1, plies: [1, 2, 3, 4, 5] } }).success, false);
  });

  it("MomentBankResponse.card is the card DTO or null", () => {
    assert.equal(MomentBankResponse.safeParse({ ply: 36, inBank: true, card: { ref: "bad" } }).success, false);
    ok(MomentBankResponse, { ply: 36, inBank: true, card: null }, "not extracted yet");
  });

  it("MomentDTO.card and the ReviewCompleteView bank lines are optional (absent with the train flag off)", () => {
    assert.ok("card" in MomentDTO.shape);
    assert.equal(MomentDTO.shape.card.safeParse(undefined).success, true);
    assert.equal(MomentDTO.shape.card.safeParse(null).success, true);
    assert.equal(MomentDTO.shape.card.safeParse({ ref: fixtureCardKey(0), dueLabel: "Tomorrow" }).success, true);
    for (const key of ["added", "nextDueAt", "nextDueLabel", "drillHref"] as const) {
      assert.equal(ReviewCompleteView.shape[key].safeParse(undefined).success, true, key);
    }
    assert.equal(ReviewCompleteView.shape.drillHref.safeParse("/train/bank/session?game=cm3k9x2p10007slzpqa8hd4fe").success, true);
    assert.equal(ReviewCompleteView.shape.drillHref.safeParse("https://evil.example/train").success, false);
  });
});

describe("P5 registry entries (§7.2)", () => {
  const ids = [
    "train.today", "train.bank", "train.themes", "train.sessions.create", "train.sessions.get", "train.sessions.extend",
    "train.sessions.end", "train.attempts", "train.cards.skip", "train.cards.remove", "train.prefs", "home.get", "me.badges",
    "reports.create",
  ] as const;

  it("every P5 route is member-only and no-store; only R1 declares a GET side effect", () => {
    for (const id of ids) {
      const e = getEndpoint(id);
      assert.equal(e.auth, "member", id);
      assert.equal(e.cache ?? "no-store", "no-store", id);
      const effects = "sideEffects" in e ? e.sideEffects : undefined;
      if (id === "train.today") assert.deepEqual(effects, ["daily_plan"]);
      else assert.equal(effects, undefined, id);
    }
  });

  it("paths, statuses and body limits", () => {
    assert.equal(getEndpoint("train.sessions.get").path, "/api/train/sessions/{ref}");
    assert.equal(getEndpoint("train.cards.remove").path, "/api/train/cards/{ref}");
    assert.equal(getEndpoint("train.cards.remove").status, 204);
    assert.equal(getEndpoint("train.sessions.create").status, 201);
    assert.equal(getEndpoint("reports.create").status, 201);
    assert.equal(getEndpoint("train.attempts").maxBodyBytes, 65_536);
    assert.equal(getEndpoint("train.sessions.create").maxBodyBytes, 16_384);
    assert.equal(getEndpoint("train.sessions.extend").maxBodyBytes, 4_096);
    assert.equal(getEndpoint("reports.create").maxBodyBytes, 4_096);
    for (const id of ["train.sessions.end", "train.cards.skip", "train.prefs"] as const) assert.equal(getEndpoint(id).maxBodyBytes, 1_024, id);
  });

  it("limits: train-write 120/60 s burst on the writes, train-session-burst 20/60 s on W2; the durable windows are handler-counted", () => {
    for (const id of ["train.attempts", "train.sessions.extend", "train.cards.skip", "train.cards.remove", "train.prefs"] as const) {
      assert.deepEqual(getEndpoint(id).rateLimit, TRAIN_WRITE_LIMIT, id);
    }
    assert.deepEqual(TRAIN_WRITE_LIMIT, { bucket: "train-write", limit: 120, windowSec: 60, by: "user" });
    assert.deepEqual(getEndpoint("train.sessions.create").rateLimit, TRAIN_SESSION_BURST_LIMIT, "a burst limiter; train-session 30/h is counted from training_sessions");
    assert.deepEqual(TRAIN_SESSION_BURST_LIMIT, { bucket: "train-session-burst", limit: 20, windowSec: 60, by: "user" });
    assert.ok((getEndpoint("train.sessions.create").errors as readonly string[]).includes("rate_limited"));
    assert.deepEqual(getEndpoint("reports.create").rateLimit, REPORT_BURST_LIMIT);
    assert.deepEqual(REPORT_BURST_LIMIT, { bucket: "report-burst", limit: 5, windowSec: 60, by: "user" });
  });
});
