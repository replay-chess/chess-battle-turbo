// Train queries (phase-05 plan §5.1): R1 today, R2 bank (infinite), R3 session and summary, R4 themes. Keys only from
// `qk.train`; responses through api() with the schema check written at the call site (`NODE_ENV === "production" ?
// undefined : Schema`), so zod stays out of the production chunks (AP-12). Every page seeds its query from the RSC
// (the DAL in lib/train/*.server.ts returns the same shapes), so the first paint makes no /api request.
//
//   qk.train.today()          30 s, 0 once the local day changed (useLocalDayKey), focus refetch
//   qk.train.bank(f)          infinite, 60 s, focus refetch, keepPreviousData on a new filter, ≤ 10 pages
//   qk.train.session(ref)     Infinity (items are immutable; outbox results patch them locally), no focus refetch
//   qk.train.summary(ref)     0 (the summary page refetches it while "Saving…", at most 5 times)
//   qk.train.themes()         10 min (embedded in a puzzle session payload; fetched on picker open otherwise)
import { infiniteQueryOptions, keepPreviousData, queryOptions, type InfiniteData } from "@tanstack/react-query";
import type { BankNextPage, BankPage, SessionPayload, SessionSummary, ThemesResult, TrainToday } from "@repo/contracts/http/train";
import {
  BankNextPage as BankNextPageSchema,
  BankPage as BankPageSchema,
  SessionPayload as SessionPayloadSchema,
  SessionSummary as SessionSummarySchema,
  ThemesResult as ThemesResultSchema,
  TrainToday as TrainTodaySchema,
} from "@repo/contracts/http/train";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk, type BankFilter } from "../keys";

/**
 * R2's page size (= `BANK_PAGE_ROWS` of @repo/contracts/http/train, asserted in train.test.ts). A copy, not an import:
 * any value import from the contract module keeps that module, and with it zod, in every route that imports these
 * queries (check-bundle-budgets: "zod in client chunks"; only the NODE_ENV-guarded schema imports are dropped).
 */
export const BANK_PAGE_ROWS = 50;
export const TODAY_STALE_MS = 30_000;
export const BANK_STALE_MS = 60_000;
export const THEMES_STALE_MS = 10 * 60_000;
/** At most this many bank pages stay in the cache per filter (§5.2 S3, large banks only). */
export const BANK_MAX_PAGES = 10;

/** `"/api/train/sessions/{ref}"` → one session's path (refs are cuids; encoded anyway). */
export function trainSessionPath(path: string, ref: string): string {
  return path.replace("{ref}", encodeURIComponent(ref));
}

// ── R1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchTrainToday(signal?: AbortSignal): Promise<TrainToday> {
  const schema = process.env.NODE_ENV === "production" ? undefined : TrainTodaySchema;
  const { data } = await api(endpoints.trainToday, { schema, signal });
  return data as TrainToday;
}

/**
 * Fresh for 30 s, unless the member's local training day moved on (the hub passes `currentDayKey` from
 * useLocalDayKey(timeZone, dayStartHour)): then stale at once, so the next render refetches today's plan.
 */
export function todayStaleTime(data: TrainToday | undefined, currentDayKey?: string): number {
  if (data && currentDayKey && data.dayKey !== currentDayKey) return 0;
  return TODAY_STALE_MS;
}

export function trainTodayQuery(currentDayKey?: string) {
  return queryOptions({
    queryKey: qk.train.today(),
    queryFn: ({ signal }): Promise<TrainToday> => fetchTrainToday(signal),
    staleTime: (query) => todayStaleTime(query.state.data as TrainToday | undefined, currentDayKey),
    refetchOnWindowFocus: true,
    meta: { object: "today's training" },
  });
}

// ── R2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One page of the bank as the cache holds it: page 1 is the full `BankPage` (counts, facets, upcoming), later pages
 * `BankNextPage` (rows only). `complete` = page 1 carries every row of the bank (≤ 300), so filters run on the client.
 * The RSC seed (`listBank(viewer, f, null, now)` in lib/train/bank.server.ts) returns exactly this shape.
 */
export type BankListPage =
  | { data: BankPage; meta: { nextCursor: string | null; complete: boolean } }
  | { data: BankNextPage; meta: { nextCursor: string | null; complete: false } };
export type BankListData = InfiniteData<BankListPage, string | null>;

