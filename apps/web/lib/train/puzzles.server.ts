// Puzzle shard loader (phase-05 plan §9.3) and the shard side of puzzle selection (§7.3 W2 "PUZZLES / DAILY puzzle
// part", §8.6, §8.13).
//
//   getShard(theme, band)     module LRU (50 shards) → Next data cache (`fetch(…, { cache: "force-cache" })`, keyed by
//                             the versioned URL) → the shard server (R2 in dev/prod, the CI shard server on :4012 in
//                             tests). Concurrent misses of one shard share one request. A failure is retried once after
//                             200 ms, then answers 502 `upstream_unavailable {provider: "puzzles"}`. A band the
//                             committed manifest does not list is an empty shard without a request.
//   selectPuzzleBatch(input)  runs `@repo/chess-training/session` selectPuzzles (WP-B: window [R − 100, R + 150],
//                             ±100 widening, the `mix` fallback, ≤ 30 % due cards every third slot, seeded pick, rating
//                             ascending) over these shards, and feeds its exclusion set from the caller's 90-day query
//                             (`training_attempts_puzzle_idx`, ≤ 500 ids per query): the step-0 shards are fetched in
//                             parallel and their ids asked about in one round, a widening band when it loads.
//   availableNear(theme, R)   ThemeOption.available from the committed manifest (no fetch).
//
// Shards are immutable for the life of a version path (opt §4.5), which is what makes the module-scope LRU safe.
// PUZZLE_SHARD_BASE_URL is the public base + "/puzzles" (unset → mediaUrl("/puzzles")); PUZZLES_VERSION must equal the
// committed manifest's version. Tests never reach R2: they set the base URL to the CI shard server.
import { LRUCache } from "lru-cache";
import { PUZZLE_EXCLUDE_DAYS, PUZZLE_MAX_WIDEN_STEPS } from "@repo/chess-training/constants";
import manifestJson from "@repo/chess-training/puzzles/manifest.v1.json";
import {
  bandsInWindow,
  puzzleWindow,
  selectPuzzles,
  type PuzzlePick,
  type SelectPuzzlesInput,
} from "@repo/chess-training/session";
import { primaryTheme } from "@repo/chess-training/themes";
import type { PuzzleSnapshotV1 } from "@repo/db/json";
import { ApiError } from "@/lib/api/api-error";
import { getRouteDeps, type Telemetry } from "@/lib/api/context";
import { mediaUrl } from "@/lib/media";
import {
  manifestBands,
  manifestCount,
  MIX_THEME,
  PuzzleManifestSchema,
  ShardFileSchema,
  shardPath,
  themesOfMask,
  type PuzzleManifest,
  type ShardTuple,
} from "./puzzle-shards";

export { MIX_THEME, solverColor, type PuzzleManifest, type ShardTuple } from "./puzzle-shards";
export { PUZZLE_EXCLUDE_DAYS, PUZZLE_MAX_WIDEN_STEPS };
export type { PuzzlePick };

type Env = Readonly<Record<string, string | undefined>>;

/** Module LRU size (≈ 1.6 MB parsed at 250 tuples per shard, plan §9.2). */
export const SHARD_LRU_MAX = 50;
export const SHARD_FETCH_TIMEOUT_MS = 2500;
export const SHARD_RETRY_DELAY_MS = 200;
/** Ids per exclusion query (`training_attempts_puzzle_idx` with `= ANY($ids)`, §9.1). */
export const PUZZLE_EXCLUSION_MAX_IDS = 500;

/** One shard puzzle as a typed object (materialised only for the picked ones). */
export type ShardPuzzle = {
  id: string;
  /** Lichess FEN: the position before the opponent's setup move. */
  fen: string;
  /** "setup best reply …" in UCI (the first token is the opponent's setup move). */
  moves: string;
  rating: number;
  /** Lichess theme keys whose bit is set, in bit order. */
  themes: string[];
};

