// What a failed accounts mutation means for the card (phase-04 plan §5.8, §7.3.3). Pure; reads the client ApiError
// (`code`, `details.reason`), never a message string.
import { isApiError } from "@/lib/api/errors";
import type { LinkErrorKind } from "./copy";

/** The settings link POST (ACC-3, `context: "settings"`). `rate_limited` renders the RetryCountdown instead. */
export function linkErrorOf(err: unknown): LinkErrorKind | "rate_limited" | null {
  if (err == null) return null;
  if (!isApiError(err)) return "upstream";
  switch (err.code) {
    case "not_found":
      return "not_found";
    case "rate_limited":
      return "rate_limited";
    case "validation_failed":
      return "invalid";
    case "conflict":
      if (err.reason === "profile_closed" || err.reason === "linked_elsewhere" || err.reason === "already_linked") return err.reason;
      return "upstream";
    case "aborted":
      return null;
    default:
      return "upstream";
  }
}

/**
 * The sync POST (ACC-4). `paywall` = 402 (a non-member: "Importing starts when your trial begins."); 409
 * `sync_running` and 429 are not errors for the card (it stays syncing / shows the provider countdown).
 */
export function syncErrorOf(err: unknown): "paywall" | "failed" | null {
  if (err == null) return null;
  if (!isApiError(err)) return "failed";
  if (err.code === "subscription_required") return "paywall";
  if (err.code === "rate_limited" || err.code === "aborted") return null;
  if (err.code === "conflict" && err.reason === "sync_running") return null;
  return "failed";
}
