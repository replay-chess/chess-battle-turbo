/**
 * R2 `GET /api/train/bank` on a real Postgres (phase-05 plan §12.2 "R2 bank"): a bank of ≤ 300 cards answers
 * `complete: true` with every row; a larger one pages by 50 with a stable keyset cursor while cards are graded in
 * between (no row skipped or repeated); the GROUPING SETS facets equal the in-memory facets; a request with a cursor
 * returns `BankNextPage` only and runs one statement (api-perf AP-38); `state` empty / caughtup / default; `gamePly`
 * is the mistake's `lastPly`; no `solution` / `bestSan` / `bestUci` key anywhere in the JSON; a cursor minted for other
 * filters is 400 `cursor_filter_mismatch`.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { BankNextPage, BankPage, BankPageMeta, type BankRow } from "@repo/contracts/http/train";
import { facetsOfRows } from "@/lib/train/bank.server";
import { routeStatements } from "../../helpers/query-counter";
import { trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const HIDDEN_KEYS = /"(solution|bestSan|bestUci)"/;

/** Clones one of the member's mistakes into `n` more bank positions (distinct positions, keys and dues). */
async function grow(w: ReturnType<typeof trainWorld>, m: Member, n: number) {
  await w.db.$executeRaw(Prisma.sql`
    WITH src AS (SELECT * FROM mistakes WHERE "userId" = ${m.id} ORDER BY id LIMIT 1),
    ins AS (
      INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, "setupUci", solution, accept, "playedUci", "refuteUci", judgement,
                            source, "isPuzzle", themes, "primaryTheme", phase, "winBefore", "winAfterPlayed", "cpBest", "mateBest", "moveNumber",
                            occurrences, "lastGameId", "lastPly", "lastPlayedAt", "lastOpponentName", "updatedAt")
      SELECT 'cg' || lpad(src."userId"::text, 8, '0') || lpad(i::text, 12, '0'), src."userId", 9000000000 + i, src.color, src.fen, src."setupUci", src.solution, src.accept,
             src."playedUci", src."refuteUci", src.judgement, CASE WHEN i % 3 = 0 THEN 'MISSED_PUNISH' ELSE 'OWN_ERROR' END::"MistakeSource",
             src."isPuzzle", src.themes, CASE WHEN i % 2 = 0 THEN 'fork' ELSE 'pin' END, src.phase, src."winBefore", src."winAfterPlayed",
             src."cpBest", src."mateBest", src."moveNumber", 1, src."lastGameId", src."lastPly", src."lastPlayedAt", src."lastOpponentName", now()
        FROM src, generate_series(1, ${n}::int) i
      RETURNING id, "epdHash", "primaryTheme", phase)
    INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "updatedAt")
    SELECT ${m.id}, 'BANK', 'MISTAKE', 'm_g' || (ins."epdHash" - 9000000000)::text, ins.id, ins."primaryTheme", ins.phase,
           (${WORLD_NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC') + ((ins."epdHash" - 9000000000) * interval '37 minutes'), 'REVIEW', now()
      FROM ins`);
}

