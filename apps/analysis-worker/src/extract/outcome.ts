// What a committed extraction batch says per member (phase-05 plan §7.4, §7.6 statements 5–7, §8.5): `bankAdded`
// (the moment plies of this game that have a BANK card now) and `bankDue` (the capped due count the nav and Home show),
// plus the counters of the `mistakes_extracted` event and of `mistakes:added`. Read from the batch's own rows: no extra
// query, no extra emit. A batch whose response was lost has no rows: the emit then carries nulls and the client falls
// back to A2's `ReviewStatusDTO.bank`.
import { capState } from "@repo/chess-training/caps";
import { num } from "../db/client";
import { splitBankRows } from "./bankStatements";
import type { BankPlan } from "./extractMistakes";

export interface BankAddedValue {
  count: number;
  plies: number[];
}

export interface MemberBankOutcome {
  userId: string;
  userRef: string;
  bankAdded: BankAddedValue;
  bankDue: number;
  /** Raw due count (before the cap) and every BANK card of the member. */
  dueRaw: number;
  total: number;
  cardsAdded: number;
  recurrences: number;
  /** Mistake rows inserted or seen again (`mistakes:added.added`). */
  touched: number;
}

/** `bankAdded.plies` holds at most this many plies (ReviewBank: ≤ 4). */
const PLIES_MAX = 4;

/** The per-member outcome of a committed batch (keyed by userRef). */
export function bankOutcome(plan: BankPlan, rows: readonly (readonly Record<string, unknown>[])[]): Map<string, MemberBankOutcome> {
  const split = splitBankRows(plan, rows);
  const byUser = <T>(list: readonly Record<string, unknown>[], f: (r: Record<string, unknown>) => T) =>
    new Map(list.map((r) => [String(r.userId), f(r)]));
  const due = byUser(split.due, (r) => r);
  const added = byUser(split.added, (r) => (Array.isArray(r.plies) ? r.plies.map((p) => num(p)) : []));
  const cards = byUser(split.cards, (r) => num(r.cardsAdded));
  const occ = byUser(split.occurrences, (r) => num(r.recurrences));
  const touched = new Map<string, number>();
  for (const r of split.mistakes) touched.set(String(r.userId), (touched.get(String(r.userId)) ?? 0) + 1);
  const out = new Map<string, MemberBankOutcome>();
  for (const m of plan.members) {
    const d = due.get(m.userId);
    const caps = capState({
      cap: m.cap,
      newPerDay: m.newPerDay,
      bankReviewed: d ? num(d.bankReviewed) : 0,
      newIntroduced: d ? num(d.newIntroduced) : 0,
      dueReview: d ? num(d.dueReview) : 0,
      dueNew: d ? num(d.dueNew) : 0,
    });
    const plies = (added.get(m.userId) ?? []).slice(0, PLIES_MAX);
    out.set(m.userRef, {
      userId: m.userId,
      userRef: m.userRef,
      bankAdded: { count: plies.length, plies },
      bankDue: caps.dueShown,
      dueRaw: caps.dueRaw,
      total: d ? num(d.total) : 0,
      cardsAdded: cards.get(m.userId) ?? 0,
      recurrences: occ.get(m.userId) ?? 0,
      touched: touched.get(m.userId) ?? 0,
    });
  }
  return out;
}
