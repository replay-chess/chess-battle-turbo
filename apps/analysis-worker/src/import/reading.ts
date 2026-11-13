// The reading phase of an import (phase-04 plan §8.6 "Reading phase", §8.7 steps 1–4, D4-18, D4-28). Reads the
// provider through the process gate (never two requests in flight to one provider), maps every game with the
// @repo/chess-import mappers and returns the candidates NEWEST FIRST, deduplicated and capped at IMPORT_MAX_GAMES:
//
// - Chess.com: profile (404 → not_found, closed → closed), archives with the stored validators (304 → the stored
//   months), the months to fetch (`monthsToFetch`: initial = the whole window, incremental = current + newer + the
//   previous month on the 1st/2nd + stored months that were not done), each month with its validators (304 =
//   unchanged since its games were saved), sorted by end time. A month is `done` unless it is the current one.
// - Lichess: anonymous NDJSON streams (§8.7 step 1): initial `since = window start, max = IMPORT_MAX_GAMES`;
//   incremental `since = lichessSinceMs + 1, max = 1000`, paged with `until` while a stream comes back full (FIX-1);
//   resume after an interrupted run `until = resume − 1` with the original `since`; every non-initial read ends with
//   a correspondence look-back over the window (FIX-1). Newest first by creation time; malformed lines are skipped and
//   counted.
//
// The newest chunk is handed out as soon as it is known (D4-28: `hooks.early`): Chess.com after the newest month that
// has games (later months are older), Lichess after 100 games. A provider error stops the reading and is returned
// with everything read so far (`error`), so the caller saves what it has (and, for Lichess, sets the resume point)
// before it fails the attempt. Mapping is CPU work (≈ 4 ms a game): the loop yields to the event loop every 50 games
// so heartbeats and the HTTP server stay responsive.
import { setImmediate as yieldTurn } from "node:timers/promises";
import { compareMonthKeys, type ChessComClient } from "@repo/chess-import/chesscom/client";
import { mapChessComGame } from "@repo/chess-import/chesscom/map";
import type { MonthKey } from "@repo/chess-import/chesscom/types";
import { isProviderError, type ProviderError } from "@repo/chess-import/errors";
import type { ExportQuery, LichessClient } from "@repo/chess-import/lichess/client";
import { mapLichessGame } from "@repo/chess-import/lichess/map";
import type { NdjsonStats } from "@repo/chess-import/lichess/ndjson";
import type { ImportedGame, MapResult, SkipReason } from "@repo/chess-import/types";
import { importWindowStart, monthKeyOf, monthsToFetch } from "@repo/chess-import/window";
import { mergeArchives, type ArchiveMonthV1, type ArchivesV1 } from "@repo/db/json";
import type { ImportAccount, ImportCursor } from "./context";
import { IMPORT_CHUNK } from "./batch-writer";

/** One Lichess incremental stream reads at most this many games; a full one pages on with `until` (FIX-1). */
export const LICHESS_INCREMENTAL_MAX = 1000;
/** Yield to the event loop every this many mapped games. */
export const READ_YIELD_EVERY = 50;

export interface ReadHooks {
  signal: AbortSignal;
  /** The newest candidates (≤ IMPORT_CHUNK), once, as soon as they are final (D4-28). */
  early(games: ImportedGame[]): Promise<void>;
  /** Called after each month / every 50 games with the games read so far. */
  progress(seen: number): Promise<void>;
}

export interface ReadResult {
  /** Newest first, unique external ids, inside the window, ≤ IMPORT_MAX_GAMES. */
  candidates: ImportedGame[];
  /** Provider games read (inside and outside the filters). */
  seen: number;
  skipped: number;
  skippedByReason: Partial<Record<SkipReason, number>>;
  variants: number;
  /** For each skipped game: how many candidates came before it (newer); the resume accounting (§8.7 step 4). */
  skipPositions: number[];
  /** Whether `hooks.early` was called. */
  earlyDone: boolean;
  /** What stopped the reading (everything above is what was read before it); null when it completed. */
  error: ProviderError | null;
  /** Provider requests this read sent, and how many of them answered 304 (`import_finished`, plan 10.1). */
  upstream: { requests: number; notModified: number };
  chesscom: {
    profile: { title: string | null; avatarUrl: string | null; playerId: string | null } | null;
    archivesEtag: string | null;
    archivesLastModified: string | null;
    /** The stored months with this read laid over them (only when the read completed). */
    archives: ArchivesV1 | null;
  } | null;
  lichess: {
    /** Creation time of the newest line read (the `since` of the next incremental sync). */
    newestCreatedMs: number | null;
    resumed: boolean;
  } | null;
}

