// First-boot seed of the eval cache (phase-03 plan §7.8, task C4): when EVAL_CACHE_SEED_URL is set and the cache has
// not merged a seed yet (meta `seed`), the worker downloads `evalcache-seed-v1.sqlite` from R2 next to the cache
// file, merges its `lichess-db` rows (existing rows win) and deletes the download. A failed download is logged and
// the worker runs with what it has (the seed only saves searches); the next boot tries again.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Logger } from "../obs/log";
import type { EvalCache } from "./evalcache";

export const SEED_DOWNLOAD_TIMEOUT_MS = 300_000;

export type SeedOutcome = { status: "present"; name: string } | { status: "merged"; name: string; inserted: number } | { status: "failed" };

export async function ensureSeed(opts: {
  cache: EvalCache;
  url: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SeedOutcome> {
  const present = opts.cache.meta("seed");
  if (present) return { status: "present", name: present };
  const tmp = `${opts.cache.path}.seed-download`;
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.url, { signal: AbortSignal.timeout(opts.timeoutMs ?? SEED_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`seed download answered ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(tmp));
    const { name, inserted } = opts.cache.mergeSeed(tmp);
    opts.log.info("eval cache seeded", { name, inserted });
    return { status: "merged", name, inserted };
  } catch (error) {
    opts.log.warn("eval cache seed failed; running without it", { error });
    return { status: "failed" };
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}
