// Display helpers for the Confirm step (phase-04 plan §4.3; V3OnbPreview). Pure; the server page formats with the
// request clock and the member's stored time zone, so the client renders the same strings (no hydration drift).
import type { RatingsView } from "@repo/contracts/http/accounts";

export type ProviderSlugLike = "chesscom" | "lichess";

/** "Chess.com" / "Lichess". */
export function providerName(p: ProviderSlugLike): string {
  return p === "chesscom" ? "Chess.com" : "Lichess";
}

/** "PT" → "Portugal"; unknown or missing → null. */
export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code.toUpperCase());
    return name ?? null;
  } catch {
    return null;
  }
}

/** "2021-03-14T…" → "March 2021" (UTC; a join date has no meaningful time of day). */
export function joinedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** "Chess.com · joined March 2021 · Portugal" (parts that are unknown are left out). */
export function profileSubline(provider: ProviderSlugLike, joinedAt: string | null, countryCode: string | null): string {
  const joined = joinedLabel(joinedAt);
  const country = countryName(countryCode);
  return [providerName(provider), joined ? `joined ${joined}` : null, country].filter(Boolean).join(" · ");
}

function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

/** "Today", "Yesterday", else "Oct 27" (the member's zone; unknown zones read as UTC). */
export function relativeDay(iso: string, now: Date, timeZone: string = "UTC"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const day = dayKey(d, tz);
  if (day === dayKey(now, tz)) return "Today";
  if (day === dayKey(new Date(now.getTime() - 86_400_000), tz)) return "Yesterday";
  const sameYear = dayKey(d, tz).slice(0, 4) === dayKey(now, tz).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: tz }).format(d);
}

/** The four rating tiles of the profile card: Chess.com Rapid/Blitz/Bullet/Daily, Lichess Rapid/Blitz/Bullet/Classical. */
export function ratingTiles(provider: ProviderSlugLike, ratings: RatingsView): { label: string; value: string }[] {
  const pools = provider === "chesscom" ? (["rapid", "blitz", "bullet", "daily"] as const) : (["rapid", "blitz", "bullet", "classical"] as const);
  return pools.map((p) => {
    const e = ratings[p];
    return { label: p.charAt(0).toUpperCase() + p.slice(1), value: e && e.games > 0 ? String(e.rating) : "—" };
  });
}

/** "LOSS" / "WIN" / "DRAW". */
export function resultTag(r: "win" | "loss" | "draw"): string {
  return r.toUpperCase();
}
