// The P6 persona writers are exact (phase-06 plan §6.8; testing X4: "each reset run twice gives the same result").
// A persona is leased twice in a row on the same pool user and everything the pipelines wrote is compared: the games
// (refs, grading), the bank (positions and themes), the cards, the snapshot (status, counts, rows, the metrics
// document without its timestamps) and the queued work. `weak-insufficient` keeps its graded games on the second lease
// (the bank is extracted again by the worker); `weak-computing` grades its games again each time. No shared letter is
// touched (the persona tool refuses A–R). @p6
import type { PrismaClient } from "@repo/db";
import { expect, test } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });

/** Everything a lease leaves for `email`, with times and serial ids taken out. */
async function stateOf(db: PrismaClient, email: string) {
  const [u] = await db.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE lower(email) = lower(${email})`;
  const id = u!.id;
  const games = await db.$queryRaw<{ ref: string; status: string; tc: string; accuracy: number | null }[]>`
    SELECT g."referenceId" AS ref, g."analysisStatus"::text AS status, gp."timeClass"::text AS tc, gp.accuracy
      FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = ${id} ORDER BY 1`;
  const bank = await db.$queryRaw<{ epd: string; themes: string[] }[]>`
    SELECT "epdHash"::text AS epd, themes FROM mistakes WHERE "userId" = ${id} ORDER BY 1`;
  const cards = await db.$queryRaw<{ key: string }[]>`SELECT "itemKey" AS key FROM training_cards WHERE "userId" = ${id} ORDER BY 1`;
  const snaps = await db.$queryRaw<{ status: string; analysed: number; inScope: number; metrics: Record<string, unknown> }[]>`
    SELECT status::text AS status, "gamesAnalysed" AS analysed, "gamesInScope" AS "inScope", metrics FROM weakness_snapshots
     WHERE "userId" = ${id} ORDER BY "weekStart"`;
  const frozen = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM jobs WHERE "userId" = ${id} AND kind = 'ANALYZE_GAME' AND status = 'QUEUED'`;
  const timeless = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v), (k, x) => (typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x) ? "<time>" : x));
  return {
    games,
    bank: bank.map((b) => ({ epd: b.epd, themes: [...b.themes].sort() })),
    cards: cards.map((c) => c.key),
    snapshots: snaps.map((s) => ({ ...s, metrics: timeless(s.metrics) })),
    frozenJobs: frozen[0]!.n,
  };
}

for (const name of ["weak-insufficient", "weak-computing"] as const) {
  test(`${name}: two leases in a row leave the same rows`, async ({ page, weak, reviewDb }) => {
    test.setTimeout(900_000);
    const first = await weak(name);
    const a = await stateOf(reviewDb, first.email);
    expect(a.games.length).toBeGreaterThan(0);
    expect(a.bank.length, "the worker extracted a bank").toBeGreaterThan(0);
    expect(a.snapshots.length, "the worker wrote the snapshot").toBeGreaterThan(0);
    const second = await weak(name);
    expect(second.email).toBe(first.email);
    const b = await stateOf(reviewDb, second.email);
    expect(b).toEqual(a);
    await expect(page).toHaveURL(/./);
  });
}
