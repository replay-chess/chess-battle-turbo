// J5 phase 1, the sample (phase-06 plan §7.4.5 steps 1–3): dump → eligible games → one side per game → per-cell
// reservoirs, checkpointed after every chunk (or every ~256 MB of a stream) so a killed run resumes. See dump.ts for
// the two input modes and sampler.ts for the side rule.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fetchChunk, gamesOfChunk, planChunks, streamGames, type DumpSource } from "./dump";
import { KEPT_HEADERS, hasEvals, screenGame, type PgnGame } from "./pgn";
import { Sampler, allCellKeys } from "./sampler";
import { appendJsonl, journal, readLines, readSample, writeSample, type SampleMeta, type WorkDir } from "./work";

export interface SampleOptions {
  dumpName: string;
  /** null = the decompressed stream on stdin. */
  source: DumpSource | null;
  sha256: string | null;
  seed: number;
  /** Reservoir capacity per cell (the largest per-cell sample a later phase may use). */
  cap: number;
  /** Offers per cell after which chunk sampling may stop. */
  target: number;
  chunkBytes: number;
  maxChunks: number;
  concurrency: number;
  /** Cells allowed to stay short (the plan's explained shortfall at 2300+). */
  exempt: (cellKey: string) => boolean;
  /** A cell closes after closeFactor × cap offers, once at least closeMinChunks chunks were read (chunk mode). */
  closeFactor: number;
  closeMinChunks: number;
}

/** Appends the final reservoirs of the cells just closed (the grading phase follows this file). */
function publishClosed(w: WorkDir, sampler: Sampler, keys: readonly string[], chunksDone: number): void {
  for (const key of keys) {
    const cell = sampler.state.cells[key]!;
    appendJsonl(w.closed, { key, offers: cell.offers, closedAt: chunksDone, items: cell.items });
  }
}

/** Cells at and above 2300 may stay short (plan §13 WP2 acceptance). */
export function exemptHighBands(key: string): boolean {
  return Number(key.split(":")[0]) >= 2300;
}

function freshMeta(o: SampleOptions): SampleMeta {
  const now = new Date().toISOString();
  return {
    v: 1,
    mode: o.source ? "chunks" : "stream",
    dump: { name: o.dumpName, url: o.source?.kind === "url" ? o.source.url : null, size: o.source?.size ?? null, sha256: o.sha256 },
    seed: o.seed,
    cap: o.cap,
    target: o.target,
    chunkBytes: o.chunkBytes,
    chunksDone: [],
    streamBytes: 0,
    compressedBytesDecoded: 0,
    decompressedBytes: 0,
    counts: { games: 0, analysed: 0, eligible: 0, offered: 0, reasons: {} },
    closed: false,
    closedReason: null,
    startedAt: now,
    updatedAt: now,
  };
}

