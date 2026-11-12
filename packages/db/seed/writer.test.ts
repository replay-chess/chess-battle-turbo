import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEV_ENV_FILE, SeedGuardError } from "../prisma/seed-guards";
import { buildFixture, type SeedFixture } from "./builders";
import { gameFixture, type ReviewSeedContext } from "./review";
import { perfFixtures } from "./perf-archive";
import { assertWriteTarget, parseFlags, positiveInt, resolveWriteTarget } from "./target";
import {
  bumpGamesVersionSql,
  deleteGamesSql,
  fixtureAction,
  insertFixturesSql,
  pgArray,
  SHARED_LETTER_EMAIL,
  type StoredFixture,
} from "./writer";

const DEV = "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech";
const ctx = {
  member: { id: 8n, ref: "cmember000000000000000008", name: "A", rating: 1184 },
  talFan: { id: 100n, ref: "cmember000000000000000100", name: "tal_fan_77", rating: 1203 },
} as Pick<ReviewSeedContext, "member" | "talFan">;

describe("target guards", () => {
  it("accepts the dev endpoint and local Postgres only", () => {
    assert.equal(assertWriteTarget(`postgresql://u:p@${DEV}/neondb`), DEV);
    assert.equal(assertWriteTarget("postgresql://postgres:pw@localhost:55510/replay"), "localhost");
    assert.equal(assertWriteTarget("postgres://u:p@postgres:5432/replay"), "postgres");
    assert.throws(() => assertWriteTarget("postgresql://u:p@ep-shiny-shape-b8lvr0f5.c-14.us-east-1.aws.neon.tech/neondb"), SeedGuardError);
    assert.throws(() => assertWriteTarget("postgresql://u:p@ep-still-brook-a5nutqwh.us-east-2.aws.neon.tech/x"), /neither/);
    assert.throws(() => assertWriteTarget(""), SeedGuardError);
  });

  it("resolves DIRECT_URL from the shell, else the dev env file, never echoing it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p3-seed-"));
    writeFileSync(path.join(dir, DEV_ENV_FILE), `DIRECT_URL=postgresql://u:secret@${DEV}/neondb\n`);
    const fromFile = resolveWriteTarget({}, dir);
    assert.deepEqual([fromFile.host, fromFile.kind, fromFile.origin], [DEV, "neon-dev", DEV_ENV_FILE]);
    const fromShell = resolveWriteTarget({ DIRECT_URL: "postgresql://postgres:pw@localhost:5/replay" }, dir);
    assert.deepEqual([fromShell.host, fromShell.kind], ["localhost", "local"]);
    assert.match(fromShell.origin, /shell/);
    assert.throws(() => resolveWriteTarget({ DATABASE_URL: "postgresql://u:secret@db.example.com/x" }, dir), (e: Error) => !e.message.includes("secret"));
    assert.throws(() => resolveWriteTarget({}, path.join(dir, "missing")), /not set/);
  });

  it("parses flags strictly", () => {
    const r = parseFlags(["--apply", "--limit", "5", "--since=2026-10-01"], { booleans: ["--apply"], values: ["--limit", "--since"] });
    assert.ok(r.flags.has("--apply"));
    assert.equal(r.values.get("--limit"), "5");
    assert.equal(r.values.get("--since"), "2026-10-01");
    assert.throws(() => parseFlags(["--force"], { booleans: ["--apply"], values: [] }), /unknown argument/);
    assert.throws(() => parseFlags(["--limit"], { booleans: [], values: ["--limit"] }), /needs a value/);
    assert.throws(() => parseFlags(["--limit", "--apply"], { booleans: ["--apply"], values: ["--limit"] }), /needs a value/);
    assert.equal(positiveInt("--n", undefined, 7, 10), 7);
    assert.equal(positiveInt("--n", "10", 7, 10), 10);
    assert.throws(() => positiveInt("--n", "11", 7, 10), /at most/);
    assert.throws(() => positiveInt("--n", "0", 7, 10), /positive/);
  });
});

