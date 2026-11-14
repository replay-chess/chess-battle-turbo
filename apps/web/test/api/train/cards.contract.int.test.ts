/**
 * W5 skip, W6 remove, A6 (P3's moment toggle, live with `train`), the review bank fields on A1 / A2, W7 reports and W8
 * prefs on a real Postgres (phase-05 plan §12.2 "W5/W6/A6/W7/W8", "Review bank fields").
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { MomentBankResponse, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { ReportResult } from "@repo/contracts/http/reports";
import { BankPage, SessionPayload, SkipResult, TrainPrefs } from "@repo/contracts/http/train";
import { count, trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
const FLAG_ENV = ["NEXT_PUBLIC_APP_ENV", "ALLOW_TEST_HOOKS", "FLAGS_OVERRIDE"] as const;

describe("P5 W5/W6/A6/review bank fields/W7/W8 (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  const saved: Record<string, string | undefined> = {};
  before(() => w.setup());
  after(() => w.teardown());
  beforeEach(() => {
    for (const k of FLAG_ENV) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of FLAG_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  /** The `train` flag through FLAGS_OVERRIDE (honoured only with test hooks on, as in e2e). */
  const train = (on: boolean) => {
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.ALLOW_TEST_HOOKS = "1";
    process.env.FLAGS_OVERRIDE = `train:${on ? "on" : "off"}`;
  };

  async function cardRow(m: Member, key: string) {
    return (await w.db.$queryRaw<{ due: Date; suspendedUntil: Date | null }[]>(Prisma.sql`
      SELECT due, "suspendedUntil" FROM training_cards WHERE "userId" = ${m.id} AND "itemKey" = ${key}`))[0];
  }

  /** A key-moment ply of the member's GAME with its card (and the mistake and theme behind it). */
  async function momentWithCard(m: Member, gameRef: string) {
    const rows = await w.db.$queryRaw<{ ply: number; itemKey: string; mistakeId: bigint; theme: string; gameId: bigint }[]>(Prisma.sql`
      SELECT mo.ply, c."itemKey", m.id AS "mistakeId", c.theme, g.id AS "gameId"
        FROM games g JOIN mistake_occurrences mo ON mo."gameId" = g.id JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = ${m.id}
        JOIN training_cards c ON c."mistakeId" = m.id
       WHERE g."referenceId" = ${gameRef} ORDER BY mo.ply LIMIT 1`);
    assert.ok(rows[0], "the persona has a moment with a card");
    return rows[0]!;
  }

  const bankCount = async (m: Member, theme: string) =>
    Number((await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT "bankCount" AS n FROM theme_mastery WHERE "userId" = ${m.id} AND theme = ${theme}`))[0]?.n ?? 0);

  it("W5: skip → Tomorrow, out of today's due counts, the session item marked skipped; another member's card → 404", async () => {
    const m = await w.member("skip");
    await w.persona(m, "bank-member");
    const s = ok(SessionPayload).parse(await (await w.call("sessions", "POST", "/api/train/sessions", m, { body: { kind: "bank", source: "hub" }, headers: { "Idempotency-Key": w.uuid() } })).json()).data;
    const key = s.items[0]!.cardRef!;
    const r = await w.call("skip", "POST", `/api/train/cards/${key}/skip`, m, { params: { ref: key }, body: { sessionRef: s.ref } });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    const out = ok(SkipResult).parse(await r.json()).data;
    assert.equal(out.label, "Tomorrow");
    assert.equal(out.suspendedUntil, "2026-11-13T08:00:00.000Z");
    assert.equal((await cardRow(m, key))!.suspendedUntil!.toISOString(), out.suspendedUntil);
    const bank = ok(BankPage).parse(await (await w.call("bank", "GET", "/api/train/bank", m)).json()).data;
    assert.equal(bank.counts.due, 3);
    const row = bank.rows.find((x) => x.cardRef === key)!;
    assert.equal(row.skippedToday, true);
    assert.equal(row.isDue, false);
    const again = ok(SessionPayload).parse(await (await w.call("session", "GET", `/api/train/sessions/${s.ref}`, m, { params: { ref: s.ref } })).json()).data;
    assert.equal(again.resumeIndex, 1, "the skipped item is passed");
    const other = await w.member("skipother");
    await w.persona(other, "bank-empty");
    assert.equal((await w.call("skip", "POST", `/api/train/cards/${key}/skip`, other, { params: { ref: key }, body: { sessionRef: null } })).res.status, 404);
  });

  it("W6: remove hides the mistake, deletes the card, bankCount − 1, bumps the review; again → 204; a foreign ref → 404", async () => {
    const m = await w.member("remove");
    const rep = await w.persona(m, "bank-member");
    const mom = await momentWithCard(m, rep.gameRefs.GAME!);
    const reviewUpdated = async () =>
      (await w.db.$queryRaw<{ u: Date }[]>(Prisma.sql`SELECT pr."updatedAt" AS u FROM player_reviews pr
        WHERE pr."gameId" = ${mom.gameId} AND pr.color = (SELECT color FROM mistakes WHERE id = ${mom.mistakeId})`))[0]!.u;
    const reviewBefore = await reviewUpdated();
    const countBefore = await bankCount(m, mom.theme);
    const r = await w.call("card", "DELETE", `/api/train/cards/${mom.itemKey}`, m, { params: { ref: mom.itemKey }, now: new Date(WORLD_NOW.getTime() + MIN) });
    assert.equal(r.res.status, 204, await r.res.clone().text());
    assert.equal(await cardRow(m, mom.itemKey), undefined);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE id = ${mom.mistakeId} AND "hiddenAt" IS NOT NULL`), 1);
    assert.equal(await bankCount(m, mom.theme), countBefore - 1);
    const reviewAfter = await reviewUpdated();
    assert.ok(reviewAfter.getTime() > reviewBefore.getTime(), "the A1 ETag source moved");
    assert.equal((await w.call("card", "DELETE", `/api/train/cards/${mom.itemKey}`, m, { params: { ref: mom.itemKey } })).res.status, 204);
    const other = await w.member("removeother");
    await w.persona(other, "bank-empty");
    assert.equal((await w.call("card", "DELETE", `/api/train/cards/${mom.itemKey}`, other, { params: { ref: mom.itemKey } })).res.status, 404);
  });

  it("review bank fields: A1 inBank/card for live cards, A2 bank = {count, plies}; both ETags move with a removal; off → P3's fields", async () => {
    const m = await w.member("reviewbank");
    const rep = await w.persona(m, "bank-member");
    const ref = rep.gameRefs.GAME!;
    train(true);
    const a1 = await w.call("review", "GET", `/api/review/${ref}`, m, { params: { ref } });
    assert.equal(a1.res.status, 200, await a1.res.clone().text());
    const dto = ok(ReviewDTO).parse(await a1.json()).data;
    const cards = await w.db.$queryRaw<{ ply: number; itemKey: string }[]>(Prisma.sql`
      SELECT mo.ply, c."itemKey" FROM games g JOIN mistake_occurrences mo ON mo."gameId" = g.id
        JOIN mistakes mi ON mi.id = mo."mistakeId" AND mi."userId" = ${m.id} AND mi."hiddenAt" IS NULL
        JOIN training_cards c ON c."mistakeId" = mi.id WHERE g."referenceId" = ${ref}`);
    const live = new Map(cards.map((c) => [c.ply, c.itemKey]));
    assert.ok(dto.review && dto.review.moments.length > 0);
    for (const mo of dto.review!.moments) {
      assert.equal(mo.inBank, live.has(mo.ply), `ply ${mo.ply}`);
      assert.equal(mo.card?.ref ?? null, live.get(mo.ply) ?? null);
    }
    const a2 = await w.call("status", "GET", `/api/review/${ref}/status`, m, { params: { ref } });
    const status = ok(ReviewStatusDTO).parse(await a2.json()).data;
    const plies = dto.review!.moments.filter((x) => x.inBank).map((x) => x.ply);
    assert.deepEqual(status.bank, { count: plies.length, plies });
    const etag1 = a1.res.headers.get("etag");
    const etag2 = a2.res.headers.get("etag");

    const first = dto.review!.moments.find((x) => x.inBank)!;
    await w.call("card", "DELETE", `/api/train/cards/${first.card!.ref}`, m, { params: { ref: first.card!.ref }, now: new Date(WORLD_NOW.getTime() + MIN) });
    const b1 = await w.call("review", "GET", `/api/review/${ref}`, m, { params: { ref }, headers: { "if-none-match": etag1! } });
    assert.equal(b1.res.status, 200, "the A1 ETag moved");
    assert.equal(ok(ReviewDTO).parse(await b1.json()).data.review!.moments.find((x) => x.ply === first.ply)!.inBank, false);
    const b2 = await w.call("status", "GET", `/api/review/${ref}/status`, m, { params: { ref }, headers: { "if-none-match": etag2! } });
    assert.equal(b2.res.status, 200, "the A2 ETag moved");
    assert.equal(ok(ReviewStatusDTO).parse(await b2.json()).data.bank!.count, plies.length - 1);

    train(false);
    const off = ok(ReviewStatusDTO).parse(await (await w.call("status", "GET", `/api/review/${ref}/status`, m, { params: { ref } })).json()).data;
    assert.equal(off.bank, null);
    const offDto = ok(ReviewDTO).parse(await (await w.call("review", "GET", `/api/review/${ref}`, m, { params: { ref } })).json()).data;
    assert.ok(offDto.review!.moments.every((x) => x.card === undefined), "no card field with the flag off");
  });

  it("A6 with `train`: off → opt-out + card deleted + hidden + bankCount − 1; on → NEW card at the next release; a non-moment → 404", async () => {
    const m = await w.member("a6");
    const rep = await w.persona(m, "bank-member");
    const ref = rep.gameRefs.GAME!;
    const mom = await momentWithCard(m, ref);
    const before = await bankCount(m, mom.theme);
    train(true);
    const off = await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: false } });
    assert.equal(off.res.status, 200, await off.res.clone().text());
    assert.deepEqual(ok(MomentBankResponse).parse(await off.json()).data, { ply: mom.ply, inBank: false, card: null });
    const optOut = async () =>
      (await w.db.$queryRaw<{ o: number[] }[]>(Prisma.sql`SELECT COALESCE(progress->'bankOptOut', '[]'::jsonb) AS o FROM player_reviews WHERE "gameId" = ${mom.gameId} AND color = (SELECT color FROM mistakes WHERE id = ${mom.mistakeId})`))[0]!.o;
    assert.deepEqual(await optOut(), [mom.ply]);
    assert.equal(await cardRow(m, mom.itemKey), undefined);
    assert.equal(await bankCount(m, mom.theme), before - 1);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE id = ${mom.mistakeId} AND "hiddenAt" IS NOT NULL`), 1);

    const on = await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: true } });
    assert.equal(on.res.status, 200, await on.res.clone().text());
    const back = ok(MomentBankResponse).parse(await on.json()).data;
    assert.equal(back.card!.ref, mom.itemKey);
    assert.equal(back.card!.dueAt, "2026-11-13T08:00:00.000Z");
    assert.equal(back.card!.dueLabel, "Tomorrow");
    assert.deepEqual(await optOut(), []);
    assert.equal(await bankCount(m, mom.theme), before);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "itemKey" = ${mom.itemKey} AND "userId" = ${m.id} AND state = 'NEW'`), 1);
    // Set semantics: on again is a no-op that answers the same card.
    const on2 = ok(MomentBankResponse).parse(await (await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: true } })).json()).data;
    assert.equal(on2.card!.ref, mom.itemKey);
    assert.equal(await bankCount(m, mom.theme), before);
    const notMoment = await w.call("moment", "PATCH", `/api/review/${ref}/moments/1`, m, { params: { ref, ply: "1" }, body: { inBank: true } });
    assert.equal(notMoment.res.status, 404);
  });

  it("A6 on a game not extracted yet: the opt-out is recorded, card null", async () => {
    const m = await w.member("a6raw");
    const rep = await w.persona(m, "bank-member");
    const ref = rep.gameRefs.GAME!;
    const mom = await momentWithCard(m, ref);
    // Not extracted: no occurrence rows for this game (as with BANK_EXTRACT_ENABLED=false).
    await w.db.$executeRaw(Prisma.sql`DELETE FROM mistake_occurrences WHERE "gameId" = ${mom.gameId}`);
    train(true);
    const r = await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: false } });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.equal(ok(MomentBankResponse).parse(await r.json()).data.card, null);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM player_reviews WHERE "gameId" = ${mom.gameId} AND progress->'bankOptOut' @> to_jsonb(${mom.ply}::int)`), 1);
  });

  it("A6 with `train` off: an opt-out still deletes the card an extraction made (FIX-2: no card for an opted-out moment once the flag turns on); an opt-in records only the flag", async () => {
    const m = await w.member("a6off");
    const rep = await w.persona(m, "bank-member");
    const ref = rep.gameRefs.GAME!;
    const mom = await momentWithCard(m, ref);
    const before = await bankCount(m, mom.theme);
    train(false);
    const off = await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: false } });
    assert.equal(off.res.status, 200, await off.res.clone().text());
    assert.deepEqual(ok(MomentBankResponse).parse(await off.json()).data, { ply: mom.ply, inBank: false, card: null });
    assert.equal(await cardRow(m, mom.itemKey), undefined, "the card is gone with the flag off");
    assert.equal(await bankCount(m, mom.theme), before - 1);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM player_reviews WHERE "gameId" = ${mom.gameId} AND progress->'bankOptOut' @> to_jsonb(${mom.ply}::int)`), 1);
    // The flag turns on: the review does not show the opted-out moment as Added.
    train(true);
    const dto = ok(ReviewDTO).parse(await (await w.call("review", "GET", `/api/review/${ref}`, m, { params: { ref } })).json()).data;
    assert.equal(dto.review!.moments.find((x) => x.ply === mom.ply)!.inBank, false);
    // An opt-in with the flag off clears the flag only (P3-D19): no card yet.
    train(false);
    const on = await w.call("moment", "PATCH", `/api/review/${ref}/moments/${mom.ply}`, m, { params: { ref, ply: String(mom.ply) }, body: { inBank: true } });
    assert.equal(on.res.status, 200, await on.res.clone().text());
    assert.equal(ok(MomentBankResponse).parse(await on.json()).data.card, null);
    assert.equal(await cardRow(m, mom.itemKey), undefined);
  });

  it("W7 FIX-2: a note with a NUL character is a 400 invalid body, never a 500 (Postgres 22021)", async () => {
    const m = await w.member("reportnul");
    await w.persona(m, "bank-member");
    const [mi] = await w.db.$queryRaw<{ ref: string; fen: string }[]>(Prisma.sql`SELECT "referenceId" AS ref, fen FROM mistakes WHERE "userId" = ${m.id} ORDER BY id LIMIT 1`);
    const bad = await w.call("reports", "POST", "/api/reports", m, {
      body: { targetType: "mistake", targetRef: mi!.ref, reason: "other", note: "bad\u0000note", fen: mi!.fen },
      headers: { "Idempotency-Key": w.uuid() },
    });
    assert.equal(bad.res.status, 400, await bad.res.clone().text());
    assert.equal(bad.recorded.exceptions.length, 0, "no Sentry exception");
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM reports WHERE "targetRef" = ${mi!.ref}`), 0);
  });

  it("W7: 201, the same target within 24 h → 200 duplicate, a foreign mistake → 404, the 21st in 24 h → 429 even after TRUNCATE", async () => {
    const m = await w.member("report");
    await w.persona(m, "bank-member");
    const mistakes = (await w.db.$queryRaw<{ ref: string; fen: string }[]>(Prisma.sql`SELECT "referenceId" AS ref, fen FROM mistakes WHERE "userId" = ${m.id} ORDER BY id LIMIT 22`));
    const send = (i: number, at: Date) =>
      w.call("reports", "POST", "/api/reports", m, {
        body: { targetType: "mistake", targetRef: mistakes[i]!.ref, reason: "wrong_solution", note: "<b>not</b> escaped here", fen: mistakes[i]!.fen },
        headers: { "Idempotency-Key": w.uuid() },
        now: at,
      });
    const first = await send(0, WORLD_NOW);
    assert.equal(first.res.status, 201, await first.res.clone().text());
    const created = ok(ReportResult).parse(await first.json()).data;
    const dup = await send(0, new Date(WORLD_NOW.getTime() + MIN));
    assert.equal(dup.res.status, 200);
    assert.deepEqual(ok(ReportResult).parse(await dup.json()).data, { ref: created.ref, duplicate: true });
    // Regression (INTEGRATE-2): the runner names a mistake by its card key (`m_…`; TrainItem carries no mistake ref).
    // The key resolves to the same mistake: a duplicate of the ref-form report, stored under the mistake's ref.
    const [card] = await w.db.$queryRaw<{ key: string }[]>(Prisma.sql`
      SELECT c."itemKey" AS key FROM training_cards c JOIN mistakes mm ON mm.id = c."mistakeId" WHERE mm."referenceId" = ${mistakes[0]!.ref}`);
    assert.ok(card, "the first mistake has a card");
    const byKey = await w.call("reports", "POST", "/api/reports", m, {
      body: { targetType: "mistake", targetRef: card.key, reason: "wrong_solution", fen: mistakes[0]!.fen },
      headers: { "Idempotency-Key": w.uuid() },
      now: new Date(WORLD_NOW.getTime() + 2 * MIN),
    });
    assert.equal(byKey.res.status, 200, await byKey.res.clone().text());
    assert.deepEqual(ok(ReportResult).parse(await byKey.json()).data, { ref: created.ref, duplicate: true });
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM reports WHERE "targetRef" = ${mistakes[0]!.ref}`), 1);
    for (let i = 1; i < 20; i++) assert.equal((await send(i, new Date(WORLD_NOW.getTime() + i * MIN))).res.status, 201, `report ${i + 1}`);
    await w.db.$executeRaw(Prisma.sql`TRUNCATE rate_limit_buckets`);
    const over = await send(20, new Date(WORLD_NOW.getTime() + 30 * MIN));
    assert.equal(over.res.status, 429);
    assert.equal((ErrorEnvelope.parse(await over.json()).error.details as { reason?: string }).reason, "report_limit");
    assert.ok(Number(over.res.headers.get("retry-after")) > 0);
    const other = await w.member("reportother");
    await w.persona(other, "bank-empty");
    const foreign = await w.call("reports", "POST", "/api/reports", other, {
      body: { targetType: "mistake", targetRef: mistakes[0]!.ref, reason: "other", fen: mistakes[0]!.fen },
      headers: { "Idempotency-Key": w.uuid() },
    });
    assert.equal(foreign.res.status, 404);
    const foreignKey = await w.call("reports", "POST", "/api/reports", other, {
      body: { targetType: "mistake", targetRef: card.key, reason: "other", fen: mistakes[0]!.fen },
      headers: { "Idempotency-Key": w.uuid() },
    });
    assert.equal(foreignKey.res.status, 404, "another member's card key");
    const puzzle = await w.call("reports", "POST", "/api/reports", other, {
      body: { targetType: "puzzle", targetRef: "abcde", reason: "better_move", fen: mistakes[0]!.fen },
      headers: { "Idempotency-Key": w.uuid() },
    });
    assert.equal(puzzle.res.status, 404, "a puzzle the viewer never saw");
  });

  it("W8: each field validated; newPerDay above the cap → 400 new_per_day_above_cap; an unknown zone → 400; the zone is saved", async () => {
    const m = await w.member("prefs");
    await w.persona(m, "home-new");
    const patch = (body: unknown) => w.call("prefs", "PATCH", "/api/train/prefs", m, { body });
    const r = await patch({ timeZone: "Asia/Kolkata", releaseHour: 9 });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.deepEqual(ok(TrainPrefs).parse(await r.json()).data, {
      timeZone: "Asia/Kolkata",
      dayStartHour: 4,
      releaseHour: 9,
      bankDailyCap: 10,
      newPerDay: 5,
      autoGrade: false,
    });
    assert.equal((await w.db.$queryRaw<{ tz: string }[]>(Prisma.sql`SELECT "timeZone" AS tz FROM users WHERE id = ${m.id}`))[0]!.tz, "Asia/Kolkata");
    const above = await patch({ newPerDay: 12 });
    assert.equal(above.res.status, 400);
    assert.equal((ErrorEnvelope.parse(await above.json()).error.details as { reason?: string }).reason, "new_per_day_above_cap");
    assert.equal((await patch({ bankDailyCap: 20, newPerDay: 12 })).res.status, 200);
    assert.equal((await patch({ timeZone: "Mars/Olympus_Mons" })).res.status, 400);
    assert.equal((await patch({ dayStartHour: 9 })).res.status, 400);
    assert.equal((await patch({})).res.status, 400);
  });
});
