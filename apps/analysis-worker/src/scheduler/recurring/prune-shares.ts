// HOUSEKEEPING slice 2 (phase-03 plan §7.7, §6.4): REVIEW share links are deleted 7 days after they expired (the
// public page shows `gone` in between). Uses the partial index shares_expires_idx. POSITION shares (P9) are not P3's.
import { num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { RecurringSlice } from "./types";

export const SHARE_PURGE_AFTER_DAYS = 7;

export function pruneSharesStatement(): Statement {
  return stmt(
    `WITH d AS (
  DELETE FROM shares
   WHERE kind = 'REVIEW' AND "expiresAt" IS NOT NULL AND "expiresAt" < ${NOW} - ($1::int * interval '1 day')
  RETURNING 1
)
SELECT count(*)::int AS deleted FROM d`,
    [SHARE_PURGE_AFTER_DAYS],
  );
}

export const pruneShares: RecurringSlice = {
  id: "prune-shares",
  statements: () => [pruneSharesStatement()],
  async after(ctx, [rows]) {
    ctx.log.info("pruned shares", { deleted: num(rows?.[0]?.deleted ?? 0) });
  },
};
