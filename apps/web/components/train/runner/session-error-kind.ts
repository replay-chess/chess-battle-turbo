// The runner page's error states for a session create's ApiError (phase-05 plan §5.6, §7.9). A plain module (no
// "use client"): the server half of the runner pages (runner-page.server.tsx) calls it, and a function exported from a
// client module cannot be called on the server (FIX-1: the kill switch's copy).
export type SessionErrorKind = "session_limit" | "daily_puzzle_limit" | "upstream_unavailable" | "puzzles_disabled" | "unavailable";

/** The page's error state for a create's ApiError (null: not one of these; the page rethrows). */
export function sessionErrorKindOf(err: { code: string; retryAfterSec?: number | null; details?: Record<string, unknown> }): { kind: SessionErrorKind; retryAfterSec: number | null } | null {
  if (err.code === "rate_limited") {
    return { kind: err.details?.reason === "daily_puzzle_limit" ? "daily_puzzle_limit" : "session_limit", retryAfterSec: err.retryAfterSec ?? null };
  }
  if (err.code === "upstream_unavailable") return { kind: err.details?.kind === "disabled" ? "puzzles_disabled" : "upstream_unavailable", retryAfterSec: null };
  if (err.code === "unavailable" || err.code === "maintenance") return { kind: "unavailable", retryAfterSec: null };
  return null;
}

