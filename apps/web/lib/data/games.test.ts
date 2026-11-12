// The archive DAL's rules (phase-03 plan §12.1 `WEB/lib/data/games.test.ts`): the keyset cursor (encode, decode,
// tamper → 400), the filter parsing (csv, unknown values dropped, canonical order, a 1-character search ignored,
// `moments=0` is no filter), counts only on page 1 or with `limit=0`, absent on page 2, the ETag from gamesVersion,
// the row mapping, and the statement shapes. The SQL itself runs in test/api/archive.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeCursor } from "@repo/contracts/http/cursor";
import { GameRowDTO, GamesQuery } from "@repo/contracts/http/games";
import type { Prisma } from "@repo/db";
import { isApiError } from "@/lib/api/api-error";
import type { GamesDb } from "@/lib/games/snapshot.server";
import {
  archiveEtag,
  archiveRequestOf,
  countsWanted,
  decodeArchiveCursor,
  encodeArchiveCursor,
  gameRowOf,
  listMyGames,
  parseGamesFilter,
} from "@/lib/services/analysis/archive";
import { archiveCountsSql, archivePageSql, likePattern, type ArchiveRow } from "@/lib/services/analysis/archive-sql";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

function archiveRow(i: number, overrides: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    gameId: BigInt(1000 - i),
    ref: `cgame${String(i).padStart(21, "0")}`,
    color: "w",
    result: "LOSS",
    timeClass: "RAPID",
    mode: "ONLINE",
    endedAt: new Date(NOW - i * 3_600_000),
    opponentName: "tal_fan_77",
    opponentRating: 1203,
    opponentUserId: 2n,
    ratingDelta: null,
    accuracy: 84.6,
    headline: "Missed Rxf5 · move 19",
    momentsCount: 3,
    ecoCode: "C59",
    source: "REPLAY",
    analysisStatus: "DONE",
    fen: "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1",
    openingName: "Two Knights Defense",
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    positionTitle: null,
    hasComparison: false,
    ...overrides,
  };
}

function fakeDb(answer: (sql: Prisma.Sql) => unknown[]): GamesDb & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    $queryRaw: async <T>(sql: Prisma.Sql) => {
      seen.push(textOf(sql));
      return answer(sql) as T;
    },
    $executeRaw: async () => {
      throw new Error("the archive never writes");
    },
  };
}

const req = (query: Record<string, string>) => archiveRequestOf(GamesQuery.parse(query));

describe("cursor", () => {
  it("round-trips the last row's (endedAt, gameId)", () => {
    const c = encodeArchiveCursor({ endedAt: new Date("2026-11-10T08:30:00.123Z"), gameId: 4242n });
    assert.deepEqual(decodeArchiveCursor(c), { endedAt: "2026-11-10T08:30:00.123Z", gameId: "4242" });
    assert.equal(decodeArchiveCursor(undefined), null);
    assert.equal(decodeArchiveCursor(""), null);
  });

  it("a tampered cursor is a 400 on `cursor`, never a scan from the start", () => {
    const bad = [
      "%%%",
      encodeCursor(["2026-11-10T08:30:00.123Z"]),
      encodeCursor(["2026-11-10", "1"]),
      encodeCursor(["2026-11-10T08:30:00.123Z", "-5"]),
      encodeCursor(["2026-11-10T08:30:00.123Z", "1 OR 1=1"]),
      encodeCursor(["2026-11-10T08:30:00.123Z", 7]),
      encodeCursor(["2026-11-10T08:30:00.123Z", "99999999999999999999"]),
      encodeCursor(["2026-11-10T08:30:00.123Z", "9999999999999999999"]),
      encodeCursor(["2026-13-40T08:30:00.123Z", "1"]),
    ];
    for (const c of bad) {
      assert.throws(
        () => decodeArchiveCursor(c),
        (e) => isApiError(e) && e.code === "validation_failed" && !!e.fields?.cursor,
        c,
      );
    }
  });
});

