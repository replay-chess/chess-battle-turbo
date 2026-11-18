// Pure view helpers of the Weakness Profile (phase-06 plan §4.4–§4.7). Browser-safe, no React: the components and
// the component tests share them. Types only from the contract (zod stays out of the route's chunks, AP-12).
import type { WeaknessPayload, WeaknessProgress, WeaknessRow } from "@repo/contracts/http/weakness";
import { copy, WEAKNESS_REQUIRED } from "./copy";

/** One decimal, always printed ("4.0", "3.1"). */
export const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The common scale of every row's rate bars (§4.6 RateBar): `max over rows of max(you, band) × 1.15`, at least 1.0.
 * The board hard-codes 4.5; the real scale keeps the longest bar short of the column.
 */
export function rateScaleMax(rows: readonly Pick<WeaknessRow, "you" | "band">[]): number {
  let m = 0;
  for (const r of rows) m = Math.max(m, r.you, r.band ?? 0);
  return Math.max(1, m * 1.15);
}

/** A bar width in % of its column (0–100, rounded). */
export function barPct(value: number, scaleMax: number): number {
  if (!(scaleMax > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((value / scaleMax) * 100)));
}

/** The rows the list shows: top 1–3, then rows 4–5 when "See all" is on. */
export function visibleRows(p: Pick<WeaknessPayload, "top" | "more">, showAll: boolean): WeaknessRow[] {
  return showAll ? [...p.top, ...p.more] : [...p.top];
}

/** Every row of the profile (the drill config may select a row of `more`). */
export function allRows(p: Pick<WeaknessPayload, "top" | "more">): WeaknessRow[] {
  return [...p.top, ...p.more];
}

export function rowBySlug(p: Pick<WeaknessPayload, "top" | "more">, slug: string | null): WeaknessRow | null {
  if (!slug) return null;
  return allRows(p).find((r) => r.slug === slug) ?? null;
}

/** `/train/weakness/{slug}` → slug; anything else → null. */
export function slugFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/train\/weakness\/([a-z0-9-]{1,40})\/?$/.exec(pathname ?? "");
  return m ? m[1]! : null;
}

export const PROFILE_PATH = "/train/weakness";
export const drillPath = (slug: string): string => `${PROFILE_PATH}/${slug}`;

/** The list's label (§4.6): band, few patterns, no band, most frequent; `short` is the phone form. */
export function listLabel(p: Pick<WeaknessPayload, "listMode" | "band" | "top">, short: boolean): string {
  return copy.listLabel({
    count: p.top.length,
    band: p.listMode === "vs_band" ? (p.band?.label ?? null) : null,
    mostFrequent: p.listMode === "most_frequent",
    short,
  });
}

/** Rows compare with the band only in `vs_band` mode (own_only has no band; most_frequent shows neither). */
export function showsBand(p: Pick<WeaknessPayload, "listMode">): boolean {
  return p.listMode === "vs_band";
}

export function rateAria(row: Pick<WeaknessRow, "you" | "band" | "unit">, withBand: boolean): string {
  return copy.rateAria({ you: fmt1(row.you), band: withBand && row.band !== null ? fmt1(row.band) : null, underMinute: row.unit === "per100_under1min" });
}

// ── S1 insufficient ────────────────────────────────────────────────────────────────────────────────────────────
export type InsufficientSub = "zero" | "few" | "preliminary";

export type InsufficientModel = {
  sub: InsufficientSub;
  h2: string;
  analysed: number;
  meterLabel: string;
  meterCaption: string;
  meterPct: number;
  /** "Or play 6 more games here": null when 20 − inScope ≤ 0. */
  playMore: string | null;
  playMoreCount: number;
  /** "You have 64 bullet games …": null when there is no offer. */
  bullet: { games: number; text: string } | null;
};

export function insufficientModel(p: Pick<WeaknessPayload, "games" | "preliminary" | "offers" | "scope">): InsufficientModel {
  const analysed = Math.max(0, p.games.analysed);
  const sub: InsufficientSub = analysed === 0 && p.games.inScope === 0 ? "zero" : p.preliminary.length > 0 && analysed >= 5 ? "preliminary" : "few";
  const playMoreCount = WEAKNESS_REQUIRED - p.games.inScope;
  const offer = p.offers.includeBullet;
  return {
    sub,
    h2: sub === "zero" ? copy.insufficientZeroH2 : copy.insufficientH2(analysed),
    analysed,
    meterLabel: copy.meterLabel(analysed),
    meterCaption: copy.meterCaption(analysed),
    meterPct: Math.round((Math.min(analysed, WEAKNESS_REQUIRED) / WEAKNESS_REQUIRED) * 100),
    playMore: playMoreCount > 0 ? copy.playMore(playMoreCount) : null,
    playMoreCount: Math.max(0, playMoreCount),
    bullet: offer ? { games: offer.bulletGames, text: copy.bulletOffer(offer.bulletGames, p.scope.months) } : null,
  };
}

// ── S2 computing ───────────────────────────────────────────────────────────────────────────────────────────────
/** The polite announcements fire at 25, 50, 75 and 100 % only (§4.5 "Live announcements"). */
export function milestoneOf(pct: number): 0 | 25 | 50 | 75 | 100 {
  if (pct >= 100) return 100;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  if (pct >= 25) return 25;
  return 0;
}

export function computingHeading(progress: WeaknessProgress, inScope: number): { h2: string; sub: string | null } {
  const capped = inScope > progress.target;
  return { h2: copy.analysing(progress.target, capped), sub: progress.target > WEAKNESS_REQUIRED ? copy.firstTwenty : null };
}

// ── S3 breakdown ───────────────────────────────────────────────────────────────────────────────────────────────
/** Clock column heights in % of the tallest bar (the board's `c.v / max`). */
export function clockHeights(buckets: readonly { per100: number | null }[]): number[] {
  const max = Math.max(0, ...buckets.map((b) => b.per100 ?? 0));
  return buckets.map((b) => (max > 0 && b.per100 !== null ? Math.max(2, Math.round((b.per100 / max) * 100)) : 0));
}

/** A phase row below its band is drawn in the `--cb-bad` tint (board `worse`). */
export const phaseWorse = (you: number | null, band: number | null): boolean => you !== null && band !== null && you < band;

/** "{label} is now your top pattern": the top changed between two ready payloads (§4.6 `top_changed`). */
export function topChanged(prev: Pick<WeaknessPayload, "status" | "top"> | undefined, next: Pick<WeaknessPayload, "status" | "top">): string | null {
  if (!prev || prev.status !== "ready" || next.status !== "ready") return null;
  const a = prev.top[0]?.pattern;
  const b = next.top[0];
  if (!a || !b || a === b.pattern) return null;
  return b.label;
}

/** §4.4 `linked`: an account is linked and no import is running, so the primary CTA reads "Check for new games". */
export function linkedIdle(me: { accounts?: readonly { status: string }[]; import?: { status: string } | null } | undefined): boolean {
  if (!me?.accounts?.some((a) => a.status === "linked")) return false;
  const run = me.import?.status;
  return run !== "waiting_for_membership" && run !== "queued" && run !== "running";
}