/** R2's query string for a filter and cursor (empty values dropped). */
export function bankSearch(f: BankFilter, cursor: string | null, limit: number = BANK_PAGE_ROWS): Record<string, string | number | undefined> {
  return {
    view: f.view,
    theme: f.theme || undefined,
    phase: f.phase,
    source: f.source,
    cursor: cursor ?? undefined,
    limit,
  };
}

/** R2's envelope meta, narrowed (only page 1 carries `complete`). */
export function readBankMeta(meta: unknown, firstPage: boolean): { nextCursor: string | null; complete: boolean } {
  const m = (meta ?? {}) as Record<string, unknown>;
  return {
    nextCursor: typeof m.nextCursor === "string" ? m.nextCursor : null,
    complete: firstPage && m.complete === true,
  };
}

export async function fetchBankPage(f: BankFilter, cursor: string | null, signal?: AbortSignal): Promise<BankListPage> {
  if (cursor === null) {
    const schema = process.env.NODE_ENV === "production" ? undefined : BankPageSchema;
    const { data, meta } = await api(endpoints.trainBank, { schema, signal, query: bankSearch(f, null) });
    return { data: data as BankPage, meta: readBankMeta(meta, true) };
  }
  const schema = process.env.NODE_ENV === "production" ? undefined : BankNextPageSchema;
  const { data, meta } = await api(endpoints.trainBank, { schema, signal, query: bankSearch(f, cursor) });
  return { data: data as BankNextPage, meta: { nextCursor: readBankMeta(meta, false).nextCursor, complete: false } };
}

export function bankQuery(f: BankFilter) {
  return infiniteQueryOptions({
    queryKey: qk.train.bank(f),
    queryFn: ({ pageParam, signal }) => fetchBankPage(f, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: BankListPage) => last.meta.nextCursor ?? undefined,
    maxPages: BANK_MAX_PAGES,
    staleTime: BANK_STALE_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    meta: { object: "your Mistake Bank" },
  });
}

/** Page 1 (counts, facets, upcoming, nextBatch) of the cached bank, if loaded. */
export function firstBankPage(data: BankListData | undefined): BankPage | null {
  const first = data?.pages[0];
  return first && "state" in first.data ? first.data : null;
}

/** Every row the cache holds for a filter, in order (the pages are keyset slices). */
export function bankRowsOf(data: BankListData | undefined): BankPage["rows"] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.data.rows);
}

// ── R3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchTrainSession(ref: string, signal?: AbortSignal): Promise<SessionPayload> {
  const schema = process.env.NODE_ENV === "production" ? undefined : SessionPayloadSchema;
  const { data } = await api(trainSessionPath(endpoints.trainSession, ref), { schema, signal, query: { include: "items" } });
  return data as SessionPayload;
}

export async function fetchSessionSummary(ref: string, signal?: AbortSignal): Promise<SessionSummary> {
  const schema = process.env.NODE_ENV === "production" ? undefined : SessionSummarySchema;
  const { data } = await api(trainSessionPath(endpoints.trainSession, ref), { schema, signal, query: { include: "summary" } });
  return data as SessionSummary;
}

/** The runner's payload: seeded with setQueryData from the RSC (or W2); never refetched on its own. */
export function trainSessionQuery(ref: string) {
  return queryOptions({
    queryKey: qk.train.session(ref),
    queryFn: ({ signal }): Promise<SessionPayload> => fetchTrainSession(ref, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    meta: { object: "the training session" },
  });
}

/** The summary: seeded by the RSC; refetched by the page only while the server holds fewer attempts than `?n=`. */
export function sessionSummaryQuery(ref: string) {
  return queryOptions({
    queryKey: qk.train.summary(ref),
    queryFn: ({ signal }): Promise<SessionSummary> => fetchSessionSummary(ref, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
    meta: { object: "the session summary" },
  });
}

// ── R4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchThemes(signal?: AbortSignal): Promise<ThemesResult> {
  const schema = process.env.NODE_ENV === "production" ? undefined : ThemesResultSchema;
  const { data } = await api(endpoints.trainThemes, { schema, signal });
  return data as ThemesResult;
}

export function themesQuery() {
  return queryOptions({
    queryKey: qk.train.themes(),
    queryFn: ({ signal }): Promise<ThemesResult> => fetchThemes(signal),
    staleTime: THEMES_STALE_MS,
    refetchOnWindowFocus: false,
    meta: { object: "the puzzle themes" },
  });
}
