// JSON column registry entry for import_cursors.archives (phase-04 plan 6.4, 8.6; R-CC-04).
//
// Chess.com only: per archive month, the validators of its last 200 response and whether the month is complete
// (a past month whose games were all read). The worker patches it once per month inside the batch statement
// (`archives = COALESCE(archives, '{}') || $patch`), so a patch is a whole `{v, months}` object whose `months` hold
// only the changed keys; `jsonb ||` is a shallow merge, and mergeArchives() is its TypeScript twin.
import { z } from "zod";

/** "YYYY/MM", as the Chess.com archive URL spells it. */
export const ARCHIVE_MONTH_RE = /^\d{4}\/(0[1-9]|1[0-2])$/;

export const ArchiveMonthV1 = z.object({
  etag: z.string().max(120).optional(),
  lastModified: z.string().max(40).optional(),
  /** true once every game of a past month is read; the current month is never done. */
  done: z.boolean(),
  games: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type ArchiveMonthV1 = z.infer<typeof ArchiveMonthV1>;

export const ArchivesV1 = z.object({
  v: z.literal(1),
  months: z.record(z.string().regex(ARCHIVE_MONTH_RE), ArchiveMonthV1),
});
export type ArchivesV1 = z.infer<typeof ArchivesV1>;

export function archiveMonthKey(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`archiveMonthKey: bad month ${year}/${month}`);
  }
  return `${String(year).padStart(4, "0")}/${String(month).padStart(2, "0")}`;
}

/** Reads a stored value; an absent or unreadable value reads as "no months yet" (the next run refetches). */
export function parseArchives(value: unknown): ArchivesV1 {
  const parsed = ArchivesV1.safeParse(value);
  return parsed.success ? parsed.data : { v: 1, months: {} };
}

/**
 * A patch for the batch statement: validated, with only the given months. The SQL merges it with `||` at the top
 * level, so the `months` of a patch REPLACE the stored `months` object: pass the full merged months
 * (mergeArchives) when patching, never a single month alone.
 */
export function buildArchivesPatch(archives: ArchivesV1): ArchivesV1 {
  return ArchivesV1.parse(archives);
}

/** `stored` with `patch.months` laid over it, month by month. */
export function mergeArchives(stored: ArchivesV1, patch: Pick<ArchivesV1, "months">): ArchivesV1 {
  return ArchivesV1.parse({ v: 1, months: { ...stored.months, ...patch.months } });
}
