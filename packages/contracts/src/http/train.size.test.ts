// Payload budgets of P5's HTTP responses (phase-05 plan §9.4, opt §5.1), measured on the envelope `{ data }` exactly as
// route() serialises it. The fixtures are the design's data (fixtures/p05.ts); for the list-shaped payloads the refs,
// card keys and FENs are re-drawn from a seeded PRNG so gzip sees real-world entropy instead of 23 repeated rows.
//
// Measured, not guessed (as P3 did for the analysis events): §9.4's raw figures for the bank list, the session payload
// and the attempts body/result assumed ≈ 280 B per bank row and ≈ 1 KB per session item. The contract the plan fixed in
// §7.1 is larger: a bank row carries a 25-character game ref, a 13-character card key, a theme object and labels
// (≈ 470 B), a session item carries 8 grade previews (`preview` + `previewAfterAgain`, each with an ISO instant) and the
// coach texts (≈ 1.6 KB). What reaches the network is gzip, and every gzip figure of §9.4 holds on these fixtures, the
// 50-row bank page included (≈ 3.5 KB; FIX-1 dropped BankRow.mistakeRef, ≈ 1 KB of it). A real member's bank has more
// varied positions (≈ 4.8 KB projected for 50 rows, budgets.contract.int.test.ts), so its ceiling is 5 KB. The raw
// ceilings below are the measured worst cases plus ≈ 5 %.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  attemptsFixture,
  attemptsResultFixture,
  badgesFixture,
  bankPageFixture,
  homeFixture,
  HOME_STATES,
  manyBankRows,
  sessionWithItems,
  TODAY_STATES,
  trainTodayFixture,
} from "./fixtures/p05";
import { AttemptsBody, AttemptsResult, Badges, BankPage, SessionPayload, TrainToday } from "./train";
import { HomeData } from "./home";
import type { BankRow, SessionPayload as SessionPayloadT } from "./train";
import { P5_PAYLOAD_BUDGETS } from "./train-budgets";

/** The §9.4 table as asserted here (bytes): train-budgets.ts, shared with the routes' real-answer test in apps/web. */
export { P5_PAYLOAD_BUDGETS };

const envelope = (data: unknown) => JSON.stringify({ data });
const raw = (s: string) => Buffer.byteLength(s, "utf8");
const gz = (s: string) => gzipSync(s).length;

/** mulberry32: a fixed-seed PRNG (no dependency). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function entropy(seed: number) {
  const rnd = mulberry32(seed);
  const draw = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
  const SQID = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CUID = "abcdefghijklmnopqrstuvwxyz0123456789";
  return {
    cardKey: () => `m_${draw(SQID, 12)}`,
    ref: () => `c${draw(CUID, 24)}`,
    /** The same pieces per rank, mirrored at random: a different position string with the same length. */
    fen: (fen: string) => {
      const [board, ...rest] = fen.split(" ");
      const ranks = board!.split("/").map((r) => (rnd() < 0.5 ? r : r.split("").reverse().join("")));
      return [ranks.join("/"), ...rest].join(" ");
    },
    int: (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)),
  };
}

function realisticRows(n: number, seed: number): BankRow[] {
  const e = entropy(seed);
  return manyBankRows(n, { long: false }).map((r) => ({
    ...r,
    cardRef: e.cardKey(),
    gameRef: e.ref(),
    fen: e.fen(r.fen),
    moveNo: e.int(5, 60),
    gamePly: e.int(8, 120),
  }));
}

function realisticSession(n: number, kind: "bank" | "puzzles", seed: number): SessionPayloadT {
  const e = entropy(seed);
  const s = sessionWithItems(n, kind);
  return {
    ...s,
    items: s.items.map((it) => ({
      ...it,
      cardRef: it.cardRef ? e.cardKey() : null,
      fen: e.fen(it.fen),
      context: it.context ? { ...it.context, gameRef: e.ref(), gamePly: e.int(8, 120) } : null,
    })),
  };
}

function check(name: string, json: string, budget: { raw: number; gzip?: number }) {
  const r = raw(json);
  assert.ok(r <= budget.raw, `${name}: ${r} B raw > ${budget.raw} B`);
  if (budget.gzip !== undefined) {
    const g = gz(json);
    assert.ok(g <= budget.gzip, `${name}: ${g} B gzip > ${budget.gzip} B`);
  }
}

