// Reading the Lichess monthly dump for J5 (phase-06 plan §7.4.5 step 1). Laptop only: Node built-ins, `curl`.
//
// The dump (`lichess_db_standard_rated_YYYY-MM.pgn.zst`, ~31 GB, ~95 M games) is a concatenation of independent zstd
// frames of a few MB each. That allows two ways in, both through the same game splitter and sampler:
//   - the whole stream (`zstd -dc <file> | tsx build-baseline.ts --sample --stdin`), the plan's interface: a reservoir
//     over every game of the month;
//   - chunks (`--sample` with LICHESS_DUMP_URL or LICHESS_DUMP_PATH): the file is cut into fixed-size byte ranges,
//     visited in a seeded random order across the whole month; each chunk is decoded from its first frame start to
//     its last one (the frame that straddles a chunk edge is skipped), so the sample is a two-stage one: random chunks
//     of the month, then a uniform reservoir over every eligible side they hold. It stops once every cell has its
//     offers (or at a chunk cap), which on a slow link is the difference between hours and days. The chunk list,
//     seed and stop point are in the checkpoint and in v1.meta.json, so the sample is reproducible.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { createZstdDecompress } from "node:zlib";
import { PgnSplitter, type PgnGame } from "./pgn";

/** zstd frame magic number, little-endian 0xFD2FB528. */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Byte offsets of the zstd frame magic in a buffer (a frame start, or rarely a coincidence inside compressed data). */
export function frameStarts(buf: Buffer): number[] {
  const out: number[] = [];
  for (let at = buf.indexOf(ZSTD_MAGIC); at >= 0; at = buf.indexOf(ZSTD_MAGIC, at + 1)) out.push(at);
  return out;
}

