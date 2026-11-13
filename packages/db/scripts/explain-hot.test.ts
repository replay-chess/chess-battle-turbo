import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAYLOAD_V_SQL } from "../../../apps/analysis-worker/src/queue/claim";
import {
  adoptOrClaimSql,
  claimSql,
  g1Sql,
  inlineStatement,
  P3_HOT_QUERIES,
  P4_ARCHIVE_HOT_QUERIES,
  planIssues,
  p3Queries,
  reaperSql,
  SEQSCAN_MIN_ROWS,
  sqlLiteral,
  summarySql,
  type PlanNode,
} from "./explain-hot";

const seq = (rel: string, actual?: number): PlanNode => ({ "Node Type": "Seq Scan", "Relation Name": rel, ...(actual !== undefined ? { "Actual Rows": actual, "Actual Loops": 1 } : {}) });
const idx = (rel: string): PlanNode => ({ "Node Type": "Index Scan", "Relation Name": rel });

describe("explain-hot plan checks", () => {
  it("shape: a Seq Scan on a listed table and a Sort over game_players fail", () => {
    const q = { noSeqScan: ["games", "game_players"], noSort: ["game_players"] };
    assert.deepEqual(planIssues({ "Node Type": "Limit", Plans: [idx("game_players")] }, q).problems, []);
    assert.deepEqual(planIssues(seq("games"), q).problems, ["Seq Scan on games"]);
    assert.deepEqual(planIssues(seq("users"), q).problems, [], "unlisted tables may be scanned");
    const sorted: PlanNode = { "Node Type": "Sort", Plans: [{ "Node Type": "Nested Loop", Plans: [idx("game_players"), idx("games")] }] };
    assert.deepEqual(planIssues(sorted, q).problems, ["Sort over game_players"]);
    assert.deepEqual(planIssues({ "Node Type": "Sort", Plans: [idx("games")] }, q).problems, []);
  });

  it("measure: a Seq Scan is the right plan on a small table, or when it keeps most of the table", () => {
    const q = { noSeqScan: ["game_players"], noSort: [] };
    const rows = new Map([["game_players", 50_000]]);
    assert.deepEqual(planIssues(seq("game_players", 40), q, rows).problems, ["Seq Scan on game_players (50000 rows, kept 40)"]);
    const most = planIssues(seq("game_players", 45_000), q, rows);
    assert.deepEqual(most.problems, []);
    assert.match(most.notes[0]!, /keeps 45000 of 50000/);
    const small = planIssues(seq("game_players", 3), q, new Map([["game_players", SEQSCAN_MIN_ROWS - 1]]));
    assert.deepEqual(small.problems, []);
    assert.match(small.notes[0]!, /right plan at that size/);
  });

  it("covers every query §12.7 names, with the §9.2/§9.3 buffer targets", () => {
    const names = P3_HOT_QUERIES.map((q) => q.name);
    for (const n of ["A1 review read", "ETag probe", "G1 archive page 1", "G1 archive page 3", "G1 counts", "claim", "reaper", "kick CAS"]) {
      assert.ok(names.some((x) => x.includes(n)), n);
    }
    assert.equal(P3_HOT_QUERIES.find((q) => q.name.includes("A1 review"))!.maxSharedBuffers, 30);
    assert.equal(P3_HOT_QUERIES.find((q) => q.name.includes("page 3"))!.maxSharedBuffers, 200);
    for (const q of P3_HOT_QUERIES) assert.ok(!/\$\d/.test(q.sql), `${q.name}: literals only (EXPLAIN takes no bind parameters)`);
  });

  // regression: explain-gate-checks-copies (FIX-2, review round 2). The gate EXPLAINed hand-written copies of the claim
  // and the reaper, so a change to the worker's real SQL could not fail it, and the adopt form was not gated at all.
  it("gates the worker's own queue statements (claim, adopt-or-claim, reaper and its retry form, summary)", () => {
    assert.ok(claimSql().includes(PAYLOAD_V_SQL), "the worker's payload-version predicate");
    assert.match(adoptOrClaimSql(), /WITH adopted AS/);
    assert.match(adoptOrClaimSql(), /<> ALL\('\{"1","2"\}'::bigint\[\]\)/);
    assert.match(reaperSql(), /"lockedBy" LIKE 'dev-worker-________'/);
    assert.match(reaperSql(true), /"finishedAt" >= /, "the retry form's own branch");
    assert.match(summarySql(), /AS "nextRunAtMs"/);
    const names = P3_HOT_QUERIES.map((q) => q.name);
    for (const n of ["worker claim (", "adopt or claim", "worker reaper (", "reaper retry form", "drain-end summary"]) {
      assert.ok(names.some((x) => x.includes(n)), n);
    }
  });

  // regression: D6 — the /games counts joined games for every finished game of the member.
  it("gates the web's P4 archive statements: the counts read game_players alone, within a buffer budget", () => {
    const counts = P4_ARCHIVE_HOT_QUERIES.find((q) => q.name.startsWith("P4 G1 counts"))!;
    assert.ok(counts, "the counts row");
    assert.doesNotMatch(counts.sql, /JOIN games/);
    assert.match(counts.sql, /FROM game_players gp/);
    assert.equal(counts.maxSharedBuffers, 400);
    const tab = P4_ARCHIVE_HOT_QUERIES.find((q) => q.name.includes("Chess.com tab"))!;
    assert.match(tab.sql, /gp\.source = 'CHESSCOM'::"GameSource"/);
    for (const q of P4_ARCHIVE_HOT_QUERIES) assert.ok(!/\$\d/.test(q.sql), `${q.name}: literals only`);
  });

  it("inlines bound values as SQL literals ($10 before $1)", () => {
    assert.equal(sqlLiteral(null), "NULL");
    assert.equal(sqlLiteral(true), "TRUE");
    assert.equal(sqlLiteral(7), "7");
    assert.equal(sqlLiteral("it's"), "'it''s'");
    assert.equal(sqlLiteral(["A", 'b"c']), `'{"A","b\\"c"}'`);
    assert.equal(sqlLiteral([]), "'{}'");
    const vals = Array.from({ length: 10 }, (_, i) => i + 1);
    assert.equal(inlineStatement({ text: "SELECT $1, $10, $2::int", values: vals }), "SELECT 1, 10, 2::int");
  });

  it("G1 pages: the keyset cursor only from page 2 on; no page 3 without a cursor", () => {
    assert.ok(!g1Sql("1", null).includes('("endedAt", gp."gameId") <'));
    assert.match(g1Sql("1", { endedAt: "2026-11-01 00:00:00.000", gameId: "42" }), /\(gp\."endedAt", gp\."gameId"\) < \('2026-11-01 00:00:00\.000'::timestamp\(3\), 42::bigint\)/);
    const q = p3Queries({ viewerId: "1", ref: "c'quote", gameId: "1", page3: null, epds: [] });
    assert.ok(!q.some((x) => x.name.includes("page 3")));
    assert.ok(q.find((x) => x.name.includes("A1 review"))!.sql.includes("'c''quote'"), "literals are quoted");
  });
});
