// The review's Mistake Bank fields (phase-05 plan §7.3 "Review bank fields", §4.8; interface check §0.5): P3's A1 /
// A2 / complete reads gain, under the `train` flag, the BANK cards that exist for the member side's key-moment plies.
// The link is `mistake_occurrences (gameId, ply)` → `mistakes` (the member's, not hidden) → `training_cards`
// (`mistakeId`), so "Added" / "Not added" reflect real cards, including a W6 removal or an A6 switch.
//
// Folded into P3's one read statement as scalar subqueries (served by mistake_occurrences_pkey, mistakes_pkey and
// training_cards_mistakeId_key), so A1 and A2 stay one statement and the 304 path stays the probe: the probe carries
// a bank token (card count and newest card update over the game's occurrences, no content detoast) that both ETags
// include, so a grade, a skip, a removal or a new card moves them. With the flag off nothing is selected and the
// payloads and ETags are P3's, byte for byte.
import { Prisma } from "@repo/db";
import type { MomentBankCard, MomentCard, ReviewBank } from "@repo/contracts/http/train";
import { dayLabel } from "@repo/chess-training/labels";
import { isValidTimeZone } from "@repo/chess-training/tz";
import type { Viewer } from "@/lib/auth/viewer";
import { asDate, num } from "./db.server";

const MEMBER_CARDS = Prisma.sql`mistake_occurrences mo
  JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = gp."userId" AND m."hiddenAt" IS NULL
  JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'`;

/** `[{ply, key, due}]` of the member side's moment plies that have a card (aliases `g`, `gp`, `pr`). */
export const BANK_CARDS_COLUMN = Prisma.sql`(SELECT COALESCE(json_agg(json_build_object('ply', mo.ply, 'key', c."itemKey",
      'due', to_char(c.due, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY mo.ply), '[]'::json)
    FROM ${MEMBER_CARDS}
    WHERE mo."gameId" = g.id
      AND mo.ply IN (SELECT (x->>'ply')::int FROM jsonb_array_elements(COALESCE(pr.content->'moments', '[]'::jsonb)) x)) AS "bankCards"`;

/** The ETag part: the game's member cards and their newest update (no content read). */
export const BANK_TOKEN_COLUMN = Prisma.sql`(SELECT count(*)::text || '.' ||
      COALESCE(floor(extract(epoch FROM max(c."updatedAt")) * 1000)::bigint::text, '0') || '.' || gp."bankVersion"::text
    FROM ${MEMBER_CARDS} WHERE mo."gameId" = g.id) AS "bankToken"`;

export const NO_BANK_COLUMNS = Prisma.sql`NULL::text AS "bankToken"`;

export type BankCard = { ply: number; key: string; due: Date };

export function bankCardsOf(value: unknown): BankCard[] {
  const list = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((x) => {
    const o = x as Record<string, unknown>;
    const due = asDate(o.due);
    return typeof o.key === "string" && due ? [{ ply: num(o.ply), key: o.key, due }] : [];
  });
}

/** How the bank fields are labelled: the request clock and the viewer's zone. */
export type BankContext = { nowMs: number; timeZone: string };

export function bankContextOf(viewer: { onboarding?: Viewer["onboarding"]; user?: Pick<Viewer["user"], "timeZone"> }, nowMs: number): BankContext {
  const tz = viewer.onboarding?.timeZone ?? viewer.user?.timeZone ?? "UTC";
  return { nowMs, timeZone: isValidTimeZone(tz) ? tz : "UTC" };
}

/** MomentDTO.inBank / card for one moment ply. */
export function momentBankOf(cards: readonly BankCard[], ply: number, ctx: BankContext): { inBank: boolean; card: MomentCard | null } {
  const c = cards.find((x) => x.ply === ply);
  if (!c) return { inBank: false, card: null };
  return { inBank: true, card: { ref: c.key, dueLabel: dayLabel(c.due, new Date(ctx.nowMs), ctx.timeZone) } };
}

/** ReviewStatusDTO.bank: null before the side was extracted (`bankVersion` 0), else the cards that exist now. */
export function reviewBankOf(cards: readonly BankCard[], bankVersion: number | null | undefined): ReviewBank | null {
  if (!bankVersion) return null;
  return { count: cards.length, plies: cards.map((c) => c.ply).slice(0, 4) };
}

/** Review complete: "3 added … The first one comes back tomorrow." and Drill These 3 Mistakes. */
export function completeBankOf(
  cards: readonly BankCard[],
  gameRef: string,
  ctx: BankContext,
): { added: number; nextDueAt: string | null; nextDueLabel: string | null; drillHref: string | null } {
  if (cards.length === 0) return { added: 0, nextDueAt: null, nextDueLabel: null, drillHref: null };
  const first = cards.reduce((a, b) => (b.due.getTime() < a.due.getTime() ? b : a));
  const label = dayLabel(first.due, new Date(ctx.nowMs), ctx.timeZone, { long: true });
  return {
    added: Math.min(3, cards.length),
    nextDueAt: first.due.toISOString(),
    nextDueLabel: label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label,
    drillHref: `/train/bank/session?game=${encodeURIComponent(gameRef)}`,
  };
}

/** A6's card in the response shape. */
export function momentBankCardOf(c: BankCard, ctx: BankContext): MomentBankCard {
  return { ref: c.key, dueAt: c.due.toISOString(), dueLabel: dayLabel(c.due, new Date(ctx.nowMs), ctx.timeZone) };
}

// ── The `train` flag (lazy, with a test seam; flags never gate authorisation) ──────────────────────────────────
export type BankFlag = (viewer: Viewer) => Promise<boolean>;

const defaultBankFlag: BankFlag = async (viewer) => {
  const { getFlags } = await import("@/lib/flags");
  return (await getFlags(viewer)).train;
};

let bankFlag: BankFlag = defaultBankFlag;

/** Test seam; returns a restore function. */
export function setBankFlag(next: BankFlag): () => void {
  const previous = bankFlag;
  bankFlag = next;
  return () => {
    bankFlag = previous;
  };
}

/** The review bank fields are on for this viewer (the `train` flag). */
export async function bankFieldsEnabled(viewer: Viewer): Promise<boolean> {
  try {
    return await bankFlag(viewer);
  } catch {
    return false;
  }
}
