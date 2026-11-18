/**
 * P6 INTEGRATE-2 regression (WP5 open issue §5.2): the worker's `weaknessVersion` bump creates a bare training_profiles
 * row (no puzzle-rating seed, `ratingSeeded` false) when a member's first READY profile comes before any training
 * write. P5's readers took that row as seeded, so the member's puzzle rating froze at the column default 1500 instead of
 * P5's seed. Now an unseeded row with no rated puzzle reads as "no row" (the seed in memory), and the first write — R1's
 * lazy insert, W1, W8 or TR-12's scope upsert — applies the seed over it, keeping the worker's columns.
 * Real Postgres (TEST_DATABASE_URL, local only): the worker's own statement writes the bare row.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { seedPuzzleRating } from "@repo/chess-training/rating";
import { bumpVersionStatement } from "../../../analysis-worker/src/weakness/write";
import { insertProfileSql, readProfile, unseededRow } from "@/lib/train/profile.server";
import { trainDeps } from "@/lib/train/db.server";
import { readWeakness } from "@/lib/train/weakness.server";
import { requestRecompute } from "@/lib/train/weakness-write.server";
import { weaknessWorld, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const ONBOARDING = { ratingBand: "R1600_2000", initialRating: null } as const;
const SEED = seedPuzzleRating({ blitz: null, rapid: null, initialRating: null, ratingBand: "R1600_2000" });

describe("P6 · the worker's bare profile row gets P5's seed (Postgres)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  async function bareRow(m: Member) {
    const s = bumpVersionStatement(String(m.id));
    await w.db.$queryRawUnsafe(s.text, ...s.values);
  }
  const row = async (m: Member) =>
    (
      await w.db.$queryRaw<{ r: number; seeded: boolean; n: number; v: number; months: number }[]>(Prisma.sql`
        SELECT "puzzleRating" AS r, "ratingSeeded" AS seeded, "puzzleAttempts" AS n, "weaknessVersion" AS v, "weaknessMonths" AS months
          FROM training_profiles WHERE "userId" = ${m.id}`)
    )[0]!;
  const viewer = (m: Member) => ({ id: m.id, onboarding: ONBOARDING }) as unknown as Parameters<typeof readProfile>[1];

  it("the seed differs from the column default (the test would prove nothing otherwise)", () => {
    assert.notEqual(Math.round(SEED.r), 1500);
  });

  it("a bare row reads as unseeded; R1's lazy insert applies the seed over it and keeps weaknessVersion", async () => {
    const m = await w.member("seed-r1");
    await bareRow(m);
    const before = await row(m);
    assert.deepEqual({ seeded: before.seeded, r: before.r, v: before.v }, { seeded: false, r: 1500, v: 1 });
    assert.equal(unseededRow({ ratingSeeded: before.seeded, puzzleAttempts: before.n }), true);
    const p = await readProfile(w.db as never, viewer(m));
    assert.equal(p.exists, false);
    assert.equal(Math.round(p.puzzleRating), Math.round(SEED.r));
    await w.db.$executeRaw(insertProfileSql(m.id, p));
    const after = await row(m);
    assert.equal(after.seeded, true);
    assert.equal(Math.round(after.r), Math.round(SEED.r));
    assert.equal(after.v, 1, "the worker's version is kept");
    const again = await readProfile(w.db as never, viewer(m));
    assert.equal(again.exists, true);
    // A seeded row is never re-seeded (a concurrent first write keeps its row).
    await w.db.$executeRaw(insertProfileSql(m.id, { ...again, puzzleRating: 999 }));
    assert.equal(Math.round((await row(m)).r), Math.round(SEED.r));
  });

  it("regression: weakness-rating-unseeded (P6 WP8) — TR-5's rating over a bare row is P5's seed, as TR-7 draws puzzles", async () => {
    // Found by the WP8 drill spec on the weak-member persona: the drill config read "matched Lichess puzzles near 1500"
    // (the bare row's column default) until any P5 read seeded the row, while the session's puzzles came near the seed.
    const m = await w.member("seed-tr5");
    await bareRow(m);
    const v = w.viewerOf(m, { onboarding: ONBOARDING } as never);
    const read = await readWeakness(v, WORLD_NOW, trainDeps());
    assert.equal(read.payload.rating, Math.round(SEED.r));
    assert.equal((await row(m)).seeded, false, "a read never writes the seed");
  });

  it("TR-12's scope upsert over a bare row stores the scope and the seed", async () => {
    const m = await w.member("seed-tr12");
    await bareRow(m);
    await requestRecompute(viewer(m) as never, { months: 3 } as never, WORLD_NOW, trainDeps());
    const after = await row(m);
    assert.equal(after.months, 3);
    assert.equal(after.seeded, true);
    assert.equal(Math.round(after.r), Math.round(SEED.r));
    assert.equal(after.v, 1);
  });
});