export interface ReadInput {
  account: ImportAccount;
  cursor: ImportCursor | null;
  /** INITIAL runs read the whole window. */
  initial: boolean;
  nowMs: number;
  windowMonths: number;
  maxGames: number;
  /** Games this run already saved in earlier attempts (a resumed Lichess read asks only for the rest). */
  alreadyImported: number;
}

class Collector {
  readonly candidates: ImportedGame[] = [];
  readonly ids = new Set<string>();
  readonly skippedByReason: Partial<Record<SkipReason, number>> = {};
  readonly skipPositions: number[] = [];
  seen = 0;
  skipped = 0;
  variants = 0;
  private sinceYield = 0;

  constructor(
    private readonly windowStartMs: number,
    readonly maxGames: number,
  ) {}

  get full(): boolean {
    return this.candidates.length >= this.maxGames;
  }

  /** Maps one provider game; returns the game when it is a new candidate inside the window. */
  async take(r: MapResult, push = true): Promise<ImportedGame | null> {
    this.seen++;
    if (++this.sinceYield >= READ_YIELD_EVERY) {
      this.sinceYield = 0;
      await yieldTurn();
    }
    if (!r.ok) {
      this.skipped++;
      this.skippedByReason[r.reason] = (this.skippedByReason[r.reason] ?? 0) + 1;
      if (r.reason === "variant") this.variants++;
      this.skipPositions.push(this.candidates.length);
      return null;
    }
    if (r.game.endedAt.getTime() < this.windowStartMs || this.ids.has(r.game.externalId)) return null;
    this.ids.add(r.game.externalId);
    if (push && !this.full) this.candidates.push(r.game);
    return r.game;
  }

  readonly upstream = { requests: 0, notModified: 0 };

  result(extra: Pick<ReadResult, "earlyDone" | "error" | "chesscom" | "lichess">): ReadResult {
    return {
      upstream: { ...this.upstream },
      candidates: this.candidates.slice(0, this.maxGames),
      seen: this.seen,
      skipped: this.skipped,
      skippedByReason: this.skippedByReason,
      variants: this.variants,
      skipPositions: this.skipPositions,
      ...extra,
    };
  }
}

const byNewest = (a: ImportedGame, b: ImportedGame) =>
  b.endedAt.getTime() - a.endedAt.getTime() || (a.externalId < b.externalId ? 1 : a.externalId > b.externalId ? -1 : 0);

/**
 * A provider failure stops the reading and is returned with what was read; anything else (the job's abort, a
 * database error or a lost lock from the early chunk, a bug) propagates unchanged.
 */
function providerFailure(e: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted || !isProviderError(e) || e.kind === "aborted") throw e;
  return e;
}

