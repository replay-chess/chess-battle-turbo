// The P5 hot-query gate's plan rules (scripts/explain-hot-queries.ts): a Seq Scan over a P5 table or game_players
// fails; a full Sort over the listed tables fails; an Incremental Sort is allowed only for a declared (due, id) tie
// break; P3's review reads keep their LATERAL member pick. The query list covers §9.1's paths and every P5 index name
// comes from docs/indexes.json.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { p5HotQueries, p5IndexNames, p5PlanProblems } from "./explain-hot-queries";

const scan = (rel: string, type = "Index Scan") => ({ "Node Type": type, "Relation Name": rel });

describe("P5 explain gate", () => {
  it("flags Seq Scans over P5 tables and Sorts over the hot ones", () => {
    assert.deepEqual(p5PlanProblems(scan("training_cards", "Seq Scan"), {}), ["Seq Scan on training_cards"]);
    assert.deepEqual(p5PlanProblems(scan("users", "Seq Scan"), {}), []);
    assert.deepEqual(p5PlanProblems({ "Node Type": "Sort", Plans: [scan("training_attempts")] }, {}), ["Sort over training_attempts"]);
    assert.deepEqual(p5PlanProblems({ "Node Type": "Sort", Plans: [scan("training_days")] }, {}), []);
  });

  it("an Incremental Sort is a tie break on `due` only where declared; P3's review reads keep their pick", () => {
    const inc = { "Node Type": "Incremental Sort", "Presorted Key": ["c.due"], Plans: [scan("training_cards")] };
    assert.deepEqual(p5PlanProblems(inc, { tieBreak: true }), []);
    assert.equal(p5PlanProblems(inc, {}).length, 1);
    const other = { "Node Type": "Incremental Sort", "Presorted Key": ["\"reviewedAt\""], Plans: [scan("training_attempts")] };
    assert.equal(p5PlanProblems(other, { tieBreak: true }).length, 1);
    assert.deepEqual(p5PlanProblems({ "Node Type": "Sort", Plans: [scan("game_players")] }, { allowSort: ["game_players"] }), []);
  });

  it("lists the §9.1 paths and the P5 indexes", () => {
    const names = p5HotQueries().map((q) => q.name);
    for (const prefix of ["R1 (a)", "R2 complete", "R2 paged", "A1 review read", "A6", "W2 due queue", "W2/W3 recently seen", "W1 locked read", "W1 batch write", "R3/W4 summary", "HOME h1", "/api/me", "W7"]) {
      assert.ok(names.some((n) => n.startsWith(prefix)), prefix);
    }
    const idx = p5IndexNames();
    for (const n of ["training_attempts_puzzle_idx", "training_cards_userId_deck_due_idx", "reports_reporterId_createdAt_idx"]) assert.ok(idx.includes(n), n);
  });
});
