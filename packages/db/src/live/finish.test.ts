import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "#generated";
import { finishGameSql, type FinishFragment, type FinishGameInput } from "./finish";

const base: FinishGameInput = {
  gameId: 1n,
  moves: "e2e4 e7e5",
  clocksMs: [299000, 298000],
  plyCount: 2,
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  whiteTimeMs: 299000,
  blackTimeMs: 298000,
  method: "resignation",
  winner: "w",
  pgn: "1. e4 e5 1-0",
  endedAt: new Date(0),
};

describe("finishGameSql (plan 6.6.4)", () => {
  it("is one WITH statement with g, gp, us, tp and uv", () => {
    const sql = finishGameSql(base, []).text;
    assert.match(sql, /^WITH g AS \(/);
    for (const cte of ["gp AS (", "us AS (", "tp AS (", "uv AS ("]) assert.ok(sql.includes(cte), cte);
    assert.match(sql, /WHERE id = \$\d+ AND status = 'IN_PROGRESS'/);
    assert.equal(sql.split(";").length, 1);
  });

  it("appends named fragments (P3/P9 shape) to g's SET, gp's SET, the CTE list and the SELECT", () => {
    const p3: FinishFragment = {
      name: "p3_jobs",
      gameSet: () => [Prisma.sql`"analysisStatus" = 'QUEUED'`],
      playerSet: () => [Prisma.sql`"ratingAfter" = NULL`],
      cte: () => Prisma.sql`SELECT g.id FROM g`,
      select: () => [Prisma.sql`(SELECT count(*) FROM p3_jobs)::int AS queued`],
    };
    const sql = finishGameSql(base, [p3]).text;
    assert.ok(sql.includes(`"analysisStatus" = 'QUEUED'`));
    assert.ok(sql.includes(`"ratingAfter" = NULL`));
    assert.ok(sql.includes("p3_jobs AS (SELECT g.id FROM g)"));
    assert.ok(sql.includes("AS queued"));
  });

  it("refuses aborted (use abortGame) and bad fragment names", () => {
    assert.throws(() => finishGameSql({ ...base, method: "aborted" as never }, []), /abortGame/);
    assert.throws(() => finishGameSql(base, [{ name: "Bad Name", cte: () => Prisma.sql`SELECT 1` }]), /identifier/);
  });
});
