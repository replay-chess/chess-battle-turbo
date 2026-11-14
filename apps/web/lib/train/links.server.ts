// A6 `PATCH /api/review/[ref]/moments/[ply]` goes live (phase-05 plan §7.3 "A6 moment toggle", §4.8; P3-D19): the
// moment's Mistake Bank switch. P3's opt-out write (`setMomentBankSql`: `progress.bankOptOut`, set semantics, the
// player / moment / analysis checks) runs in the SAME transaction as the card change, so the two never disagree:
//
//   inBank = true    un-hide the mistake and create its NEW card due at the next release (`ON CONFLICT DO NOTHING`;
//                    the theme's `bankCount` + 1 only when a card was created). No occurrence row yet (the game is not
//                    extracted, e.g. BANK_EXTRACT_ENABLED=false) → only the opt-out is recorded; `card: null`, and
//                    the worker honours the opt-out later.
//   inBank = false   W6's statements found by (gameId, ply): the card is deleted (the due counts read training_cards
//                    without joining mistakes), the mistake hidden, `bankCount` − 1, the reviews bumped.
//
// The moment must be an error (judgement INACCURACY … BLUNDER), else 404. With the `train` flag off the route keeps
// P3's behaviour (the opt-out only, `card: null`).
import { Prisma } from "@repo/db";
import type { MomentBankResponse } from "@repo/contracts/http/review";
import { mistakeItemKey } from "@repo/chess-training/items";
import { dayLabel } from "@repo/chess-training/labels";
import { nextRelease } from "@repo/chess-training/release";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { isAdmin } from "@/lib/services/analysis/reader";
import { setMomentBank, setMomentBankSql } from "@/lib/services/analysis/walkthrough";
import { removeBankCard } from "./cards.server";
import { timeZoneOf } from "./day.server";
import { asDate, at, NOW_UTC, trainDeps, type TrainDeps } from "./db.server";
import { readProfile } from "./profile.server";

/** Judgement codes of an error (P3 codec: INACCURACY 9, MISTAKE 10, MISS 11, BLUNDER 12). */
export const ERROR_JUDGEMENTS = [9, 10, 11, 12] as const;

/** The game side, the moment's error check and its bank rows (one statement; PK / unique lookups only). */
export function momentLinkSql(userId: bigint, ref: string, ply: number): Prisma.Sql {
  return Prisma.sql`SELECT g.id AS "gameId", gp.color, (pr.content IS NOT NULL) AS "hasReview",
      EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(pr.content->'moments', '[]'::jsonb)) x
               WHERE (x->>'ply')::int = ${ply}::int AND (x->>'judgement')::int BETWEEN 9 AND 12) AS "isError",
      m.id AS "mistakeId", m."epdHash"::text AS "epdHash", m."primaryTheme", m.phase::text AS phase, m."isPuzzle",
      c."itemKey", c.due
    FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${userId}
    LEFT JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
    LEFT JOIN mistake_occurrences mo ON mo."gameId" = g.id AND mo.ply = ${ply}::smallint
    LEFT JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = ${userId}
    LEFT JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
    WHERE g."referenceId" = ${ref}`;
}

type LinkRow = {
  gameId: bigint;
  color: string;
  hasReview: boolean;
  isError: boolean;
  mistakeId: bigint | null;
  epdHash: string | null;
  primaryTheme: string | null;
  phase: string | null;
  isPuzzle: boolean | null;
  itemKey: string | null;
  due: unknown;
};

export type MomentBankOutcome = MomentBankResponse | "admin_noop";

