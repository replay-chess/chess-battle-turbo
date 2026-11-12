// The /games filter (phase-03 plan §4.9, §5.10): the URL is the state (`?q=&result=&tc=&moments=1&sel=`).
//
// Client-safe and zod-free: the parsing (`gamesFilterOf`), the constants and the query string come from the zod-free
// contract module (@repo/contracts/http/plain), the same functions G1 and the RSC page use; this file adds the URL
// state (`sel`, the raw `moments` string) and the popover's chip and segment helpers.
import {
  GAMES_PAGE_LIMIT,
  GAMES_SEARCH_MAX,
  GAMES_SEARCH_MIN,
  GAME_RESULT_FILTERS,
  GAME_TC_FILTERS,
  gamesFilterOf,
  gamesFilterToSearch,
  type GamesFilter,
} from "@repo/contracts/http/plain";
import type { GameResultFilter, GameTcFilter } from "@repo/contracts/http/games";

export type { GamesFilter, GameResultFilter, GameTcFilter };

export const RESULT_FILTERS = GAME_RESULT_FILTERS;
export const TC_FILTERS = GAME_TC_FILTERS;
export const SEARCH_MIN = GAMES_SEARCH_MIN;
export const SEARCH_MAX = GAMES_SEARCH_MAX;
/** Page size of G1. */
export const PAGE_LIMIT = GAMES_PAGE_LIMIT;

/** zod 4 `stringbool()` truthy strings (case-insensitive); everything else is "not set" for `moments`. */
const TRUTHY = new Set(["true", "1", "yes", "on", "y", "enabled"]);

export type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

function read(sp: SearchInput, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** The normalised filter of raw query values: the contract's `gamesFilterOf()` after reading `moments` as G1 does. */
export function filterOf(raw: { q?: string; result?: string; tc?: string; moments?: string | boolean }): GamesFilter {
  const moments = typeof raw.moments === "boolean" ? raw.moments : TRUTHY.has((raw.moments ?? "").trim().toLowerCase());
  return gamesFilterOf({ q: raw.q, result: raw.result, tc: raw.tc, moments });
}

export type ArchiveUrlState = {
  filter: GamesFilter;
  /** The search box text as typed (may be 1 character, which the filter ignores). */
  text: string;
  /** `?sel=`: the selected row. */
  sel: string | null;
};

/** Parses `/games?…` (the RSC searchParams or the client's URLSearchParams). */
export function parseArchiveSearch(sp: SearchInput): ArchiveUrlState {
  const text = (read(sp, "q") ?? "").slice(0, SEARCH_MAX);
  const filter = filterOf({ q: text, result: read(sp, "result"), tc: read(sp, "tc"), moments: read(sp, "moments") });
  const sel = read(sp, "sel");
  return { filter, text, sel: sel && /^[a-z0-9]{1,64}$/i.test(sel) ? sel : null };
}

/** The query string of a filter in canonical form (no leading `?`); `sel` last. Inverse of parseArchiveSearch. */
export function archiveSearch(filter: GamesFilter, sel?: string | null): string {
  const q = new URLSearchParams(gamesFilterToSearch(filter));
  if (sel) q.set("sel", sel);
  return q.toString();
}

/** G1's query string for a filter, cursor and limit (the same keys as the page URL). */
export function g1Search(filter: GamesFilter, cursor: string | null, limit: number = PAGE_LIMIT): string {
  const q = new URLSearchParams(archiveSearch(filter));
  if (cursor) q.set("cursor", cursor);
  q.set("limit", String(limit));
  return q.toString();
}

/**
 * The query-key form of a filter for `qk.games.list(…)` / counts: scalar values only (the key factory's `norm()`
 * takes a flat record), lists as canonical csv. Two equal filters always give equal keys.
 */
export function keyFilter(filter: GamesFilter): { q?: string; result?: string; tc?: string; moments?: boolean } {
  return {
    q: filter.q,
    result: filter.result?.length ? filter.result.join(",") : undefined,
    tc: filter.tc?.length ? filter.tc.join(",") : undefined,
    moments: filter.moments ? true : undefined,
  };
}

export function sameFilter(a: GamesFilter, b: GamesFilter): boolean {
  return archiveSearch(a) === archiveSearch(b);
}

export function isFiltered(filter: GamesFilter): boolean {
  return archiveSearch(filter) !== "";
}

/** Filter dimensions in use (search, result, time control, moments): `filters_active` of the archive events. */
export function activeDimensions(filter: GamesFilter): number {
  return (filter.q ? 1 : 0) + (filter.result?.length ? 1 : 0) + (filter.tc?.length ? 1 : 0) + (filter.moments ? 1 : 0);
}

const RESULT_LABEL: Record<GameResultFilter, string> = { win: "Wins", loss: "Losses", draw: "Draws" };
const TC_LABEL: Record<GameTcFilter, string> = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapid", classical: "Classical" };

export function resultFilterLabel(r: GameResultFilter): string {
  return RESULT_LABEL[r];
}
export function tcFilterLabel(tc: GameTcFilter): string {
  return TC_LABEL[tc];
}

export type FilterChip = { id: string; label: string; without: GamesFilter };

/** The removable chips of the popover (search is not a chip: it has its own field). */
export function filterChips(filter: GamesFilter): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const r of filter.result ?? []) {
    const rest = (filter.result ?? []).filter((x) => x !== r);
    chips.push({ id: `result:${r}`, label: RESULT_LABEL[r], without: withList(filter, "result", rest) });
  }
  for (const tc of filter.tc ?? []) {
    const rest = (filter.tc ?? []).filter((x) => x !== tc);
    chips.push({ id: `tc:${tc}`, label: TC_LABEL[tc], without: withList(filter, "tc", rest) });
  }
  if (filter.moments) {
    const { moments: _drop, ...rest } = filter;
    void _drop;
    chips.push({ id: "moments", label: "With Moments", without: rest });
  }
  return chips;
}

