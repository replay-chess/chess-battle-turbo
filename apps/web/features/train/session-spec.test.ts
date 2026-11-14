// The runner pages' URL → session spec (phase-05 plan §4.4, §4.5 "Route"); every spec parses with the W2 schema.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionCreate } from "@repo/contracts/http/train";
import { bankSpec, clientGradedOf, puzzlesSpec, resumeRef, returnPath, specSource, wantsPicker } from "./session-spec";

const GAME = "cm3k9x2p10007slzpqa8hd4fe";

test("bank: plan, card, cards, game, filter, practice, the due queue", () => {
  assert.deepEqual(bankSpec({ plan: "1" }), { kind: "daily", source: "plan" });
  assert.deepEqual(bankSpec({ card: "m_abc12" }), { kind: "bank", source: "solve_one", cardRefs: ["m_abc12"] });
  assert.deepEqual(bankSpec({ card: "m_abc12", from: "home" }), { kind: "bank", source: "home", cardRefs: ["m_abc12"] });
  assert.deepEqual(bankSpec({ cards: "m_a1, m_b2,bad key,m_a1" }), { kind: "bank", source: "bank", cardRefs: ["m_a1", "m_b2"] });
  assert.deepEqual(bankSpec({ game: GAME }), { kind: "bank", source: "review_complete", gameRef: GAME });
  assert.deepEqual(bankSpec({ theme: "fork", phase: "endgame", source: "own" }), { kind: "bank", source: "bank", filter: { theme: "fork", phase: "endgame", source: "own" } });
  assert.deepEqual(bankSpec({ practice: "1" }), { kind: "bank", source: "bank", practice: true });
  assert.deepEqual(bankSpec({}), { kind: "bank", source: "hub" });
  // Junk is ignored, never passed on.
  assert.deepEqual(bankSpec({ card: "<script>", theme: "x", phase: "late", source: "nope" }), { kind: "bank", source: "hub" });
});

test("puzzles: theme, n (1–10), source", () => {
  assert.deepEqual(puzzlesSpec({ theme: "fork", n: "3", source: "plan" }), { kind: "puzzles", source: "plan", theme: "fork", count: 3 });
  assert.deepEqual(puzzlesSpec({ n: "40" }), { kind: "puzzles", source: "nav" });
  assert.deepEqual(puzzlesSpec({ theme: "rc:recapture" }), { kind: "puzzles", source: "nav", theme: "rc:recapture" });
  assert.equal(wantsPicker({ pick: "1" }), true);
});

test("every spec is a valid W2 body", () => {
  for (const sp of [{ plan: "1" }, { card: "m_abc12" }, { cards: "m_a1,m_b2" }, { game: GAME }, { theme: "fork", source: "missed" }, {}, { practice: "1" }]) {
    assert.ok(SessionCreate.safeParse(bankSpec(sp)).success, JSON.stringify(sp));
  }
  assert.ok(SessionCreate.safeParse(puzzlesSpec({ theme: "pin", n: "10", source: "hub" })).success);
});

test("resume refs, sources and return paths", () => {
  assert.equal(resumeRef({ s: GAME }), GAME);
  assert.equal(resumeRef({ s: "../x" }), null);
  assert.equal(specSource({ kind: "daily" }), "plan");
  assert.equal(specSource({ kind: "practice", fromSessionRef: GAME }), "deeplink");
  assert.equal(returnPath("/train/puzzles", { theme: "fork", n: ["3", "4"] }), "/train/puzzles?theme=fork&n=3");
});

test("the summary's ?n=", () => {
  assert.equal(clientGradedOf("4"), 4);
  assert.equal(clientGradedOf(undefined), null);
  assert.equal(clientGradedOf("-1"), null);
  assert.equal(clientGradedOf("abc"), null);
  assert.equal(clientGradedOf(["0"]), 0);
});