export type Shard = {
  version: string;
  theme: string;
  band: number;
  /** Rating-ascending tuples, validated once when fetched. */
  tuples: readonly ShardTuple[];
};

export type ShardConfig = { baseUrl: string; version: string };

export type ShardDeps = {
  fetch: typeof fetch;
  env: Env;
  telemetry: Pick<Telemetry, "startSpan" | "distribution" | "count" | "captureMessage">;
  sleep(ms: number): Promise<void>;
  perf(): number;
  manifest: PuzzleManifest;
  timeoutMs: number;
};

let parsedManifest: PuzzleManifest | null = null;

/** The committed manifest (`@repo/chess-training/puzzles/manifest.v1.json`), validated once. */
export function committedManifest(): PuzzleManifest {
  parsedManifest ??= PuzzleManifestSchema.parse(manifestJson);
  return parsedManifest;
}

function defaultDeps(): ShardDeps {
  const route = getRouteDeps();
  return {
    fetch: globalThis.fetch,
    env: route.env,
    telemetry: route.telemetry,
    sleep: route.sleep,
    perf: route.perf,
    manifest: committedManifest(),
    timeoutMs: SHARD_FETCH_TIMEOUT_MS,
  };
}

function depsOf(overrides?: Partial<ShardDeps>): ShardDeps {
  return overrides ? { ...defaultDeps(), ...overrides } : defaultDeps();
}

/** `PUZZLES_ENABLED=off` is the kill switch (interface check §0.15; `lib/test-hooks/registry.ts` KILL_SWITCHES). */
export function puzzlesEnabled(env: Env = getRouteDeps().env): boolean {
  return env.PUZZLES_ENABLED !== "off";
}

/** Base URL and version; the version must equal the manifest's (the counts and bits describe that version only). */
export function shardConfig(env: Env, manifest: PuzzleManifest): ShardConfig {
  const baseUrl = (env.PUZZLE_SHARD_BASE_URL || mediaUrl("/puzzles")).replace(/\/+$/, "");
  const version = env.PUZZLES_VERSION || manifest.version;
  if (version !== manifest.version) {
    throw new ApiError("not_configured", {
      details: { provider: "puzzles", reason: "version_mismatch" },
      cause: new Error(`PUZZLES_VERSION ${version} ≠ committed manifest ${manifest.version}`),
    });
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new ApiError("not_configured", {
      details: { provider: "puzzles", reason: "no_base_url" },
      cause: new Error("PUZZLE_SHARD_BASE_URL (or NEXT_PUBLIC_MEDIA_URL) is not an absolute URL"),
    });
  }
  return { baseUrl, version };
}

export function shardUrl(config: ShardConfig, theme: string, band: number): string {
  return `${config.baseUrl}/${shardPath(config.version, theme, band)}`;
}

function upstream(kind: "timeout" | "error", theme: string, band: number, cause: unknown): ApiError {
  return new ApiError("upstream_unavailable", { details: { provider: "puzzles", kind, shard: `${theme}/${band}` }, cause });
}

// ---------------------------------------------------------------------------
// Loader

const cache = new LRUCache<string, Shard>({ max: SHARD_LRU_MAX });
const inFlight = new Map<string, Promise<Shard>>();

/** Test seam: empties the module LRU (shards are otherwise kept for the life of the process). */
export function resetShardCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Shards currently in the module LRU (tests, diagnostics). */
export function shardCacheSize(): number {
  return cache.size;
}

