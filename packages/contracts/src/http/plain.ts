// The zod-free half of the P3 HTTP contracts (phase-03 plan §5, §7.1; AP-12): constants, path builders and the
// /games filter parser that both the server and the client chunks need. The schema modules (review.ts, games.ts,
// legend.ts, practice.ts, share.ts, ../internal/jobs.ts) re-export these, so server code keeps importing them from
// there; client components import `@repo/contracts/http/plain` directly, because the schema modules build zod
// schemas at load time and would ship zod into the route's first load. This module must never import anything
// (plain.test.ts scans its source), so it stays free of zod by construction.

// ── Review (A1/A2 live timing, moments) ──────────────────────────────────────────────────────────────────────────
/** A RUNNING job whose heartbeat is older than this reads as `failed worker_stalled`, retryable (§5.2). */
export const WORKER_STALL_HEARTBEAT_MS = 90_000;
/** No analysis event for this long while live → one A2 read (the stall check, §5.2). */
export const REVIEW_STALL_SILENCE_MS = 45_000;
/** The A2 fallback poll while the socket is down (the last step repeats). */
export const REVIEW_FALLBACK_SCHEDULE_MS = [2_000, 4_000, 8_000, 15_000] as const;
/** The fallback poll stops this long after it started. */
export const REVIEW_FALLBACK_STOP_AFTER_MS = 180_000;
/** Key moments per review (P3-D14). */
export const MAX_MOMENTS = 3;
/** Games shorter than this many plies are not analysed (`skipped`). */
export const ANALYSIS_MIN_PLIES = 6;
/** A5: events per progress batch (the client's debounced batch cap and the body schema's limit). */
export const PROGRESS_EVENTS_MAX = 50;

// ── Worker checkpoints (P3-D6, §8.12 step 5, §9.1) ────────────────────────────────────────────────────────────────
/** A checkpoint every 10 graded plies (P3-D6) … */
export const CHECKPOINT_MIN_PLIES = 10;
/** … spread out on long games so one game writes at most this many (the §9.1 budget: ≤ 10 statements a game) … */
export const MAX_CHECKPOINTS = 6;
/** … but never further apart than this (a game over 280 plies writes more than 6, so a failure loses ≤ 40 plies). */
export const CHECKPOINT_MAX_PLIES = 40;

/** Plies between two checkpoints of a game of `totalPlies` plies (checkpoints at its multiples below the end). */
export function checkpointSpacing(totalPlies: number): number {
  return Math.min(CHECKPOINT_MAX_PLIES, Math.max(CHECKPOINT_MIN_PLIES, Math.ceil(totalPlies / (MAX_CHECKPOINTS + 1))));
}

/** Whether the worker checkpoints when `graded` plies of a `totalPlies`-ply game are graded. */
export function isCheckpointPly(graded: number, totalPlies: number): boolean {
  return graded > 0 && graded < totalPlies && graded % checkpointSpacing(totalPlies) === 0;
}

/**
 * The first checkpoint after `graded` plies, or null when none comes before the end (the final write follows). A
 * live client whose cached plies end at `graded` can only gain from re-reading A1 once a progress frame reports
 * this many graded plies: the worker writes a checkpoint before it moves on, so it has committed by then.
 */
export function nextCheckpointAfter(graded: number, totalPlies: number): number | null {
  const s = checkpointSpacing(totalPlies);
  const next = (Math.floor(Math.max(0, graded) / s) + 1) * s;
  return next < totalPlies ? next : null;
}

/** `replaychess-<white>-vs-<black>-<yyyy-mm-dd>.pgn` with names reduced to [a-z0-9_-] (A8 and the client download). */
export function annotatedPgnFilename(white: string, black: string, playedAt: Date): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "player";
  return `replaychess-${slug(white)}-vs-${slug(black)}-${playedAt.toISOString().slice(0, 10)}.pgn`;
}

/**
 * Where an in-app link to the review comes from: `review_opened.source` (plan §10.1). Links carry it as `?from=`
 * because `document.referrer` does not change on a client-side navigation.
 */
export type ReviewLinkSource = "game_over" | "archive" | "home";

