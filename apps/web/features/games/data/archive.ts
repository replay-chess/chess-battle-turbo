// /games data (phase-03 plan §5.1, §5.10): G1 `GET /api/me/games` as one infinite query per filter plus the
// popover's `limit=0` count. Keys come from `qk` only; the RSC page seeds page 1 under the same key (archiveListKey).
//
//   qk.games.list(f)   infinite, 30 per page, maxPages 10, staleTime 60 s, focus refetch, keepPreviousData on a new f
//   counts(f)          G1 limit=0 → meta.filteredTotal ("Show N Games"), staleTime 60 s
//
// Responses are parsed only in dev and test builds (the literal NODE_ENV check keeps zod out of production chunks,
// lib/api/schema.ts).
import { infiniteQueryOptions, keepPreviousData, queryOptions, type InfiniteData } from "@tanstack/react-query";
import { GamesListResponse, type GamesPageMeta } from "@repo/contracts/http/games";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { norm, qk } from "@/lib/api/keys";
import { g1Search, keyFilter, PAGE_LIMIT, type GamesFilter } from "../model/filter";
import type { GameRowDTO } from "../model/rows";

export const ARCHIVE_STALE_MS = 60_000;
/** At most this many pages stay in the cache per filter (plan §5.10). */
export const ARCHIVE_MAX_PAGES = 10;

export type ArchivePage = { rows: GameRowDTO[]; meta: GamesPageMeta };
export type ArchiveData = InfiniteData<ArchivePage>;

export function archiveListKey(filter: GamesFilter) {
  return qk.games.list(keyFilter(filter));
}

/** The popover's live count: one key per draft filter under `["games", "counts"]`. */
export function archiveCountsKey(filter: GamesFilter) {
  return [...qk.games.counts(), norm(keyFilter(filter))] as const;
}

/** G1's meta, narrowed (page 1 and limit=0 carry filteredTotal and counts; later pages only nextCursor). */
export function readPageMeta(meta: unknown): GamesPageMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  const out: GamesPageMeta = { nextCursor: typeof m.nextCursor === "string" ? m.nextCursor : null };
  if (typeof m.filteredTotal === "number") out.filteredTotal = m.filteredTotal;
  const counts = m.counts as { all?: unknown } | undefined;
  if (counts && typeof counts.all === "number") out.counts = { all: counts.all };
  return out;
}

export async function fetchArchivePage(
  filter: GamesFilter,
  cursor: string | null,
  signal?: AbortSignal,
  limit: number = PAGE_LIMIT,
): Promise<ArchivePage> {
  const schema = process.env.NODE_ENV === "production" ? undefined : GamesListResponse;
  const { data, meta } = await api(`${endpoints.meGames}?${g1Search(filter, cursor, limit)}`, { schema, signal });
  return { rows: data as GameRowDTO[], meta: readPageMeta(meta) };
}

export function archiveListQuery(filter: GamesFilter) {
  return infiniteQueryOptions({
    queryKey: archiveListKey(filter),
    queryFn: ({ pageParam, signal }) => fetchArchivePage(filter, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ArchivePage) => last.meta.nextCursor ?? undefined,
    maxPages: ARCHIVE_MAX_PAGES,
    staleTime: ARCHIVE_STALE_MS,
    placeholderData: keepPreviousData,
    meta: { object: "your games" },
  });
}

export function archiveCountsQuery(filter: GamesFilter) {
  return queryOptions({
    queryKey: archiveCountsKey(filter),
    queryFn: async ({ signal }) => (await fetchArchivePage(filter, null, signal, 0)).meta.filteredTotal ?? 0,
    staleTime: ARCHIVE_STALE_MS,
    placeholderData: keepPreviousData,
    meta: { object: "the game count" },
  });
}

/** Every row the cache holds for a filter, in order (the pages are keyset slices). */
export function rowsOf(data: ArchiveData | undefined): GameRowDTO[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.rows);
}

/** Page 1's totals (only page 1 carries them). */
export function totalsOf(data: ArchiveData | undefined): { all: number | null; filtered: number | null } {
  const first = data?.pages[0];
  return { all: first?.meta.counts?.all ?? null, filtered: first?.meta.filteredTotal ?? null };
}

/** Applies a row patch to every cached archive list (analysis:progress / analysis:done, plan §5.1). */
export function patchArchivePages(data: ArchiveData | undefined, ref: string, patch: (row: GameRowDTO) => GameRowDTO): ArchiveData | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const rows = page.rows.map((row) => {
      if (row.ref !== ref) return row;
      const next = patch(row);
      if (next !== row) pageChanged = true;
      return next;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, rows };
  });
  return changed ? { ...data, pages } : data;
}
