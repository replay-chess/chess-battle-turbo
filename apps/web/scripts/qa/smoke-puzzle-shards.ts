/**
 * Post-deploy puzzle shard smoke (phase-05 plan §12.4; run by post-deploy-dev against the real R2 objects, never by
 * PR CI). Checks:
 *   1. GET <base>/<version>/manifest.json → 200, `version = PUZZLES_VERSION`, and the same counts and bits as the
 *      committed manifest (@repo/chess-training/puzzles/manifest.v1.json) the server selects with;
 *   2. one shard's `cache-control` contains `immutable` and its content type is JSON;
 *   3. 20 random puzzles from 3 random shards replay legally with chess.js, sit in their band, carry their shard's
 *      theme bit, and every bit they set maps to a key of the theme registry (@repo/chess-training/themes).
 *
 *   PUZZLE_SHARD_BASE_URL=https://<public R2 base>/puzzles PUZZLES_VERSION=v1 \
 *     npx tsx scripts/qa/smoke-puzzle-shards.ts [--expect-manifest <path>] [--samples 20] [--shards 3] [--seed <n>]
 *
 * Exit 0 = every check passed; 1 = a check failed (each failure printed); 2 = setup error.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bandOf,
  manifestPath,
  manifestShards,
  maskHas,
  MIX_THEME,
  PuzzleManifestSchema,
  replayPuzzle,
  ShardFileSchema,
  shardPath,
  themesOfMask,
  type PuzzleManifest,
} from "../../lib/train/puzzle-shards";

export type SmokeOptions = {
  baseUrl: string;
  version: string;
  /** The manifest the server selects with (committed). */
  expected: PuzzleManifest;
  /** Keys of the theme registry; every bit a sampled puzzle sets must be one of them. */
  themeKeys: ReadonlySet<string>;
  samples?: number;
  shards?: number;
  random?: () => number;
  fetch?: typeof fetch;
};

export type SmokeResult = { ok: boolean; passed: string[]; failed: string[] };