describe("P5 R2 bank (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  it("≤ 300 cards: complete with every row, facets from the rows, the design's states and labels, no hidden keys", async () => {
    const m = await w.member("bank");
    await w.persona(m, "bank-member");
    const r = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all" } });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.equal(r.res.headers.get("cache-control"), "private, no-store");
    const text = await r.res.clone().text();
    assert.equal(HIDDEN_KEYS.test(text), false, "no solution or best move in the bank list");
    const env = ok(BankPage).extend({ meta: BankPageMeta }).parse(JSON.parse(text));
    const page = env.data;
    assert.deepEqual(env.meta, { nextCursor: null, complete: true });
    assert.equal(page.state, "default");
    assert.equal(page.rows.length, 41);
    assert.equal(page.counts.all, 41);
    assert.equal(page.counts.due, 4);
    // The member's own daily cap travels with the counts, so the bank copy follows a changed bankDailyCap (INTEGRATE-2).
    const [prof] = await w.db.$queryRaw<{ cap: number }[]>(Prisma.sql`SELECT "bankDailyCap" AS cap FROM training_profiles WHERE "userId" = ${m.id}`);
    assert.equal(page.counts.cap, prof!.cap);
    assert.equal(page.rows.filter((x) => x.isDue).length, 4);
    assert.deepEqual(page.facets, facetsOfRows(page.rows));
    assert.ok(page.upcoming.length > 0 && page.upcoming.length <= 4);
    assert.equal(page.lesson, null);
    // gamePly = the mistake's lastPly.
    const rows = await w.db.$queryRaw<{ itemKey: string; lastPly: number | null }[]>(Prisma.sql`
      SELECT c."itemKey", m."lastPly" FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" WHERE c."userId" = ${m.id}`);
    const plies = new Map(rows.map((x) => [x.itemKey, x.lastPly]));
    for (const row of page.rows) assert.equal(row.gamePly, plies.get(row.cardRef));
  });

  it("empty and caught-up banks", async () => {
    const e = await w.member("bankempty");
    await w.persona(e, "bank-empty");
    const empty = ok(BankPage).parse(await (await w.call("bank", "GET", "/api/train/bank", e)).json()).data;
    assert.equal(empty.state, "empty");
    assert.ok(empty.emptyCtas);
    assert.equal(empty.emptyCtas!.hasLinkedAccount, false);
    const c = await w.member("bankcaught");
    await w.persona(c, "bank-caughtup");
    const caught = ok(BankPage).parse(await (await w.call("bank", "GET", "/api/train/bank", c)).json()).data;
    assert.equal(caught.state, "caughtup");
    assert.equal(caught.counts.due, 0);
    assert.ok(caught.nextBatch);
    assert.deepEqual(caught.upcoming.map((u) => u.n), [6, 3, 5, 9]);
  });

  it("> 300 cards: pages of 50 with a stable cursor; a cursor request is BankNextPage in one statement; SQL facets", async () => {
    const m = await w.member("big");
    await w.persona(m, "bank-member");
    await grow(w, m, 300);
    const first = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all" } });
    assert.equal(first.res.status, 200, await first.res.clone().text());
    const env = ok(BankPage).extend({ meta: BankPageMeta }).parse(await first.json());
    assert.equal(env.meta.complete, false);
    assert.equal(env.data.rows.length, 50);
    assert.equal(env.data.counts.all, 341);
    const facetN = (k: string) => env.data.facets.theme.find((f) => f.key === k)?.n ?? 0;
    const dbN = async (theme: string) =>
      Number((await w.db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${m.id} AND theme = ${theme}`))[0]!.n);
    assert.equal(facetN("fork"), await dbN("fork"));
    assert.equal(facetN("pin"), await dbN("pin"));

    const seen: BankRow[] = [...env.data.rows];
    let cursor = env.meta.nextCursor;
    let pages = 1;
    while (cursor) {
      // Grade (move) a card already seen between pages: the keyset never skips or repeats an unseen row.
      if (pages === 2) {
        await w.db.$executeRaw(Prisma.sql`UPDATE training_cards SET due = due + interval '400 days'
          WHERE "userId" = ${m.id} AND "itemKey" = ${seen[0]!.cardRef}`);
      }
      const next = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all", cursor } });
      assert.equal(next.res.status, 200, await next.res.clone().text());
      assert.equal(routeStatements(next.recorded), 1, "a cursor page is one statement");
      const body = (await next.json()) as { data: unknown; meta: { nextCursor: string | null; complete?: boolean } };
      const page = BankNextPage.strict().parse(body.data);
      assert.equal("complete" in body.meta, false);
      seen.push(...page.rows);
      cursor = body.meta.nextCursor;
      pages += 1;
    }
    const keys = seen.map((r) => r.cardRef);
    const unique = new Set(keys);
    // The moved card shows up once more at the end (its due is now last): every other card exactly once.
    assert.equal(unique.size, 341);
    assert.equal(keys.length, 342);
  });

  it("a cursor minted for other filters → 400 cursor_filter_mismatch; a malformed one → 400", async () => {
    const m = await w.member("cursor");
    await w.persona(m, "bank-member");
    await grow(w, m, 300);
    const first = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all" } });
    const meta = BankPageMeta.parse(((await first.json()) as { meta: unknown }).meta);
    const wrong = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all", theme: "fork", cursor: meta.nextCursor! } });
    assert.equal(wrong.res.status, 400);
    const err = ErrorEnvelope.parse(await wrong.json()).error;
    assert.equal(err.code, "validation_failed");
    assert.equal((err.details as { reason?: string }).reason, "cursor_filter_mismatch");
    const bad = await w.call("bank", "GET", "/api/train/bank", m, { query: { cursor: "nope" } });
    assert.equal(bad.res.status, 400);
  });

  it("filters on a large bank run in SQL (theme, view=due)", async () => {
    const m = await w.member("filters");
    await w.persona(m, "bank-member");
    await grow(w, m, 300);
    const r = await w.call("bank", "GET", "/api/train/bank", m, { query: { theme: "pin" } });
    const page = ok(BankPage).parse(await r.json()).data;
    assert.ok(page.rows.length > 0);
    assert.ok(page.rows.every((x) => x.theme.key === "pin"));
    const due = ok(BankPage).parse(await (await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "due" } })).json()).data;
    assert.ok(due.rows.every((x) => x.isDue));
  });
});