/** The count on the Filter button: one per chip. */
export function activeFilterCount(filter: GamesFilter): number {
  return filterChips(filter).length;
}

function withList<K extends "result" | "tc">(filter: GamesFilter, key: K, list: NonNullable<GamesFilter[K]>): GamesFilter {
  const next: GamesFilter = { ...filter };
  if (list.length) (next[key] as GamesFilter[K]) = list;
  else delete next[key];
  return next;
}

/** The Result segment: "all" or one result (the Segmented control picks one; a URL may carry several). */
export type ResultSegment = "all" | GameResultFilter;

export function resultSegmentOf(filter: GamesFilter): ResultSegment {
  return filter.result?.length === 1 ? filter.result[0]! : "all";
}

export function withResultSegment(filter: GamesFilter, seg: ResultSegment): GamesFilter {
  return withList(filter, "result", seg === "all" ? [] : [seg]);
}

export function withTc(filter: GamesFilter, tc: readonly GameTcFilter[]): GamesFilter {
  return withList(filter, "tc", TC_FILTERS.filter((t) => tc.includes(t)));
}

export function withMoments(filter: GamesFilter, on: boolean): GamesFilter {
  const next: GamesFilter = { ...filter };
  if (on) next.moments = true;
  else delete next.moments;
  return next;
}

/** Search text → filter (1 character is ignored, as the server does). */
export function withSearch(filter: GamesFilter, text: string): GamesFilter {
  const next: GamesFilter = { ...filter };
  const q = text.trim();
  if (q.length >= SEARCH_MIN) next.q = q.slice(0, SEARCH_MAX);
  else delete next.q;
  return next;
}

/** Clear All in the popover keeps the search (it has its own Clear). */
export function clearedFilters(filter: GamesFilter): GamesFilter {
  return filter.q ? { q: filter.q } : {};
}