describe("fixtureAction", () => {
  const f = gameFixture(ctx);
  const stored = (over: Partial<StoredFixture> = {}): StoredFixture => ({
    ref: f.game.ref,
    hash: f.hash,
    analysisStatus: "DONE",
    jobStatus: "DONE",
    jobAttempts: 1,
    hasAnalysis: true,
    reviews: 2,
    legend: [],
    ...over,
  });

  it("insert, unchanged, and a pruned DONE job is still unchanged", () => {
    assert.deepEqual(fixtureAction(f, undefined), { action: "insert" });
    assert.deepEqual(fixtureAction(f, stored()), { action: "unchanged" });
    assert.deepEqual(fixtureAction(f, stored({ jobStatus: null, jobAttempts: null })), { action: "unchanged" });
  });

  it("rewrites a changed definition, a drifted state or a foreign row", () => {
    assert.equal(fixtureAction(f, stored({ hash: "other" })).action, "update");
    assert.equal(fixtureAction(f, stored({ hash: null })).action, "update");
    assert.equal(fixtureAction(f, stored({ analysisStatus: "QUEUED" })).action, "update");
    assert.equal(fixtureAction(f, stored({ jobStatus: "QUEUED" })).action, "update");
    assert.equal(fixtureAction(f, stored({ hasAnalysis: false })).action, "update");
    assert.equal(fixtureAction(f, stored({ reviews: 1 })).action, "update");
    assert.equal(fixtureAction(f, stored({ legend: [{ userId: "8", status: "READY" }] })).action, "update");
  });

  it("an unanalysed fixture must have no job; loose only compares the hash", () => {
    const u = buildFixture({ ...specOf(f), key: "U", analysis: { kind: "none" } });
    const s: StoredFixture = { ref: u.game.ref, hash: u.hash, analysisStatus: "NONE", jobStatus: null, jobAttempts: null, hasAnalysis: false, reviews: 0, legend: [] };
    assert.equal(fixtureAction(u, s).action, "unchanged");
    assert.equal(fixtureAction(u, { ...s, analysisStatus: "QUEUED", jobStatus: "QUEUED", jobAttempts: 0 }).action, "update");
    assert.equal(fixtureAction(u, { ...s, analysisStatus: "DONE", hasAnalysis: true, reviews: 1, jobStatus: "DONE" }, { loose: true }).action, "unchanged");
  });
});

function specOf(f: SeedFixture) {
  return {
    key: f.key,
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w" as const,
    opponent: { kind: "member" as const, member: ctx.talFan },
    mode: "ONLINE" as const,
    startFen: f.game.startingFen,
    moves: f.game.moves.split(" "),
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome: "BLACK" as const,
    method: "RESIGNATION" as const,
    completedAt: f.game.completedAt,
    tag: "review",
  };
}

describe("SQL builders", () => {
  it("pgArray writes Postgres array literals and refuses non-finite numbers", () => {
    assert.equal(pgArray([]), "{}");
    assert.equal(pgArray([1, -2, 96.5]), "{1,-2,96.5}");
    assert.throws(() => pgArray([Number.NaN]), RangeError);
  });

  it("one statement per chunk stays far under Postgres's 65,535 bind parameters", () => {
    const rows = perfFixtures(ctx.member, 100, 1n);
    const sql = insertFixturesSql(rows);
    assert.ok(sql.values.length < 20_000, `${sql.values.length} parameters`);
    for (const cte of ["g AS", "gp AS", "a AS", "pr AS", "j AS"]) assert.ok(sql.sql.includes(cte), cte);
    assert.ok(!sql.sql.includes("lc AS"), "no legend rows, no legend CTE");
    assert.throws(() => insertFixturesSql([]), /no fixtures/);
  });

  it("deletes jobs by dedupe key (analysis and legend) before the cascading game delete", () => {
    const [jobs, games] = deleteGamesSql(["cref"]);
    assert.match(jobs!.sql, /'analyze:' \|\| g\.id/);
    assert.match(jobs!.sql, /'legend:' \|\| g\.id \|\| ':%'/);
    assert.match(games!.sql, /DELETE FROM games/);
    assert.deepEqual(bumpGamesVersionSql([1n, 2n, 1n]).values, [["1", "2"]]);
  });

  it("recognises the shared e2e letters A–R, not the pool or S", () => {
    assert.ok(SHARED_LETTER_EMAIL.test("e2e-playera+clerk_test@chessbattle.dev"));
    assert.ok(SHARED_LETTER_EMAIL.test("e2e-playerr+clerk_test@chessbattle.dev"));
    assert.ok(!SHARED_LETTER_EMAIL.test("e2e-players+clerk_test@chessbattle.dev"));
    assert.ok(!SHARED_LETTER_EMAIL.test("e2e-pool03+clerk_test@chessbattle.dev"));
  });
});
