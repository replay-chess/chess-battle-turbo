// The one view status /settings/connected renders per linked account (phase-04 plan §8.11, D4-04): LinkStatus ×
// ImportState × whether the provider back-off (`nextAllowedSyncAt`) is still running. Pure; the table is
// unit-tested over the full product of the enums (view-status.test.ts).
import type { LinkViewStatus } from "@repo/contracts/http/p04-plain";

export type LinkStatusDb = "ACTIVE" | "ERROR" | "RELINK_REQUIRED";
export type ImportStateDb = "IDLE" | "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "RATE_LIMITED" | "FAILED";

export const LINK_STATUSES_DB = ["ACTIVE", "ERROR", "RELINK_REQUIRED"] as const satisfies readonly LinkStatusDb[];
export const IMPORT_STATES_DB = [
  "IDLE",
  "WAITING_FOR_MEMBERSHIP",
  "QUEUED",
  "RUNNING",
  "RATE_LIMITED",
  "FAILED",
] as const satisfies readonly ImportStateDb[];

export function linkViewStatus(
  row: { status: LinkStatusDb; importState: ImportStateDb; nextAllowedSyncAt: Date | null },
  now: Date,
): LinkViewStatus {
  // `ERROR` (and the reserved RELINK_REQUIRED) force `error` whatever the import state says.
  if (row.status !== "ACTIVE") return "error";
  const limited = row.nextAllowedSyncAt !== null && row.nextAllowedSyncAt.getTime() > now.getTime();
  switch (row.importState) {
    case "WAITING_FOR_MEMBERSHIP":
      return "waiting_for_membership";
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "syncing";
    case "RATE_LIMITED":
      return limited ? "rate_limited" : "queued";
    case "FAILED":
      return "error";
    case "IDLE":
      return limited ? "rate_limited" : "linked";
  }
}
