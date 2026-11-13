// Connected accounts copy (phase-04 plan §4.10, §4.11, §8.11; DR/V4SettingsConnected*.dc.html). Pure and zod-free: the
// cards, the archive's import banner and the unit tests read the same strings. Copy rules: one sentence, the object
// first, no usernames in telemetry (the copy may show the member's own handle on their own page).
import type { ProviderSlug, TimeClassSlug } from "@repo/contracts/http/p04-plain";

type RatingsLike = Partial<Record<TimeClassSlug, { rating: number; games: number }>>;

const PROVIDER_NAME: Record<ProviderSlug, string> = { chesscom: "Chess.com", lichess: "Lichess" };

/** Display order of the rating pools (the board's "BLITZ 1179 · RAPID 1206"). */
const POOL_ORDER: readonly TimeClassSlug[] = ["bullet", "blitz", "rapid", "classical", "daily"];

export function providerName(provider: ProviderSlug): string {
  return PROVIDER_NAME[provider];
}

/** 2000 → "2,000" (negative and fractional values are clamped and rounded). */
export function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

/** 90 → "1:30"; never negative. */
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * How long ago `iso` was, worded to follow "Last sync …": "just now", "1 minute ago", "2 hours ago", "yesterday",
 * "3 days ago", then "on Oct 3" (UTC date, so the server and the browser agree on the first paint).
 */
export function relativeTime(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "just now";
  const sec = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const d = new Date(at);
  return `on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The two pools with the most games, in pool order: "BLITZ 1032 · RAPID 1184". Null with no rated pool. */
export function ratingsLine(ratings: RatingsLike): string | null {
  const pools = POOL_ORDER.filter((p) => ratings[p] !== undefined);
  if (!pools.length) return null;
  const top = [...pools].sort((a, b) => (ratings[b]!.games - ratings[a]!.games) || POOL_ORDER.indexOf(a) - POOL_ORDER.indexOf(b)).slice(0, 2);
  return POOL_ORDER.filter((p) => top.includes(p))
    .map((p) => `${p.toUpperCase()} ${ratings[p]!.rating}`)
    .join(" · ");
}

/** "IMPORTING 212 / 480" (the total is unknown while the run is still reading: "IMPORTING 212 / …"). */
export function importingLabel(imported: number, total: number | null): string {
  return `IMPORTING ${formatCount(imported)} / ${total === null ? "…" : formatCount(total)}`;
}

/** "N games imported" with the singular. */
export function gamesImported(n: number): string {
  return n === 1 ? "1 game imported" : `${formatCount(n)} games imported`;
}

export const INTRO =
  "Linked games feed your reviews, Mistake Bank and weakness profile. Importing never posts anything.";
export const SAVED_STATUS = "SAVED · SYNCED";
export const AUTO_IMPORT_LABEL = "Import new games every day";
export const AUTO_IMPORT_HINT = "About 3 a.m. your time";
export const CHESSCOM_UNLINKED_HINT = "Enter your Chess.com username. We read your public games; you never share a password.";
export const LICHESS_UNLINKED_HINT =
  "Sign in on Lichess and approve read-only access to your games. You come straight back here.";
export const WAITING_FOR_TRIAL = "Importing starts when your trial begins.";
export const SYNC_START_FAILED = "Couldn't start the sync. Try again.";
export const AUTO_IMPORT_FAILED = "Couldn't save the setting";
export const DISCONNECT_FAILED = "Couldn't disconnect. Try again.";

export function syncFailedCopy(provider: ProviderSlug, importedCount: number, lastGoodIso: string | null, nowMs: number): string {
  const safe = `Your ${formatCount(importedCount)} imported games are safe`;
  const last = lastGoodIso ? `; the last good sync was ${relativeTime(lastGoodIso, nowMs)}.` : ".";
  return `${providerName(provider)} didn’t respond. ${safe}${last}`;
}

export function rateLimitedCopy(provider: ProviderSlug): { before: string; after: string } {
  return { before: `${providerName(provider)} is limiting requests. You can sync again in `, after: "." };
}

/** inv-acct Q19 copy: skipped games are variants, unrated or unfinished games (never "private"). */
export function skippedCopy(imported: number, seen: number, skipped: number): string {
  return `We imported ${formatCount(imported)} of ${formatCount(seen)} games. ${formatCount(skipped)} were skipped: variants, unrated or unfinished games.`;
}

export function closedCopy(provider: ProviderSlug, importedCount: number): string {
  return `This ${providerName(provider)} account was closed, so new games can't be imported. Your ${formatCount(importedCount)} imported games are safe.`;
}

/** §8.11: the account vanished upstream (renamed or deleted). */
export function goneCopy(provider: ProviderSlug, username: string): string {
  return `We couldn't find ${username} on ${providerName(provider)}. If you renamed your account, link it again.`;
}

export function notFoundCopy(typed: string): string {
  return `No Chess.com player called “${typed}”. Check the spelling; it is the name in your Chess.com profile link.`;
}

export type LinkErrorKind = "not_found" | "profile_closed" | "linked_elsewhere" | "already_linked" | "upstream" | "invalid";

export function linkErrorCopy(kind: Exclude<LinkErrorKind, "not_found" | "invalid">): string {
  switch (kind) {
    case "profile_closed":
      return "This Chess.com account is closed, so its games can't be imported.";
    case "linked_elsewhere":
      return "This Chess.com account is linked to another ReplayChess account.";
    case "already_linked":
      return "You already linked a different Chess.com account. Disconnect it first.";
    case "upstream":
      return "Chess.com didn't respond. Try again.";
  }
}

export const LICHESS_DENIED = "Lichess sign-in was cancelled, so nothing was linked. You can try again.";

/** `?lichess=error&reason=…` after the OAuth callback (LICHESS_ERROR_REASONS). */
export function lichessErrorCopy(reason: string | null): string {
  switch (reason) {
    case "linked_elsewhere":
      return "This Lichess account is linked to another ReplayChess account.";
    case "already_linked":
      return "You already linked a different Lichess account. Disconnect it first.";
    case "rate_limited":
      return "Too many attempts. Wait a minute, then try again.";
    case "state":
      return "The Lichess sign-in expired, so nothing was linked. Try again.";
    default:
      return "Lichess didn't respond, so nothing was linked. Try again.";
  }
}

export function syncFinishedToast(newGames: number): string {
  return newGames === 1 ? "Sync finished · 1 new game" : `Sync finished · ${formatCount(newGames)} new games`;
}

export function lichessLinkedToast(games: number | null): string {
  return games === null ? "Lichess linked · importing your games" : `Lichess linked · importing ${formatCount(games)} games`;
}

export function disconnectedToast(provider: ProviderSlug, deletingGames: boolean): string {
  return `${providerName(provider)} disconnected. ${deletingGames ? "Imported games are being removed." : "Imported games kept."}`;
}

export function disconnectQuestion(provider: ProviderSlug): string {
  return `Disconnect ${providerName(provider)}?`;
}
export const DISCONNECT_BODY = "New games stop importing. Games already imported stay in your archive unless you remove them.";

export function deleteGamesLabel(n: number): string {
  return n === 1 ? "Also delete the 1 imported game and its review" : `Also delete the ${formatCount(n)} imported games and their reviews`;
}

/** The archive's empty copy for a provider tab (plan §4.11). */
export function sourceEmptyCopy(provider: ProviderSlug, linked: boolean): string {
  return linked
    ? `No ${providerName(provider)} games yet. They appear here as they import.`
    : `No ${providerName(provider)} games yet. Link your account to import them.`;
}
