// The specs' handle on the CI puzzle shard server (./puzzle-shards.ts; phase-05 plan §9.3). It runs on 4012
// (+ E2E_PORT_OFFSET); playwright.config.ts starts it and gives the web server `puzzleShardEnv()`. Faults are keyed by
// a path regex, so a spec breaks only the shards it asks about (e.g. `/pin/` for "Puzzles are unavailable right now").
export const DEFAULT_PUZZLE_SHARDS_PORT = 4012;
export const PUZZLE_SHARDS_PORT = DEFAULT_PUZZLE_SHARDS_PORT + (Number(process.env.E2E_PORT_OFFSET ?? 0) || 0);
export const PUZZLE_SHARDS_URL = `http://127.0.0.1:${PUZZLE_SHARDS_PORT}`;
/** The committed manifest's version; the fixtures hold the same path. */
export const PUZZLES_TEST_VERSION = "v1";

/** The env the web server gets (playwright.config.ts): shards from this server, never from R2. */
export function puzzleShardEnv(): { PUZZLE_SHARD_BASE_URL: string; PUZZLES_VERSION: string } {
  return { PUZZLE_SHARD_BASE_URL: `${PUZZLE_SHARDS_URL}/puzzles`, PUZZLES_VERSION: PUZZLES_TEST_VERSION };
}

export type PuzzleShardRequest = { method: string; path: string; status: number; at: number };

async function call<T>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(`${PUZZLE_SHARDS_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`puzzle shard server ${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Shard requests the web server made since `since` (epoch ms). The loader's LRU means a warm build makes none. */
export async function shardRequests(since = 0): Promise<PuzzleShardRequest[]> {
  return (await call<{ requests: PuzzleShardRequest[] }>(`/__requests?since=${since}`, "GET")).requests;
}

/** Makes shard paths matching `match` (a regex source) fail with `status` (default 503) or answer after `delayMs`. */
export async function setShardFault(fault: { match: string; status?: number; delayMs?: number; times?: number }): Promise<void> {
  await call("/__faults", "POST", fault);
}

export async function clearShardFaults(): Promise<void> {
  await call("/__faults", "DELETE");
}
