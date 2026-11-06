/**
 * M2a / M2 / M2i landed as written (phase-02 plan 6.1-6.4): the hand-written parts Prisma does not model are present
 * after `prisma migrate deploy`, and every index named in docs/indexes.json exists (the index existence gate,
 * plan 9.2). Skipped unless TEST_DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { parseProtectedIndexes } from "../src/drift";
import { TEST_URL, assertLocalTestUrl } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("M2 schema (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => db.$disconnect());

  async function indexNames(): Promise<Set<string>> {
    const rows = await db.$queryRaw<{ indexname: string }[]>(
      Prisma.sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    return new Set(rows.map((r) => r.indexname));
  }

  it("GameStatus has ABORTED (M2a) and the M2 enums exist", async () => {
    const rows = await db.$queryRaw<{ t: string; v: string }[]>(Prisma.sql`
      SELECT t.typname AS t, e.enumlabel AS v FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname IN ('GameStatus','GameMode','GameSource','TimeClass','GameEndMethod','GameWinner','LivePhase','PlayerResult')`);
    const by = (t: string) => rows.filter((r) => r.t === t).map((r) => r.v);
    assert.ok(by("GameStatus").includes("ABORTED"));
    assert.deepEqual(by("LivePhase"), ["WAITING", "STUDY", "FIRST_MOVE", "PLAYING", "ENDED"]);
    assert.equal(by("GameEndMethod").length, 12);
    assert.ok(by("GameMode").includes("IMPORTED"));
  });

  it("every protected index exists, with its partial predicate", async () => {
    const protectedNames = parseProtectedIndexes(readFileSync(path.join(here, "../prisma/protected-indexes.txt"), "utf8"));
    const names = await indexNames();
    for (const name of protectedNames) assert.ok(names.has(name), name);
    const open = await db.$queryRaw<{ def: string }[]>(
      Prisma.sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'games_open_idx'`,
    );
    assert.match(open[0]!.def, /WHERE \(status = ANY/);
  });

  it("every index listed in docs/indexes.json exists (index existence gate)", async () => {
    const doc = JSON.parse(readFileSync(path.join(here, "../../../docs/indexes.json"), "utf8")) as {
      indexes: { name: string; table: string }[];
    };
    const names = await indexNames();
    const missing = doc.indexes.map((i) => i.name).filter((n) => !names.has(n));
    assert.deepEqual(missing, []);
  });

  it("games has fillfactor 90 and lz4 on moves and pgn; idempotency_keys exists (M2i)", async () => {
    const opts = await db.$queryRaw<{ o: string[] | null }[]>(
      Prisma.sql`SELECT reloptions AS o FROM pg_class WHERE relname = 'games'`,
    );
    assert.ok(opts[0]!.o?.includes("fillfactor=90"));
    const comp = await db.$queryRaw<{ a: string; c: string }[]>(Prisma.sql`
      SELECT attname AS a, attcompression::text AS c FROM pg_attribute
       WHERE attrelid = 'games'::regclass AND attname IN ('moves', 'pgn') ORDER BY attname`);
    assert.deepEqual(
      comp.map((r) => [r.a, r.c]),
      [
        ["moves", "l"],
        ["pgn", "l"],
      ],
    );
    const t = await db.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT to_regclass('public.idempotency_keys') IS NOT NULL AS ok`);
    assert.equal(t[0]!.ok, true);
  });
});
