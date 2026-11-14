// W5 skip and W6 remove (phase-05 plan §7.3 W5, W6; §8.4). Both are keyed by the card's API ref (`itemKey`, unique
// per member: training_cards_userId_itemKey_key) and scoped by the viewer, so another member's ref is a 404.
//
// W5: `suspendedUntil` = the next release ("Tomorrow"): the card leaves today's due counts; with `sessionRef` the
// session's item is marked skipped (the summary lists it). Natural idempotency (the same instant again).
// W6: deletes the BANK card (its FSRS history stays in training_attempts), hides the mistake so no later game creates
// a card for this position, decrements the theme's `bankCount`, and bumps the reviews that show the position (their
// A1 ETag moves, so "Added" turns into "Not added"). Already removed → 204.
import { Prisma } from "@repo/db";
import type { SkipResult } from "@repo/contracts/http/train";
import { dayLabel } from "@repo/chess-training/labels";
import { decodeMistakeItemKey } from "@repo/chess-training/items";
import { skipUntil } from "@repo/chess-training/release";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { timeZoneOf } from "./day.server";
import { at, NOW_UTC, trainDeps, type TrainDb, type TrainDeps } from "./db.server";
import { readProfile } from "./profile.server";
import { storedItemsOf, type SessionRow } from "./sessions.server";

/** W5. 404 for a card (or a session) that is not the viewer's. */
export async function skipCard(viewer: Viewer, ref: string, sessionRef: string | null, now: Date, deps: TrainDeps = trainDeps()): Promise<SkipResult> {
  const tz = timeZoneOf(viewer);
  const profile = await readProfile(deps.db, viewer);
  const until = skipUntil(now, tz, profile.releaseHour);
  await deps.tx(async (db) => {
    const updated = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`UPDATE training_cards SET "suspendedUntil" = ${at(until)}, "updatedAt" = ${NOW_UTC}
      WHERE "userId" = ${viewer.id} AND "itemKey" = ${ref} RETURNING id`);
    if (updated.length === 0) throw new DataError("not_found");
    if (sessionRef) {
      const rows = await db.$queryRaw<SessionRow[]>(Prisma.sql`SELECT id, "referenceId", kind::text AS kind, status::text AS status, items, "startedAt"
        FROM training_sessions WHERE "referenceId" = ${sessionRef} AND "userId" = ${viewer.id} FOR UPDATE`);
      const row = rows[0];
      if (!row) throw new DataError("not_found");
      const items = storedItemsOf(row);
      let changed = false;
      const next = items.map((it) => {
        if (it.key !== ref || it.skipped) return it;
        changed = true;
        return { ...it, skipped: true };
      });
      if (changed) {
        await db.$executeRaw(Prisma.sql`UPDATE training_sessions SET items = ${JSON.stringify({ v: 1, items: next })}::jsonb
          WHERE id = ${row.id} AND "userId" = ${viewer.id}`);
      }
    }
  });
  return { suspendedUntil: until.toISOString(), label: dayLabel(until, now, tz) };
}

/**
 * W6's statements for one BANK card (by ref, or by the mistake behind a moment: A6 off). Returns the hidden mistake.
 *
 * Lock order (FIX-2): the review rows of every game that holds the mistake, then the mistake, then the card and its
 * theme row: the order an extraction batch takes them (bankStatements.ts: L the game's review rows, 1 the mistake,
 * 4 the card and `theme_mastery`), so W6 / A6 off and a J1 of another game holding the same mistake never deadlock.
 */
export async function removeBankCard(db: TrainDb, userId: bigint, where: { ref: string } | { mistakeId: bigint }, now: Date): Promise<bigint | null> {
  const target =
    "ref" in where
      ? Prisma.sql`(SELECT "mistakeId" FROM training_cards WHERE "userId" = ${userId} AND "itemKey" = ${where.ref} AND deck = 'BANK')`
      : Prisma.sql`${where.mistakeId}::bigint`;
  const locked = await db.$queryRaw<{ mistakeId: bigint | null; reviews: number }[]>(Prisma.sql`WITH k AS (SELECT ${target} AS id),
      l AS (SELECT 1 FROM player_reviews pr JOIN mistake_occurrences mo ON mo."gameId" = pr."gameId"
             JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = ${userId} AND m.color = pr.color
            WHERE mo."mistakeId" = (SELECT id FROM k) ORDER BY pr."gameId", pr.color FOR UPDATE OF pr)
    SELECT (SELECT id FROM k) AS "mistakeId", (SELECT count(*) FROM l)::int AS reviews`);
  const lockedMistake = locked[0]?.mistakeId ?? null;
  if (lockedMistake !== null) {
    await db.$queryRaw(Prisma.sql`SELECT id FROM mistakes WHERE id = ${lockedMistake} AND "userId" = ${userId} FOR UPDATE`);
  }
  const match = "ref" in where ? Prisma.sql`"itemKey" = ${where.ref}` : Prisma.sql`"mistakeId" = ${where.mistakeId}`;
  const deleted = await db.$queryRaw<{ mistakeId: bigint | null }[]>(Prisma.sql`WITH c AS (
      DELETE FROM training_cards WHERE "userId" = ${userId} AND ${match} AND deck = 'BANK' RETURNING "mistakeId", theme),
    t AS (UPDATE theme_mastery tm SET "bankCount" = GREATEST(0, tm."bankCount" - 1) FROM c
           WHERE tm."userId" = ${userId} AND tm.theme = c.theme RETURNING 1)
    SELECT "mistakeId" FROM c`);
  const mistakeId = deleted[0]?.mistakeId ?? ("mistakeId" in where ? where.mistakeId : null);
  if (mistakeId === null) return null;
  const hidden = await db.$queryRaw<{ color: string }[]>(Prisma.sql`UPDATE mistakes SET "hiddenAt" = COALESCE("hiddenAt", ${at(now)}), "updatedAt" = ${NOW_UTC}
    WHERE id = ${mistakeId} AND "userId" = ${userId} RETURNING color`);
  if (hidden[0]) {
    await db.$executeRaw(Prisma.sql`UPDATE player_reviews pr SET "updatedAt" = ${NOW_UTC}
      FROM mistake_occurrences mo
      WHERE mo."mistakeId" = ${mistakeId} AND pr."gameId" = mo."gameId" AND pr.color = ${hidden[0].color}`);
  }
  return deleted.length ? mistakeId : null;
}

/** W6. `removed` false = it was removed before (204 all the same). 404 for a ref that was never the viewer's. */
export async function removeCard(viewer: Viewer, ref: string, now: Date, deps: TrainDeps = trainDeps()): Promise<{ removed: boolean }> {
  return deps.tx(async (db) => {
    const mistakeId = await removeBankCard(db, viewer.id, { ref }, now);
    if (mistakeId !== null) return { removed: true };
    const hash = decodeMistakeItemKey(ref);
    if (hash === null) throw new DataError("not_found");
    const known = await db.$queryRaw<unknown[]>(Prisma.sql`SELECT 1 FROM mistakes WHERE "userId" = ${viewer.id} AND "epdHash" = ${hash}`);
    if (known.length === 0) throw new DataError("not_found");
    return { removed: false };
  });
}
