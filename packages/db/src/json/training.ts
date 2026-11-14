// JSON column registry entries of M5 (phase-05 plan 6.3; data-model §2.6, §9): training_days.plan (DailyPlanV1),
// training_sessions.items (SessionItemsV1), mistakes.texts (MistakeTextV1, written from P7) and the EXTRACT_MISTAKES
// job payload (ExtractMistakesPayloadV1, owned by @repo/contracts/internal/jobs like every job payload, re-exported
// here so the registry lists every JSON column shape). Each carries `v`. Writers validate (`build*` throws); readers
// are lenient (`parse*` returns null for a row an older or newer build wrote, and the caller rebuilds it).
import type { DailyPlan } from "@repo/chess-training/plan";
import { z } from "zod";

export { ExtractMistakesPayloadV1 } from "@repo/contracts/internal/jobs";

const ThemeKeyDb = z.string().regex(/^(rc:)?[A-Za-z0-9]{2,30}$/);
const ItemKeyDb = z.string().regex(/^[mpo]_[A-Za-z0-9]{1,24}$/);

/** The local plan of one training day, frozen on the first hub read of that day (plan 8.10); nulled after 7 days. */
export const DailyPlanV1 = z.object({
  v: z.literal(1),
  createdAt: z.iso.datetime(),
  basis: z.enum(["bank", "games20", "new"]),
  focusTheme: z.string().max(32),
  steps: z
    .array(
      z.object({
        kind: z.enum(["bank", "puzzles", "lesson", "review", "import"]),
        /** Bank step: the frozen card list. */
        cardKeys: z.array(ItemKeyDb).max(10).optional(),
        theme: ThemeKeyDb.optional(),
        count: z.number().int().min(1).max(10).optional(),
        title: z.string().max(80),
        subtitle: z.string().max(80),
        estMin: z.number().int().min(1).max(60),
        href: z.string().startsWith("/").max(200),
      }),
    )
    .max(3),
});
export type DailyPlanV1 = z.infer<typeof DailyPlanV1>;

// The plan builder's output (`@repo/chess-training/plan` `DailyPlan`; chess-training cannot import this package: db
// depends on it) is exactly this column's shape: a compile-time check, so the two can never drift.
type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const DAILY_PLAN_SHAPE_MATCHES: SameShape<DailyPlan, DailyPlanV1> = true;

export const SESSION_ITEM_KINDS_DB = ["MISTAKE", "REVIEW_POSITION", "LICHESS_PUZZLE", "OPENING_LINE"] as const;

/** A puzzle snapshot inside a session: [lichessId, fen, "setup best reply …", rating, primaryTheme]. */
export const PuzzleSnapshotV1 = z.tuple([
  z.string().regex(/^[A-Za-z0-9]{5,8}$/),
  z.string().max(100),
  z.string().max(120),
  z.number().int(),
  z.string().max(32),
]);
export type PuzzleSnapshotV1 = z.infer<typeof PuzzleSnapshotV1>;

/** A session's item list incl. requeued AGAIN copies (`pass: 2`, id + "b"). ≤ 40 items. */
export const SessionItemsV1 = z.object({
  v: z.literal(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(8),
        key: z.string().max(40),
        kind: z.enum(SESSION_ITEM_KINDS_DB),
        pass: z.union([z.literal(1), z.literal(2)]),
        skipped: z.boolean().optional(),
        p: PuzzleSnapshotV1.optional(),
      }),
    )
    .max(40),
});
export type SessionItemsV1 = z.infer<typeof SessionItemsV1>;

/** P7: verified LLM text for a mistake. Null until then (P5 computes its texts at read time, dm D7). */
export const MistakeTextV1 = z.object({
  v: z.literal(1),
  hint: z.string(),
  correct: z.string(),
  wrong: z.string().nullable(),
  cost: z.string(),
  model: z.string(),
  verifiedAt: z.iso.datetime(),
});
export type MistakeTextV1 = z.infer<typeof MistakeTextV1>;

/** Validates a plan before it is written (throws on a bad value). */
export function buildDailyPlan(value: unknown): DailyPlanV1 {
  return DailyPlanV1.parse(value);
}

/** A stored plan, or null when the row holds none or a shape this build cannot read (the hub rebuilds it). */
export function parseDailyPlan(value: unknown): DailyPlanV1 | null {
  if (value === null || value === undefined) return null;
  const parsed = DailyPlanV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Validates a session's items before they are written, and that item ids are unique. */
export function buildSessionItems(value: unknown): SessionItemsV1 {
  const items = SessionItemsV1.parse(value);
  const ids = new Set<string>();
  for (const it of items.items) {
    if (ids.has(it.id)) throw new Error(`SessionItemsV1: duplicate item id ${it.id}`);
    ids.add(it.id);
  }
  return items;
}

/** A stored item list, or null for a shape this build cannot read (the session is then treated as ended). */
export function parseSessionItems(value: unknown): SessionItemsV1 | null {
  const parsed = SessionItemsV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** P7's verified text, or null (P5 never writes it). */
export function parseMistakeText(value: unknown): MistakeTextV1 | null {
  if (value === null || value === undefined) return null;
  const parsed = MistakeTextV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}