/** Chess.com (§8.6). */
export async function readChessCom(client: ChessComClient, input: ReadInput, hooks: ReadHooks): Promise<ReadResult> {
  const windowStart = importWindowStart(input.nowMs, input.windowMonths);
  const c = new Collector(windowStart, input.maxGames);
  const stored = input.cursor?.archives ?? { v: 1 as const, months: {} };
  const current = monthKeyOf(input.nowMs);
  const out: NonNullable<ReadResult["chesscom"]> = {
    profile: null,
    archivesEtag: null,
    archivesLastModified: null,
    archives: null,
  };
  let earlyDone = false;
  const opts = { signal: hooks.signal };
  try {
    c.upstream.requests++;
    const profile = await client.getProfile(input.account.usernameLower, opts);
    out.profile = {
      title: profile.title ?? null,
      avatarUrl: profile.avatar && profile.avatar.length <= 300 ? profile.avatar : null,
      playerId: profile.player_id !== undefined ? String(profile.player_id) : null,
    };
    c.upstream.requests++;
    const archives = await client.getArchives(input.account.usernameLower, {
      ...opts,
      validators: { etag: input.cursor?.archivesEtag, lastModified: input.cursor?.archivesLastModified },
    });
    if (archives.status === 304) c.upstream.notModified++;
    const listed: MonthKey[] =
      archives.status === 200 ? archives.months : (Object.keys(stored.months) as MonthKey[]).sort(compareMonthKeys);
    out.archivesEtag = archives.etag ?? input.cursor?.archivesEtag ?? null;
    out.archivesLastModified = archives.lastModified ?? input.cursor?.archivesLastModified ?? null;
    const plan = monthsToFetch({
      nowMs: input.nowMs,
      archiveMonths: listed,
      stored: stored.months,
      initial: input.initial,
      windowMonths: input.windowMonths,
    });
    const months: Record<string, ArchiveMonthV1> = {};
    for (const key of plan) {
      if (c.full) break;
      const prior = stored.months[key];
      c.upstream.requests++;
      const res = await client.getMonth(input.account.usernameLower, key, {
        ...opts,
        validators: prior ? { etag: prior.etag, lastModified: prior.lastModified } : undefined,
      });
      if (res.status === 304) {
        c.upstream.notModified++;
        continue;
      }
      const before = { candidates: c.candidates.length, skipped: c.skipped };
      const mapped: ImportedGame[] = [];
      for (const raw of res.games) {
        const g = await c.take(
          mapChessComGame(raw, { usernameLower: input.account.usernameLower, memberTitle: out.profile.title }),
          false,
        );
        if (g) mapped.push(g);
      }
      mapped.sort(byNewest);
      for (const g of mapped) if (!c.full) c.candidates.push(g);
      // Skips of this month sit after the month's candidates in the newest-first order.
      for (let i = before.skipped; i < c.skipped; i++) c.skipPositions[i] = c.candidates.length;
      months[key] = {
        ...(res.etag ? { etag: res.etag.slice(0, 120) } : {}),
        ...(res.lastModified ? { lastModified: res.lastModified.slice(0, 40) } : {}),
        done: key !== current,
        games: c.candidates.length - before.candidates,
        skipped: c.skipped - before.skipped,
      };
      await hooks.progress(c.seen);
      if (!earlyDone && c.candidates.length > 0) {
        earlyDone = true;
        await hooks.early(c.candidates.slice(0, IMPORT_CHUNK));
      }
    }
    out.archives = mergeArchives(stored, { months });
    return c.result({ earlyDone, error: null, chesscom: out, lichess: null });
  } catch (e) {
    return c.result({ earlyDone, error: providerFailure(e, hooks.signal), chesscom: out, lichess: null });
  }
}

/** The Lichess export query of this attempt (§8.7 step 1, D4-12). */
export function lichessQuery(input: ReadInput): { since: number; until?: number; max: number; resumed: boolean } {
  const windowStart = importWindowStart(input.nowMs, input.windowMonths);
  const since =
    input.cursor?.lichessSinceMs !== null && input.cursor?.lichessSinceMs !== undefined && !input.initial
      ? Math.max(windowStart, input.cursor.lichessSinceMs + 1)
      : windowStart;
  const resumeUntil = input.cursor?.lichessResumeUntilMs ?? null;
  if (resumeUntil !== null) {
    return {
      since,
      until: resumeUntil - 1,
      max: Math.max(1, input.maxGames - input.alreadyImported),
      resumed: true,
    };
  }
  const incremental = !input.initial && input.cursor?.lichessSinceMs != null;
  return { since, max: incremental ? Math.min(LICHESS_INCREMENTAL_MAX, input.maxGames) : input.maxGames, resumed: false };
}