/** The lowest-offer cells (progress lines). */
function lowest(sampler: Sampler, exempt: (k: string) => boolean, n = 6): string {
  const open = allCellKeys().filter((k) => !sampler.isClosed(k)).length;
  return `${open} open; ` + allCellKeys()
    .filter((k) => !exempt(k))
    .map((k) => [k, sampler.offers(k)] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

function takeGames(games: readonly PgnGame[], sampler: Sampler, meta: SampleMeta): void {
  const c = meta.counts;
  for (const g of games) {
    c.games++;
    if (!hasEvals(g.movetext)) continue;
    c.analysed++;
    const s = screenGame(g);
    if (!s.ok) {
      c.reasons[s.reason] = (c.reasons[s.reason] ?? 0) + 1;
      continue;
    }
    c.eligible++;
    const headers: Record<string, string> = {};
    for (const k of KEPT_HEADERS) if (g.headers[k] !== undefined) headers[k] = g.headers[k] as string;
    if (sampler.offer({ id: s.id, tc: s.tc, headers, movetext: g.movetext }, s.sides) !== null) c.offered++;
  }
}

/** Runs (or resumes) the sample. Returns the closed checkpoint's meta. */
export async function runSample(w: WorkDir, o: SampleOptions): Promise<SampleMeta> {
  const saved = await readSample(w);
  const meta = saved?.meta ?? freshMeta(o);
  const sampler = saved ? new Sampler(saved.sampler) : Sampler.fresh(o.cap, o.seed);
  if (saved) {
    if (saved.meta.dump.name !== o.dumpName || saved.meta.seed !== o.seed || saved.meta.chunkBytes !== o.chunkBytes || saved.meta.cap !== o.cap)
      throw new Error("the checkpoint was made with another dump, seed, chunk size or cap: use another work directory");
    journal(w, `sample: resuming (${meta.chunksDone.length} chunks, ${meta.counts.offered} sides offered)`);
  }
  // A run killed between the checkpoint and the closed-cells append: publish what the checkpoint already closed.
  const published = new Set<string>();
  for await (const line of readLines(w.closed)) published.add((JSON.parse(line) as { key: string }).key);
  const missing = allCellKeys().filter((k) => sampler.isClosed(k) && !published.has(k));
  if (missing.length > 0) publishClosed(w, sampler, missing, meta.chunksDone.length);
  if (meta.closed) return meta;
  const closeFlag = `${w.root}/close-sample`;
  const close = async (reason: string) => {
    const keys = sampler.closeAll(meta.chunksDone.length);
    meta.closed = true;
    meta.closedReason = reason;
    meta.updatedAt = new Date().toISOString();
    await writeSample(w, meta, sampler.state);
    publishClosed(w, sampler, keys, meta.chunksDone.length);
    journal(w, `sample: closed (${reason}); ${meta.counts.offered} sides offered over ${meta.chunksDone.length} chunks; lowest ${lowest(sampler, o.exempt)}`);
    if (existsSync(closeFlag)) unlinkSync(closeFlag);
  };

  if (!o.source) {
    let lastSave = meta.streamBytes;
    await streamGames(process.stdin, meta.streamBytes, async (games, bytes) => {
      takeGames(games, sampler, meta);
      meta.streamBytes = bytes;
      meta.decompressedBytes = bytes;
      if (bytes - lastSave >= 256 * 1024 * 1024) {
        lastSave = bytes;
        meta.updatedAt = new Date().toISOString();
        await writeSample(w, meta, sampler.state);
        journal(w, `sample: ${(bytes / 1e9).toFixed(2)} GB read, ${meta.counts.games} games, ${meta.counts.eligible} eligible; lowest ${lowest(sampler, o.exempt)}`);
      }
    });
    await close("end_of_stream");
    return meta;
  }

  const source = o.source;
  const order = planChunks(source.size, o.chunkBytes, o.seed);
  const done = new Set(meta.chunksDone);
  const todo = order.filter((i) => !done.has(i));
  // Downloads run `concurrency` at a time in the planned order; a chunk is processed as soon as it is complete (a
  // slow range never blocks the others). The processing order is what `chunksDone` records (the reproducible order).
  const inflight = new Map<number, Promise<{ idx: number; path: string }>>();
  let next = 0;
  const refill = () => {
    while (inflight.size < o.concurrency && next < todo.length) {
      const idx = todo[next++] as number;
      const p = fetchChunk(source, idx, o.chunkBytes, w.chunks).then((path) => ({ idx, path }));
      p.catch(() => undefined); // awaited (and rethrown) through Promise.race below
      inflight.set(idx, p);
    }
  };
  for (;;) {
    if (meta.chunksDone.length >= o.maxChunks) {
      await close("chunk_cap");
      return meta;
    }
    if (existsSync(closeFlag)) {
      await close("manual");
      return meta;
    }
    refill();
    if (inflight.size === 0) break;
    const { idx, path } = await Promise.race(inflight.values());
    inflight.delete(idx);
    const t0 = Date.now();
    const buf = readFileSync(path);
    const stats = await gamesOfChunk(buf, (games) => takeGames(games, sampler, meta));
    meta.chunksDone.push(idx);
    meta.compressedBytesDecoded += stats.bytesIn;
    meta.decompressedBytes += stats.bytesOut;
    meta.updatedAt = new Date().toISOString();
    const closedNow = meta.chunksDone.length >= o.closeMinChunks ? sampler.closeFull(o.closeFactor, meta.chunksDone.length) : [];
    await writeSample(w, meta, sampler.state);
    publishClosed(w, sampler, closedNow, meta.chunksDone.length);
    unlinkSync(path);
    if (closedNow.length > 0) journal(w, `sample: cells closed ${closedNow.join(" ")}`);
    journal(
      w,
      `sample: chunk ${idx} (${meta.chunksDone.length} done, ${(meta.compressedBytesDecoded / 1e9).toFixed(2)} GB decoded, ${stats.games} games, ${Math.round((Date.now() - t0) / 1000)} s); eligible ${meta.counts.eligible}; lowest ${lowest(sampler, o.exempt)}`,
    );
    if (sampler.satisfied(o.target, o.exempt)) {
      await close("target");
      return meta;
    }
  }
  await close("all_chunks");
  return meta;
}