/** The review page path; `reviewHref()` in WEB/lib/routes.ts decides between it and the legacy `/analysis` route. */
export function reviewPath(
  ref: string,
  options: { moment?: number; ply?: number; tab?: "coach" | "moves"; from?: ReviewLinkSource } = {},
): string {
  const q = new URLSearchParams();
  if (options.from) q.set("from", options.from);
  if (options.tab) q.set("tab", options.tab);
  if (options.ply !== undefined) q.set("ply", String(options.ply));
  if (options.moment !== undefined) q.set("m", String(options.moment));
  const qs = q.toString();
  return `/review/${encodeURIComponent(ref)}${qs ? `?${qs}` : ""}`;
}

// ── Compare with the legend (A9, A9b) ────────────────────────────────────────────────────────────────────────────
/** A9b answers 410 `gone` after this many compute attempts. */
export const LEGEND_COMPUTE_MAX_ATTEMPTS = 3;

/** `/review/<ref>/legend`, optionally on a tab and a ply. */
export function legendComparePath(
  ref: string,
  options: { tab?: "explanation" | "your_moves" | "legend_moves" | "practice"; ply?: number } = {},
): string {
  const q = new URLSearchParams();
  if (options.tab) q.set("tab", options.tab);
  if (options.ply !== undefined) q.set("ply", String(options.ply));
  const qs = q.toString();
  return `/review/${encodeURIComponent(ref)}/legend${qs ? `?${qs}` : ""}`;
}

// ── Practice (PR1) ───────────────────────────────────────────────────────────────────────────────────────────────
/** `/practice?game=<ref>&ply=<n>` (the game-over Replay and the compare page's Practice from Here). */
export function practiceFromGamePath(ref: string, ply: number): string {
  return `/practice?game=${encodeURIComponent(ref)}&ply=${ply}`;
}

export function practiceFromPositionPath(positionRef: string): string {
  return `/practice?position=${encodeURIComponent(positionRef)}`;
}

export function practiceFromFenPath(fen: string): string {
  return `/practice?fen=${encodeURIComponent(fen)}`;
}

// ── G1 `/api/me/games` and the `/games` URL state (§5.10) ───────────────────────────────────────────────────────
export const GAMES_PAGE_LIMIT = 30;
export const GAMES_SEARCH_MAX = 40;
/** Search runs only for an empty query or one of at least this many characters (§5.10). */
export const GAMES_SEARCH_MIN = 2;
export const GAME_RESULT_FILTERS = ["win", "loss", "draw"] as const;
/** Time-control filter chips. Untimed games appear only unfiltered. */
export const GAME_TC_FILTERS = ["bullet", "blitz", "rapid", "classical"] as const;

/** The normalised filter (`qk.games.list(f)`, the DAL). `src` is reserved for P4. Empty lists are dropped. */
export type GamesFilter = {
  q?: string;
  result?: (typeof GAME_RESULT_FILTERS)[number][];
  tc?: (typeof GAME_TC_FILTERS)[number][];
  moments?: boolean;
};

function csvOf<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const seen = new Set<string>();
  for (const part of raw.split(",")) seen.add(part.trim().toLowerCase());
  // Canonical order, so `draw,win` and `win,draw` are one cache key.
  const out = allowed.filter((a) => seen.has(a));
  return out.length ? out : undefined;
}

/** Parses the URL/wire filter: unknown csv values are dropped, a 1-character search is ignored (§5.10). */
export function gamesFilterOf(query: { q?: string; result?: string; tc?: string; moments?: boolean }): GamesFilter {
  const filter: GamesFilter = {};
  const q = query.q?.trim();
  if (q && q.length >= GAMES_SEARCH_MIN) filter.q = q.slice(0, GAMES_SEARCH_MAX);
  const result = csvOf(query.result, GAME_RESULT_FILTERS);
  if (result) filter.result = result;
  const tc = csvOf(query.tc, GAME_TC_FILTERS);
  if (tc) filter.tc = tc;
  if (query.moments === true) filter.moments = true;
  return filter;
}

/** The URL query of a filter (the inverse of gamesFilterOf for the `/games` URL state). */
export function gamesFilterToSearch(filter: GamesFilter): string {
  const q = new URLSearchParams();
  if (filter.q) q.set("q", filter.q);
  if (filter.result?.length) q.set("result", filter.result.join(","));
  if (filter.tc?.length) q.set("tc", filter.tc.join(","));
  if (filter.moments) q.set("moments", "1");
  return q.toString();
}
