// The Link step's states (phase-04 plan §4.2; V3OnbLink enum `default, validating, found, not_found,
// private_profile, rate_limited, lichess_denied`, plus the "not drawn" rows: linked_elsewhere, upstream down, the
// Lichess errors, Lichess pending). Pure and zod-free: the step component maps the lookup mutation through these.
import type { LookupData } from "@repo/contracts/http/accounts";
import { CHESSCOM_USERNAME_MESSAGE, CHESSCOM_USERNAME_RE, type TimeClassSlug } from "@repo/contracts/http/p04-plain";

/** What the "Found …" line shows (a fresh lookup, or the account the member already linked). */
export type FoundSummary = {
  /** Lower-case handle: the confirm URL's `u`. */
  username: string;
  displayUsername: string;
  headline: { timeClass: TimeClassSlug; rating: number } | null;
  totalRatedGames: number;
};

export type ChessComCardState =
  | { kind: "default" }
  | { kind: "validating" }
  | { kind: "found"; found: FoundSummary }
  | { kind: "private_profile" }
  | { kind: "not_found"; typed: string }
  | { kind: "invalid"; typed: string }
  | { kind: "rate_limited" }
  | { kind: "linked_elsewhere" }
  | { kind: "upstream" };

export type LichessCardState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "denied" }
  | { kind: "error"; reason: string };

/** The input as sent: trimmed, a leading `@` dropped, the typed case kept (the server lower-cases). */
export function normaliseTyped(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

/** Client-side check (no zod in the bundle, AP-12): null when fine, else the message to show. */
export function usernameProblem(typed: string): string | null {
  return CHESSCOM_USERNAME_RE.test(typed) ? null : CHESSCOM_USERNAME_MESSAGE;
}

export function foundOf(data: LookupData): FoundSummary {
  return {
    username: data.profile.username,
    displayUsername: data.profile.displayUsername,
    headline: data.headline,
    totalRatedGames: data.totalRatedGames,
  };
}

type ErrorLike = { code?: string; status?: number; details?: Record<string, unknown> };

/** The card state after a lookup answered `data`, or failed with `error`. */
export function stateFromLookup(result: { data?: LookupData; error?: unknown }, typed: string): ChessComCardState {
  if (result.data) {
    return result.data.status === "private" ? { kind: "private_profile" } : { kind: "found", found: foundOf(result.data) };
  }
  const e = (result.error ?? {}) as ErrorLike;
  switch (e.code) {
    case "not_found":
      return { kind: "not_found", typed };
    case "rate_limited":
      return { kind: "rate_limited" };
    case "conflict":
      return e.details?.reason === "linked_elsewhere" ? { kind: "linked_elsewhere" } : { kind: "upstream" };
    case "validation_failed":
      return { kind: "invalid", typed };
    default:
      return { kind: "upstream" };
  }
}

/** The `?lichess=` / `?reason=` a Lichess return (or a failed start) put on /onboarding/link. */
export function lichessStateOf(lichess: string | undefined, reason: string | undefined): LichessCardState {
  if (lichess === "denied") return { kind: "denied" };
  if (lichess === "error") return { kind: "error", reason: reason ?? "upstream" };
  return { kind: "idle" };
}

export function lichessErrorCopy(reason: string): string {
  switch (reason) {
    case "already_linked":
      return "You already have a Lichess account linked. Disconnect it in Settings first.";
    case "linked_elsewhere":
      return "This Lichess account is linked to another ReplayChess account.";
    case "rate_limited":
      return "Too many attempts. Wait a minute, then try again.";
    default:
      return "Lichess didn't answer. Try again.";
  }
}

/** The card state a return from Confirm asks for (`?error=not_found&u=…`, `?error=linked_elsewhere`). */
export function stateFromConfirmReturn(error: string | undefined, u: string | undefined): ChessComCardState | null {
  if (error === "not_found") return { kind: "not_found", typed: u ?? "" };
  if (error === "linked_elsewhere") return { kind: "linked_elsewhere" };
  return null;
}

const TIME_CLASS_LABEL: Record<TimeClassSlug, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Classical",
  daily: "Daily",
};

export function timeClassName(tc: TimeClassSlug): string {
  return TIME_CLASS_LABEL[tc];
}

/** 12345 → "12,345". */
export function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

/** The "Found …" line without the name: " · Rapid 1184 · 480 rated games" / " · no rated games yet". */
export function foundDetail(f: FoundSummary): string {
  if (f.totalRatedGames <= 0) return " · no rated games yet";
  const head = f.headline ? ` · ${timeClassName(f.headline.timeClass)} ${f.headline.rating}` : "";
  return `${head} · ${formatCount(f.totalRatedGames)} rated ${f.totalRatedGames === 1 ? "game" : "games"}`;
}

/** The confirm step's URL for a found Chess.com handle. */
export function confirmUrl(username: string): string {
  return `/onboarding/confirm?provider=chesscom&u=${encodeURIComponent(username)}`;
}

/** Where Continue goes (null: not available yet → focus the input and say "Look up your profile first."). */
export function continueTarget(state: ChessComCardState): { kind: "confirm"; href: string } | { kind: "level" } | null {
  if (state.kind === "found") return { kind: "confirm", href: confirmUrl(state.found.username) };
  if (state.kind === "private_profile") return { kind: "level" };
  return null;
}

/** The telemetry `result` of a lookup state. */
export function lookupResultProp(state: ChessComCardState): "found" | "not_found" | "private" | "no_games" | "rate_limited" | "linked_elsewhere" | "error" {
  switch (state.kind) {
    case "found":
      return state.found.totalRatedGames > 0 ? "found" : "no_games";
    case "private_profile":
      return "private";
    case "not_found":
    case "invalid":
      return "not_found";
    case "rate_limited":
      return "rate_limited";
    case "linked_elsewhere":
      return "linked_elsewhere";
    default:
      return "error";
  }
}