describe("filters", () => {
  it("csv lists in canonical order with unknown values dropped; a 1-character search ignored; moments=0 is no filter", () => {
    assert.deepEqual(req({ result: "draw,WIN,nope", tc: "rapid,blitz,daily", q: "  tal ", moments: "1" }).filter, {
      q: "tal",
      result: ["win", "draw"],
      tc: ["blitz", "rapid"],
      moments: true,
    });
    assert.deepEqual(req({ q: "t", moments: "0" }).filter, {});
    assert.deepEqual(req({}), { filter: {}, cursor: null, limit: 30 });
    assert.equal(req({ limit: "0" }).limit, 0);
  });

  it("the RSC's searchParams parse the same way as G1's query", () => {
    const sp = { result: ["loss", "win"], tc: "classical", moments: "true", q: "opera" };
    assert.deepEqual(parseGamesFilter(sp), { q: "opera", result: ["loss"], tc: ["classical"], moments: true });
    assert.deepEqual(parseGamesFilter({ moments: "0", q: "x" }), {});
  });

  it("search wildcards are literal", () => {
    assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
  });
});

describe("counts (AP-38)", () => {
  it("page 1 and limit=0 count; page 2 does not", () => {
    assert.equal(countsWanted({ cursor: null, limit: 30 }), true);
    assert.equal(countsWanted({ cursor: { endedAt: "2026-11-10T08:30:00.123Z", gameId: "1" }, limit: 30 }), false);
    assert.equal(countsWanted({ cursor: { endedAt: "2026-11-10T08:30:00.123Z", gameId: "1" }, limit: 0 }), true);
  });

  it("page 1: the page and the counts in parallel, nextCursor from the 31st row", async () => {
    const db = fakeDb((sql) =>
      textOf(sql).includes("filteredTotal") ? [{ filteredTotal: 40, all: 52 }] : Array.from({ length: 31 }, (_, i) => archiveRow(i)),
    );
    const out = await listMyGames(db, { id: 5n }, req({}), NOW);
    assert.equal(db.seen.length, 2);
    assert.equal(out.rows.length, 30);
    assert.deepEqual(decodeArchiveCursor(out.meta.nextCursor), { endedAt: archiveRow(29).endedAt.toISOString(), gameId: "971" });
    assert.deepEqual({ f: out.meta.filteredTotal, c: out.meta.counts }, { f: 40, c: { all: 52 } });
  });

  it("page 2: one statement, no totals; the last page has no nextCursor", async () => {
    const db = fakeDb(() => [archiveRow(30), archiveRow(31)]);
    const out = await listMyGames(db, { id: 5n }, { filter: {}, cursor: { endedAt: "2026-11-10T08:30:00.123Z", gameId: "971" }, limit: 30 }, NOW);
    assert.equal(db.seen.length, 1);
    assert.deepEqual(out.meta, { nextCursor: null });
  });

  it("limit=0: the counts statement only", async () => {
    const db = fakeDb(() => [{ filteredTotal: 3, all: 9 }]);
    const out = await listMyGames(db, { id: 5n }, req({ limit: "0", result: "draw" }), NOW);
    assert.equal(db.seen.length, 1);
    assert.match(db.seen[0]!, /filteredTotal/);
    assert.deepEqual(out, { rows: [], meta: { nextCursor: null, filteredTotal: 3, counts: { all: 9 } } });
  });
});

describe("ETag (P3-D27)", () => {
  const base = req({ result: "loss" });
  it("g<gamesVersion>-<16 hex>, stable for an equal request, different for anything that changes the answer", () => {
    const tag = archiveEtag(7, base, NOW);
    assert.match(tag, /^g7-[0-9a-f]{16}$/);
    assert.equal(archiveEtag(7, req({ result: "loss,nope" }), NOW), tag, "the canonical filter");
    assert.notEqual(archiveEtag(8, base, NOW), tag, "a new game or analysis bumps gamesVersion");
    assert.notEqual(archiveEtag(7, req({ result: "win" }), NOW), tag);
    assert.notEqual(archiveEtag(7, req({ result: "loss", limit: "0" }), NOW), tag);
    assert.notEqual(archiveEtag(7, { ...base, cursor: { endedAt: "2026-11-10T08:30:00.123Z", gameId: "1" } }, NOW), tag);
    assert.notEqual(archiveEtag(7, base, Date.parse("2027-01-01T00:00:00Z")), tag, "the date labels drop the year in the current year");
    assert.equal(archiveEtag(7, base, Date.parse("2026-12-31T23:00:00Z")), tag);
  });
});