/** A6 with the `train` flag on (the card follows the switch). */
export async function setMomentInBank(
  viewer: Viewer,
  ref: string,
  ply: number,
  inBank: boolean,
  now: Date,
  deps: TrainDeps = trainDeps(),
): Promise<MomentBankOutcome> {
  const tz = timeZoneOf(viewer);
  const [links, profile] = await Promise.all([deps.db.$queryRaw<LinkRow[]>(momentLinkSql(viewer.id, ref, ply)), readProfile(deps.db, viewer)]);
  const first = links[0];
  // Not a player: P3's rule (a non-player admin is a no-op, everyone else 404).
  if (!first) {
    if (isAdmin(viewer)) return (await setMomentBank(deps.db, viewer, ref, ply, inBank)) === "admin_noop" ? "admin_noop" : { ply, inBank, card: null };
    throw new DataError("not_found");
  }
  // Before the review exists P3's statement answers 409 analysis_not_done (below).
  if (first.hasReview && !first.isError) throw new DataError("not_found", { message: "That move is not a key mistake of this review." });
  const due = nextRelease(now, tz, profile.releaseHour);

  return deps.tx(async (db) => {
    const rows = await db.$queryRaw<{ player: number; reviewed: number; updated: number }[]>(setMomentBankSql(viewer.id, ref, ply, inBank));
    const r = rows[0];
    if (!r || Number(r.player) === 0) throw new DataError("not_found");
    if (Number(r.reviewed) === 0) throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
    if (Number(r.updated) === 0) throw new DataError("not_found", { message: "That move is not a key moment of this review." });
    // The link again, now that this transaction holds the review row: an extraction batch (J1 or EXTRACT_MISTAKES)
    // that committed after the read above created the occurrence and card this switch must act on (FIX-1 A6 race).
    // Both batches lock the review row before their card statements, so they either commit before this point (and are
    // seen here) or wait for this commit (and read the opt-out).
    const link = (await db.$queryRaw<LinkRow[]>(momentLinkSql(viewer.id, ref, ply)))[0] ?? first;
    if (link.mistakeId === null || link.epdHash === null) return { ply, inBank, card: null };

    if (!inBank) {
      await removeBankCard(db, viewer.id, { mistakeId: link.mistakeId }, now);
      return { ply, inBank, card: null };
    }
    await db.$executeRaw(Prisma.sql`UPDATE mistakes SET "hiddenAt" = NULL, "updatedAt" = ${NOW_UTC}
      WHERE id = ${link.mistakeId} AND "userId" = ${viewer.id} AND "hiddenAt" IS NOT NULL`);
    const key = mistakeItemKey(BigInt(link.epdHash));
    const created = await db.$queryRaw<{ itemKey: string; due: unknown }[]>(Prisma.sql`WITH c AS (
        INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt", "updatedAt")
        VALUES (${viewer.id}, 'BANK', ${link.isPuzzle ? "MISTAKE" : "REVIEW_POSITION"}::"TrainingItemKind", ${key}, ${link.mistakeId},
                ${link.primaryTheme ?? "mix"}, ${link.phase ?? "MIDDLEGAME"}::"GamePhase", ${at(due)}, 'NEW', ${NOW_UTC}, ${NOW_UTC})
        ON CONFLICT ("userId", "itemKey") DO NOTHING
        RETURNING theme, "itemKey", due),
      t AS (INSERT INTO theme_mastery ("userId", theme, "bankCount") SELECT ${viewer.id}, theme, 1 FROM c
            ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + 1 RETURNING 1)
      SELECT "itemKey", due FROM c`);
    const card = created[0] ?? (link.itemKey ? { itemKey: link.itemKey, due: link.due } : null);
    if (!card) {
      const existing = await db.$queryRaw<{ itemKey: string; due: unknown }[]>(Prisma.sql`SELECT "itemKey", due FROM training_cards
        WHERE "userId" = ${viewer.id} AND "itemKey" = ${key}`);
      if (!existing[0]) return { ply, inBank, card: null };
      return { ply, inBank, card: cardOf(existing[0], now, tz) };
    }
    return { ply, inBank, card: cardOf(card, now, tz) };
  });
}

function cardOf(c: { itemKey: string; due: unknown }, now: Date, tz: string): NonNullable<MomentBankResponse["card"]> {
  const due = asDate(c.due)!;
  return { ref: c.itemKey, dueAt: due.toISOString(), dueLabel: dayLabel(due, now, tz) };
}