/** Chunk indexes 0 … ⌈size / chunkBytes⌉ − 1 in a seeded random order (mulberry32 Fisher–Yates). */
export function planChunks(size: number, chunkBytes: number, seed: number): number[] {
  const n = Math.ceil(size / chunkBytes);
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

export interface DecodeStats {
  /** Compressed bytes decoded (first frame start → last frame start). */
  bytesIn: number;
  /** Decompressed bytes. */
  bytesOut: number;
  games: number;
  /** Frame starts tried before one decoded (a coincidental magic costs one retry). */
  retries: number;
}

/** Decompresses a buffer of whole zstd frames into games (`complete`: the text ends at a game boundary). */
async function decodeFrames(buf: Buffer, onGames: (games: PgnGame[]) => void, complete: boolean): Promise<{ bytesOut: number; games: number }> {
  const splitter = new PgnSplitter();
  const decoder = new StringDecoder("utf8");
  let bytesOut = 0;
  let games = 0;
  await new Promise<void>((resolve, reject) => {
    const z = createZstdDecompress();
    z.on("data", (d: Buffer) => {
      bytesOut += d.length;
      const g = splitter.push(decoder.write(d));
      games += g.length;
      if (g.length > 0) onGames(g);
    });
    z.on("error", (e) => (bytesOut === 0 ? reject(e) : resolve()));
    z.on("end", () => resolve());
    z.end(buf);
  });
  const tail = splitter.end(complete);
  games += tail.length;
  if (tail.length > 0) onGames(tail);
  return { bytesOut, games };
}

/**
 * The games of one chunk: decoded from its first frame start to its last (see the header). A coincidental magic at the
 * start fails at once and the next start is tried; the decoded text's first and last (partial) games are dropped.
 */
export async function gamesOfChunk(buf: Buffer, onGames: (games: PgnGame[]) => void): Promise<DecodeStats> {
  const starts = frameStarts(buf);
  const end = starts[starts.length - 1] ?? 0;
  let retries = 0;
  for (const s of starts) {
    if (s >= end) break;
    try {
      const r = await decodeFrames(buf.subarray(s, end), onGames, false);
      return { bytesIn: end - s, bytesOut: r.bytesOut, games: r.games, retries };
    } catch {
      retries++;
    }
  }
  return { bytesIn: 0, bytesOut: 0, games: 0, retries };
}

/** Where chunk bytes come from: an HTTP URL (curl range requests) or a local copy of the dump. */
export type DumpSource = { kind: "url"; url: string; size: number } | { kind: "file"; path: string; size: number };

export function chunkRange(index: number, chunkBytes: number, size: number): { start: number; end: number } {
  const start = index * chunkBytes;
  return { start, end: Math.min(size, start + chunkBytes) - 1 };
}

/** Runs curl for one byte range, appending to `part` (resumes a partial download). Resolves with curl's exit code. */
function curlRange(url: string, start: number, end: number, part: string): Promise<number> {
  return new Promise((resolve) => {
    const out = createWriteStream(part, { flags: "a" });
    const c = spawn("curl", ["-sS", "-f", "--connect-timeout", "30", "--speed-limit", "1000", "--speed-time", "120", "-r", `${start}-${end}`, url], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    c.stdout.pipe(out);
    c.on("close", (code) => out.end(() => resolve(code ?? 1)));
  });
}

/**
 * Makes sure chunk `index` is on disk as `<dir>/<index>.bin` and returns its path. A URL source downloads with up to
 * `attempts` resumed range requests; a file source reads the range directly.
 */
export async function fetchChunk(source: DumpSource, index: number, chunkBytes: number, dir: string, attempts = 30): Promise<string> {
  const { start, end } = chunkRange(index, chunkBytes, source.size);
  const want = end - start + 1;
  const bin = `${dir}/${index}.bin`;
  if (existsSync(bin) && statSync(bin).size === want) return bin;
  if (source.kind === "file") {
    const fh = await open(source.path, "r");
    try {
      const buf = Buffer.alloc(want);
      await fh.read(buf, 0, want, start);
      const tmp = `${bin}.part`;
      await new Promise<void>((resolve, reject) => {
        const w = createWriteStream(tmp);
        w.on("error", reject);
        w.end(buf, () => resolve());
      });
      renameSync(tmp, bin);
    } finally {
      await fh.close();
    }
    return bin;
  }
  const part = `${bin}.part`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const have = existsSync(part) ? statSync(part).size : 0;
    if (have > want) unlinkSync(part);
    else if (have === want) break;
    else await curlRange(source.url, start + have, end, part);
    if (existsSync(part) && statSync(part).size === want) break;
    // database.lichess.org answers 429 to too many requests: back off politely (10 s, 20 s, … up to 2 min).
    await new Promise((r) => setTimeout(r, Math.min(120_000, 10_000 * (attempt + 1))));
  }
  if (!existsSync(part) || statSync(part).size !== want) throw new Error(`chunk ${index}: download incomplete after ${attempts} attempts`);
  renameSync(part, bin);
  return bin;
}

/** The size of the remote dump (HEAD through curl). */
export function remoteSize(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn("curl", ["-sSIL", "--connect-timeout", "30", url], { stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    c.stdout.on("data", (d: Buffer) => (text += d.toString("utf8")));
    c.on("close", (code) => {
      const m = [...text.matchAll(/content-length:\s*(\d+)/gi)].pop();
      if (code !== 0 || !m) reject(new Error(`HEAD ${url} failed (${code})`));
      else resolve(Number(m[1]));
    });
  });
}

/** Streams decompressed PGN text from stdin (or a file) through the splitter, skipping the first `skipBytes`. */
export async function streamGames(input: NodeJS.ReadableStream, skipBytes: number, onGames: (games: PgnGame[], bytes: number) => Promise<void> | void): Promise<number> {
  const splitter = new PgnSplitter();
  const decoder = new StringDecoder("utf8");
  let seen = 0;
  let skipping = skipBytes > 0;
  for await (const chunk of input as AsyncIterable<Buffer>) {
    let buf = chunk;
    if (skipping) {
      if (seen + buf.length <= skipBytes) {
        seen += buf.length;
        continue;
      }
      buf = buf.subarray(skipBytes - seen);
      seen = skipBytes;
      skipping = false;
    }
    seen += buf.length;
    const games = splitter.push(decoder.write(buf));
    await onGames(games, seen);
  }
  await onGames(splitter.end(true), seen);
  return seen;
}

/** A read stream of a local file (the `--stdin` alternative for tests). */
export function fileStream(path: string): NodeJS.ReadableStream {
  return createReadStream(path);
}