class ShardFetchError extends Error {
  constructor(
    readonly kind: "timeout" | "error",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

async function fetchOnce(url: string, expected: { version: string; theme: string; band: number }, deps: ShardDeps): Promise<Shard> {
  let res: Response;
  try {
    // `cache: "force-cache"` puts the response in Next's data cache, keyed by the versioned URL (plan §9.2).
    res = await deps.fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(deps.timeoutMs) });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new ShardFetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "error", `fetch failed`, { cause: e });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ShardFetchError("error", `HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new ShardFetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "error", "bad json", { cause: e });
  }
  const parsed = ShardFileSchema.safeParse(body);
  if (!parsed.success) throw new ShardFetchError("error", `bad shard: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const file = parsed.data;
  if (file.version !== expected.version || file.theme !== expected.theme || file.band !== expected.band) {
    throw new ShardFetchError("error", `shard header ${file.version}/${file.theme}/${file.band} ≠ the path`);
  }
  return { version: file.version, theme: file.theme, band: file.band, tuples: file.p };
}

async function load(theme: string, band: number, config: ShardConfig, deps: ShardDeps): Promise<Shard> {
  const url = shardUrl(config, theme, band);
  const expected = { version: config.version, theme, band };
  const started = deps.perf();
  try {
    return await deps.telemetry.startSpan("shard.fetch", { theme, band: String(band) }, async () => {
      try {
        return await fetchOnce(url, expected, deps);
      } catch (first) {
        await deps.sleep(SHARD_RETRY_DELAY_MS);
        try {
          return await fetchOnce(url, expected, deps);
        } catch (second) {
          const kind = second instanceof ShardFetchError ? second.kind : "error";
          deps.telemetry.captureMessage("train.shard.unavailable", {
            level: "warning",
            tags: { kind },
            extra: { shard: `${theme}/${band}`, first: String(first), second: String(second) },
          });
          throw upstream(kind, theme, band, second);
        }
      }
    });
  } finally {
    deps.telemetry.distribution("train.shard.fetch_ms", deps.perf() - started, { theme });
  }
}

/**
 * One shard. A band the manifest does not list has no file: it is an empty shard without a request. Throws
 * `ApiError("upstream_unavailable")` when the shard server fails twice.
 */
export async function getShard(theme: string, band: number, overrides?: Partial<ShardDeps>): Promise<Shard> {
  const deps = depsOf(overrides);
  const config = shardConfig(deps.env, deps.manifest);
  if (manifestCount(deps.manifest, theme, band) === 0) return { version: config.version, theme, band, tuples: [] };
  const key = `${config.baseUrl}|${config.version}|${theme}|${band}`;
  const hit = cache.get(key);
  if (hit) {
    deps.telemetry.count("train.shard.cache", { result: "hit" });
    return hit;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  deps.telemetry.count("train.shard.cache", { result: "miss" });
  const promise = load(theme, band, config, deps).then(
    (shard) => {
      cache.set(key, shard);
      return shard;
    },
  );
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** Several bands of one theme, in parallel (two or three per session build). */
export function getShards(theme: string, bands: readonly number[], overrides?: Partial<ShardDeps>): Promise<Shard[]> {
  return Promise.all(bands.map((band) => getShard(theme, band, overrides)));
}

// ---------------------------------------------------------------------------
// Windows and counts

/** The bands of a rating window the theme has a file for. */
export function bandsFor(window: { from: number; to: number }, theme: string, manifest: PuzzleManifest): number[] {
  const have = new Set(manifestBands(manifest, theme));
  return bandsInWindow(window).filter((b) => have.has(b));
}

/** `ThemeOption.available`: puzzles in the shards of the step-0 window (manifest counts; no fetch). 0 = disabled. */
export function availableNear(theme: string, rating: number, manifest: PuzzleManifest = committedManifest()): number {
  return bandsFor(puzzleWindow(rating, 0), theme, manifest).reduce((n, b) => n + manifestCount(manifest, theme, b), 0);
}

/** True when the theme has shards (`rc:*` keys and unknown keys never do). */
export function hasShardTheme(theme: string, manifest: PuzzleManifest = committedManifest()): boolean {
  return theme !== MIX_THEME && manifestBands(manifest, theme).length > 0;
}

/** The shard theme keys in manifest order, without `mix` (the picker's universe). */
export function shardThemes(manifest: PuzzleManifest = committedManifest()): string[] {
  return Object.keys(manifest.themes).filter((t) => t !== MIX_THEME);
}

// ---------------------------------------------------------------------------
// Selection

export type PuzzleBatchInput = Omit<SelectPuzzlesInput, "loadBand" | "excludeIds"> & {
  /**
   * The ids among `ids` (≤ 500 per call) the member attempted in the last `PUZZLE_EXCLUDE_DAYS` days
   * (`training_attempts_puzzle_idx`, `"puzzleId" = ANY($ids)`). Omitted = nothing excluded.
   */
  exclude?: (ids: string[]) => Promise<Iterable<string>>;
};

/**
 * A PUZZLES / DAILY / weakness puzzle batch over the shards (WP-B's `selectPuzzles` decides; this supplies the
 * shards and the exclusions). Throws 502 `upstream_unavailable` when a needed shard cannot be fetched.
 */
export async function selectPuzzleBatch(input: PuzzleBatchInput, overrides?: Partial<ShardDeps>): Promise<PuzzlePick> {
  const deps = depsOf(overrides);
  const { exclude, ...rest } = input;
  const excluded = new Set<string>();
  const asked = new Set<string>();
  const ask = async (ids: readonly string[]) => {
    if (!exclude) return;
    const fresh = [...new Set(ids)].filter((id) => !asked.has(id));
    for (const id of fresh) asked.add(id);
    const chunks: string[][] = [];
    for (let i = 0; i < fresh.length; i += PUZZLE_EXCLUSION_MAX_IDS) chunks.push(fresh.slice(i, i + PUZZLE_EXCLUSION_MAX_IDS));
    const answers = await Promise.all(chunks.map((c) => exclude(c)));
    for (const answer of answers) for (const id of answer) excluded.add(id);
  };
  // Step 0 up front: its shards in parallel, then one exclusion round (≤ 500 ids per query, queries in parallel) for
  // every id they hold, so the selector's later reads of the same bands need no query.
  const theme = hasShardTheme(input.theme, deps.manifest) ? input.theme : MIX_THEME;
  const shards = await getShards(theme, bandsFor(puzzleWindow(input.rating, 0), theme, deps.manifest), deps);
  await ask(shards.flatMap((s) => s.tuples.map((t) => t[0])));
  return selectPuzzles({
    ...rest,
    excludeIds: excluded,
    // WP-B checks `excludeIds` after each band loads, so a widening band is asked about before its ids are used.
    loadBand: async (t, band) => {
      const shard = await getShard(t, band, deps);
      await ask(shard.tuples.map((x) => x[0]));
      return shard.tuples;
    },
  });
}

/** One shard tuple as a typed puzzle (themes decoded with the manifest's bit table). */
export function toShardPuzzle(t: readonly [string, string, string, number, number], manifest: PuzzleManifest = committedManifest()): ShardPuzzle {
  return { id: t[0], fen: t[1], moves: t[2], rating: t[3], themes: themesOfMask(t[4], manifest.bits) };
}

/**
 * The theme a puzzle is filed under in a session snapshot and its attempt: the session's theme when the puzzle carries
 * it, else its primary theme (`@repo/chess-training/themes` priority), else `mix`.
 */
export function primaryThemeOf(puzzle: Pick<ShardPuzzle, "themes">, requested: string): string {
  if (requested !== MIX_THEME && puzzle.themes.includes(requested)) return requested;
  return primaryTheme(puzzle.themes) ?? MIX_THEME;
}

/** The session snapshot tuple (`@repo/db/json` PuzzleSnapshotV1): `[id, fen, moves, rating, primaryTheme]`. */
export function toPuzzleSnapshot(puzzle: ShardPuzzle, primary: string): PuzzleSnapshotV1 {
  return [puzzle.id, puzzle.fen, puzzle.moves, puzzle.rating, primary];
}