/**
 * Lichess (§8.7), FIX-1 corrections of step 1 and step 4:
 *
 * - Paging. The export is newest first, so `max = 1000` on an incremental sync returned the NEWEST 1000 and the run's
 *   cursor then jumped past the older ones for good ("the rest arrives the next day" never happened). A stream that
 *   comes back full now continues in the same read with `until = oldest createdAt − 1` (same `since`) until a stream
 *   comes back short, up to IMPORT_MAX_GAMES for the run (the same "newest N games" rule as an initial import). An
 *   interruption between pages resumes through the existing resume point (each saved chunk records its oldest
 *   creation time), so nothing is skipped either way.
 * - Correspondence. `since` filters on creation time and the export holds finished games only, so a correspondence
 *   game still running at a sync was never requested once the cursor passed its creation time. Every non-initial read
 *   ends with one correspondence look-back stream over the whole import window (`perfType=correspondence`); the
 *   known-game filter drops what is already saved. Its games are appended after the main stream's (newest first
 *   within it), so a chunk's oldest creation time still only ever covers saved main-stream games.
 */
export async function readLichess(client: LichessClient, input: ReadInput, hooks: ReadHooks): Promise<ReadResult> {
  const windowStart = importWindowStart(input.nowMs, input.windowMonths);
  const q = lichessQuery(input);
  const incremental = !q.resumed && !input.initial && input.cursor?.lichessSinceMs != null;
  // An incremental read pages through LICHESS_INCREMENTAL_MAX streams up to the run's cap; the others are one stream.
  const capacity = incremental ? Math.max(1, input.maxGames - input.alreadyImported) : q.max;
  const c = new Collector(windowStart, capacity);
  const stats: NdjsonStats = { lines: 0, invalid: 0 };
  const lichess = { newestCreatedMs: null as number | null, resumed: q.resumed };
  let earlyDone = false;
  let invalidCounted = 0;
  const countInvalid = () => {
    for (; invalidCounted < stats.invalid; invalidCounted++) {
      c.seen++;
      c.skipped++;
      c.skippedByReason.parse_error = (c.skippedByReason.parse_error ?? 0) + 1;
      c.skipPositions.push(c.candidates.length);
    }
  };
  /** One export stream; returns how many lines it delivered and the oldest creation time among them. */
  const stream = async (query: ExportQuery, main: boolean): Promise<{ lines: number; oldestMs: number | null }> => {
    const before = stats.lines;
    let oldestMs: number | null = null;
    c.upstream.requests++;
    const games = client.streamGames(input.account.usernameLower, query, { signal: hooks.signal, stats });
    for await (const raw of games) {
      countInvalid();
      const createdAt = (raw as { createdAt?: unknown } | null)?.createdAt;
      if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
        if (main && lichess.newestCreatedMs === null) lichess.newestCreatedMs = createdAt;
        oldestMs = oldestMs === null ? createdAt : Math.min(oldestMs, createdAt);
      }
      await c.take(mapLichessGame(raw, { userId: input.account.usernameLower }));
      if (!earlyDone && c.candidates.length >= IMPORT_CHUNK) {
        earlyDone = true;
        await hooks.early(c.candidates.slice(0, IMPORT_CHUNK));
      }
      if (c.seen % READ_YIELD_EVERY === 0) await hooks.progress(c.seen);
      if (c.full) break;
    }
    countInvalid();
    return { lines: stats.lines - before, oldestMs };
  };
  try {
    let page: ExportQuery = { since: q.since, ...(q.until !== undefined ? { until: q.until } : {}), max: q.max };
    for (;;) {
      const got = await stream(page, true);
      const pageMax = page.max ?? 0;
      if (!incremental || c.full || got.lines < pageMax || got.oldestMs === null) break;
      const until = got.oldestMs - 1;
      const max = Math.min(LICHESS_INCREMENTAL_MAX, capacity - c.candidates.length);
      if (until < q.since || max <= 0 || (page.until !== undefined && until >= page.until)) break;
      page = { since: q.since, until, max };
    }
    if (!input.initial && !c.full) {
      await stream({ since: windowStart, max: capacity - c.candidates.length, perfType: "correspondence" }, false);
    }
    await hooks.progress(c.seen);
    return c.result({ earlyDone, error: null, chesscom: null, lichess });
  } catch (e) {
    countInvalid();
    return c.result({ earlyDone, error: providerFailure(e, hooks.signal), chesscom: null, lichess });
  }
}

/** Skipped games that sit before candidate `k` in the newest-first order (they are covered once 0..k−1 are saved). */
export function skippedBefore(read: Pick<ReadResult, "skipPositions">, k: number): number {
  let n = 0;
  for (const p of read.skipPositions) if (p < k) n++;
  return n;
}