/** mulberry32: a seeded [0, 1) source, so a failing sample can be replayed with `--seed`. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sameCounts(a: PuzzleManifest, b: PuzzleManifest): string | null {
  const ka = JSON.stringify(manifestShards(a));
  const kb = JSON.stringify(manifestShards(b));
  if (ka !== kb) return "shard counts differ from the committed manifest";
  const bits = (m: PuzzleManifest) => JSON.stringify(Object.entries(m.bits).sort((x, y) => x[1] - y[1]));
  if (bits(a) !== bits(b)) return "theme bits differ from the committed manifest";
  return null;
}

export async function runShardSmoke(o: SmokeOptions): Promise<SmokeResult> {
  const doFetch = o.fetch ?? fetch;
  const random = o.random ?? Math.random;
  const passed: string[] = [];
  const failed: string[] = [];
  const base = o.baseUrl.replace(/\/+$/, "");
  const get = (rel: string) => doFetch(`${base}/${rel}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });

  // 1. Manifest.
  let manifest: PuzzleManifest;
  try {
    const res = await get(manifestPath(o.version));
    if (res.status !== 200) {
      failed.push(`manifest: HTTP ${res.status}`);
      return { ok: false, passed, failed };
    }
    manifest = PuzzleManifestSchema.parse(await res.json());
  } catch (e) {
    failed.push(`manifest: ${(e as Error).message.split("\n")[0]}`);
    return { ok: false, passed, failed };
  }
  if (manifest.version !== o.version) failed.push(`manifest version ${manifest.version} ≠ PUZZLES_VERSION ${o.version}`);
  else passed.push(`manifest ${manifest.version}: ${manifest.files} files, ${manifest.puzzles} puzzles (source ${manifest.source})`);
  const diff = sameCounts(manifest, o.expected);
  if (diff) failed.push(diff);
  else passed.push("manifest counts and bits equal the committed manifest");

  // 2 + 3. Random shards.
  const all = manifestShards(manifest);
  const chosen: typeof all = [];
  const pool = all.slice();
  for (let i = 0; i < Math.min(o.shards ?? 3, pool.length); i++) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as (typeof all)[number]);
  }
  const wanted = o.samples ?? 20;
  let sampled = 0;
  for (const [i, s] of chosen.entries()) {
    const rel = shardPath(manifest.version, s.theme, s.band);
    let res: Response;
    try {
      res = await get(rel);
    } catch (e) {
      failed.push(`${rel}: ${(e as Error).message}`);
      continue;
    }
    if (res.status !== 200) {
      failed.push(`${rel}: HTTP ${res.status}`);
      continue;
    }
    if (i === 0) {
      const cc = res.headers.get("cache-control") ?? "";
      const ct = res.headers.get("content-type") ?? "";
      if (!cc.includes("immutable")) failed.push(`${rel}: cache-control "${cc}" lacks immutable`);
      else passed.push(`${rel}: cache-control "${cc}"`);
      if (!ct.includes("application/json")) failed.push(`${rel}: content-type "${ct}"`);
    }
    const parsed = ShardFileSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      failed.push(`${rel}: not a v1 shard`);
      continue;
    }
    const file = parsed.data;
    if (file.p.length !== s.count) failed.push(`${rel}: ${file.p.length} puzzles, manifest says ${s.count}`);
    const share = Math.ceil((wanted - sampled) / (chosen.length - i));
    const picks = file.p.slice();
    for (let n = 0; n < Math.min(share, file.p.length); n++) {
      const [id, fen, moves, rating, mask] = picks.splice(Math.floor(random() * picks.length), 1)[0] as (typeof file.p)[number];
      sampled += 1;
      const r = replayPuzzle(fen, moves);
      if (!r.ok) failed.push(`${rel} ${id}: ply ${r.ply} ${r.reason}`);
      if (bandOf(rating) !== s.band) failed.push(`${rel} ${id}: rating ${rating} outside band ${s.band}`);
      if (s.theme !== MIX_THEME && !maskHas(mask, s.theme, manifest.bits)) failed.push(`${rel} ${id}: lacks the ${s.theme} bit`);
      const unknown = themesOfMask(mask, manifest.bits).filter((k) => !o.themeKeys.has(k));
      if (unknown.length) failed.push(`${rel} ${id}: bits not in the theme registry: ${unknown.join(", ")}`);
    }
  }
  if (sampled) passed.push(`${sampled} puzzles from ${chosen.length} shards (${chosen.map((c) => `${c.theme}/${c.band}`).join(", ")}) checked`);
  if (sampled < Math.min(wanted, all.reduce((n, s) => n + s.count, 0))) failed.push(`only ${sampled} of ${wanted} puzzles sampled`);
  return { ok: failed.length === 0, passed, failed };
}

/** The theme registry's keys (WP-B's `THEMES`, a record keyed by theme or a list of `{ key }`). */
export function registryKeys(themes: unknown): Set<string> {
  if (Array.isArray(themes)) return new Set(themes.map((t) => (typeof t === "string" ? t : String((t as { key: unknown }).key))));
  if (themes instanceof Map) return new Set([...themes.keys()].map(String));
  if (themes && typeof themes === "object") return new Set(Object.keys(themes));
  throw new Error("@repo/chess-training/themes exports no THEMES table");
}

const COMMITTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/chess-training/puzzles/manifest.v1.json");

async function main(argv: string[]): Promise<number> {
  const at = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const baseUrl = process.env.PUZZLE_SHARD_BASE_URL;
  if (!baseUrl) throw new Error("PUZZLE_SHARD_BASE_URL is not set");
  const expected = PuzzleManifestSchema.parse(JSON.parse(readFileSync(path.resolve(at("expect-manifest") ?? COMMITTED), "utf8")));
  const version = process.env.PUZZLES_VERSION || expected.version;
  // WP-B's taxonomy module; imported by name at run time so this script does not pin its type.
  const registry = "@repo/chess-training/themes";
  const { THEMES } = (await import(registry)) as { THEMES?: unknown };
  const seed = Number(at("seed") ?? Date.now() % 1_000_000);
  const result = await runShardSmoke({
    baseUrl,
    version,
    expected,
    themeKeys: registryKeys(THEMES),
    samples: Number(at("samples") ?? 20),
    shards: Number(at("shards") ?? 3),
    random: seeded(seed),
  });
  for (const line of result.passed) console.log(`ok   ${line}`);
  for (const line of result.failed) console.log(`FAIL ${line}`);
  console.log(`${result.ok ? "PASS" : "FAIL"} puzzle shard smoke (${baseUrl}, ${version}, seed ${seed})`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exit(2);
    },
  );
}