describe("P5 payload budgets (§9.4)", () => {
  it("GET /api/train/today: every state ≤ 4 KB raw, ≤ 1.5 KB gzip", () => {
    for (const state of TODAY_STATES) {
      const data = trainTodayFixture(state);
      assert.equal(TrainToday.safeParse(data).success, true, state);
      check(`today ${state}`, envelope(data), P5_PAYLOAD_BUDGETS.today);
    }
  });

  it("GET /api/train/bank: 50 rows and the whole 300-row bank (realistic entropy)", () => {
    const page50 = { ...bankPageFixture("default"), rows: realisticRows(50, 7) };
    assert.equal(BankPage.safeParse(page50).success, true);
    check("bank 50", envelope(page50), P5_PAYLOAD_BUDGETS.bank50);
    // §9.4's own 4 KB holds on the fixture (no mistake ref per row, FIX-1).
    check("bank 50 (plan gzip)", envelope(page50), { raw: P5_PAYLOAD_BUDGETS.bank50.raw, gzip: P5_PAYLOAD_BUDGETS.bank50.plan.gzip });
    const page300 = { ...bankPageFixture("stress"), rows: realisticRows(300, 11) };
    assert.equal(BankPage.safeParse(page300).success, true);
    check("bank 300", envelope(page300), P5_PAYLOAD_BUDGETS.bank300);
    // The stress fixture itself (long names everywhere) stays inside the raw ceiling too.
    check("bank stress fixture", envelope(bankPageFixture("stress")), P5_PAYLOAD_BUDGETS.bank300);
  });

  it("POST /api/train/sessions: 10 and 20 items, bank and puzzles", () => {
    for (const kind of ["bank", "puzzles"] as const) {
      const s10 = realisticSession(10, kind, 3);
      const s20 = realisticSession(20, kind, 5);
      assert.equal(SessionPayload.safeParse(s10).success, true, kind);
      assert.equal(SessionPayload.safeParse(s20).success, true, kind);
      check(`session ${kind} 10`, envelope(s10), P5_PAYLOAD_BUDGETS.session10);
      check(`session ${kind} 20`, envelope(s20), P5_PAYLOAD_BUDGETS.session20);
    }
  });

  it("POST /api/train/attempts: a 50-attempt body (route limit 64 KB) and its result", () => {
    const body = { attempts: attemptsFixture(50) };
    assert.equal(AttemptsBody.safeParse(body).success, true);
    check("attempts body 50", JSON.stringify(body), P5_PAYLOAD_BUDGETS.attemptsBody50);
    assert.ok(raw(JSON.stringify(body)) <= 65_536 / 2, "well inside the route's body limit");
    const result = attemptsResultFixture(50);
    assert.equal(AttemptsResult.safeParse(result).success, true);
    check("attempts result 50", envelope(result), P5_PAYLOAD_BUDGETS.attemptsResult50);
  });

  it("GET /api/home: every state ≤ 6 KB raw, ≤ 2.5 KB gzip; GET /api/me/badges ≤ 100 B", () => {
    for (const state of HOME_STATES) {
      const data = homeFixture(state);
      assert.equal(HomeData.safeParse(data).success, true, state);
      check(`home ${state}`, envelope(data), P5_PAYLOAD_BUDGETS.home);
    }
    const badges = badgesFixture();
    assert.equal(Badges.safeParse(badges).success, true);
    check("badges", envelope({ bankDue: 99_999, trainDot: false }), P5_PAYLOAD_BUDGETS.badges);
  });

  it("the measured raw ceilings are real: the plan's figure cannot hold the realistic payload", () => {
    assert.ok(raw(envelope({ ...bankPageFixture("default"), rows: realisticRows(50, 7) })) > P5_PAYLOAD_BUDGETS.bank50.plan.raw);
    assert.ok(raw(envelope(realisticSession(10, "bank", 3))) > P5_PAYLOAD_BUDGETS.session10.plan.raw);
    assert.ok(raw(JSON.stringify({ attempts: attemptsFixture(50) })) > P5_PAYLOAD_BUDGETS.attemptsBody50.plan.raw);
  });
});