describe("rows", () => {
  it("GameRowDTO: wire enums, a rounded accuracy, the opponent kind, the opening only with a valid ECO", () => {
    const row = GameRowDTO.parse(gameRowOf(archiveRow(1), NOW));
    assert.deepEqual(
      { r: row.result, s: row.analysisStatus, a: row.accuracy, k: row.opponent.kind, o: row.opening, tc: row.tc, src: row.source },
      {
        r: "loss",
        s: "done",
        a: 85,
        k: "member",
        o: { eco: "C59", name: "Two Knights Defense" },
        tc: { label: "Rapid 10+0", timeClass: "rapid" },
        src: "replay",
      },
    );
    assert.equal(row.playedAtLabel, "Nov 11");
    assert.equal(gameRowOf(archiveRow(1, { endedAt: new Date("2025-03-02T10:00:00Z") }), NOW).playedAtLabel, "Mar 2, 2025");
    const bot = gameRowOf(archiveRow(2, { mode: "BOT", opponentUserId: null, opponentName: "", ecoCode: "X99" }), NOW);
    assert.deepEqual({ n: bot.opponent.name, k: bot.opponent.kind, o: bot.opening }, { n: "Engine", k: "bot", o: null });
    const queued = gameRowOf(archiveRow(3, { analysisStatus: "QUEUED", accuracy: null, momentsCount: 0, headline: null }), NOW);
    assert.deepEqual({ s: queued.analysisStatus, a: queued.accuracy, h: queued.headline }, { s: "queued", a: null, h: null });
    const untimed = gameRowOf(archiveRow(4, { timeClass: "UNTIMED", initialTimeSeconds: 0 }), NOW);
    assert.deepEqual(untimed.tc, { label: "Untimed", timeClass: "untimed" });
    assert.equal(JSON.stringify(row).includes("gameId"), false, "only the ref leaves the server");
  });
});

describe("statements", () => {
  it("page: no keyset and no filter conditions unless asked; ordered on the index columns; limit + 1", () => {
    const plain = archivePageSql(5n, {}, null, 30);
    const text = textOf(plain);
    assert.equal(text.includes(`(gp."endedAt", gp."gameId") <`), false);
    assert.equal(text.includes("ILIKE"), false);
    assert.match(text, /WHERE gp\."userId" = \? AND gp\.result = ANY\('\{WIN,LOSS,DRAW\}'::"PlayerResult"\[\]\)/);
    assert.match(text, /ORDER BY gp\."endedAt" DESC, gp\."gameId" DESC LIMIT \?$/);
    assert.equal(plain.values.at(-1), 31);
    const full = archivePageSql(5n, { result: ["loss"], tc: ["blitz"], moments: true, q: "tal" }, { endedAt: "2026-11-10T08:30:00.123Z", gameId: "9" }, 30);
    const fullText = textOf(full);
    for (const part of [
      `AND (gp."endedAt", gp."gameId") < (?::timestamptz AT TIME ZONE 'UTC', ?::bigint)`,
      `gp.result = ANY(?::"PlayerResult"[])`,
      `gp."timeClass" = ANY(?::"TimeClass"[])`,
      `gp."momentsCount" > 0`,
      `gp."opponentName" ILIKE ?`,
    ]) {
      assert.ok(fullText.includes(part), part);
    }
    assert.ok(full.values.some((v) => Array.isArray(v) && v[0] === "LOSS"));
    assert.ok(full.values.some((v) => Array.isArray(v) && v[0] === "BLITZ"));
    assert.ok(full.values.includes("%tal%"));
  });

  it("counts: the filter as a FILTER clause over every finished game", () => {
    assert.match(textOf(archiveCountsSql(5n, {})), /SELECT \(count\(\*\)\)::int AS "filteredTotal", count\(\*\)::int AS "all"/);
    assert.match(textOf(archiveCountsSql(5n, { moments: true })), /count\(\*\) FILTER \(WHERE gp\."momentsCount" > 0\)/);
  });
});
