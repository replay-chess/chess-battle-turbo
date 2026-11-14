/**
 * Uploads a verified shard build to the Cloudflare R2 bucket (phase-05 plan §8.13, B13): every
 * `<dir>/<version>/<theme>/<band>.json` to `puzzles/<version>/<theme>/<band>.json`, then `puzzles/<version>/manifest.json`
 * LAST, so a half-finished upload never advertises a version. Headers: `Content-Type: application/json`,
 * `Cache-Control: public, max-age=31536000, immutable`.
 *
 * Versioned paths are immutable: an object that already exists with the same bytes (ETag = MD5 of a single-part PUT)
 * is skipped, one with different bytes stops the upload (build a new version instead, plan §8.13). Runs on a laptop
 * only (stage B; README.md); no CI job calls it, and the tests never reach R2.
 *
 *   npx tsx scripts/puzzles/upload-shards.ts --dir <build root> [--version v1] [--dry-run] [--concurrency 8]
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (the same names as scripts/upload-media.ts)
 * in the environment or in apps/web/.env.local.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config as loadEnv } from "dotenv";
import { manifestPath, manifestShards, shardPath } from "../../lib/train/puzzle-shards";
import { readManifest, verifyDir } from "./build-shards";

export const SHARD_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const R2_PREFIX = "puzzles";

export type UploadItem = { key: string; file: string };

/** Shards first (theme, band order), the manifest last. */
export function uploadPlan(root: string, version: string): UploadItem[] {
  const manifest = readManifest(path.join(root, manifestPath(version)));
  if (manifest.version !== version) throw new Error(`manifest version ${manifest.version} ≠ --version ${version}`);
  const items = manifestShards(manifest).map(({ theme, band }) => {
    const rel = shardPath(version, theme, band);
    return { key: `${R2_PREFIX}/${rel}`, file: path.join(root, rel) };
  });
  items.push({ key: `${R2_PREFIX}/${manifestPath(version)}`, file: path.join(root, manifestPath(version)) });
  return items;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (environment or apps/web/.env.local)`);
  return value;
}

type Outcome = "uploaded" | "unchanged";

async function putImmutable(client: S3Client, bucket: string, item: UploadItem): Promise<Outcome> {
  const body = readFileSync(item.file);
  const md5 = createHash("md5").update(body).digest("hex");
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
    if (head.ETag?.replaceAll('"', "") === md5) return "unchanged";
    throw new Error(`${item.key} already exists with different content: versioned paths are immutable, build a new version`);
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: item.key,
      Body: body,
      ContentType: "application/json",
      CacheControl: SHARD_CACHE_CONTROL,
      ContentMD5: Buffer.from(md5, "hex").toString("base64"),
    }),
  );
  return "uploaded";
}

async function main(argv: string[]): Promise<number> {
  const at = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = at("dir");
  if (!dir) throw new Error("--dir <build root> is required (the folder that holds <version>/manifest.json)");
  const root = path.resolve(dir);
  const version = at("version") ?? "v1";
  const concurrency = Math.max(1, Number(at("concurrency") ?? 8));
  const errors = verifyDir(path.join(root, version), { replay: false });
  if (errors.length) {
    for (const e of errors) console.error(e);
    throw new Error(`${path.join(root, version)} does not match its manifest; run build-shards.ts verify first`);
  }
  const items = uploadPlan(root, version);
  if (argv.includes("--dry-run")) {
    for (const item of items) console.log(`would upload ${item.key}`);
    console.log(`${items.length} objects (${SHARD_CACHE_CONTROL})`);
    return 0;
  }
  loadEnv({ path: [".env.local", ".env"], quiet: true });
  const bucket = requireEnv("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: requireEnv("R2_ACCESS_KEY_ID"), secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY") },
  });
  const shards = items.slice(0, -1);
  const manifest = items[items.length - 1] as UploadItem;
  const counts: Record<Outcome, number> = { uploaded: 0, unchanged: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < shards.length) {
        const item = shards[next++] as UploadItem;
        counts[await putImmutable(client, bucket, item)] += 1;
      }
    }),
  );
  counts[await putImmutable(client, bucket, manifest)] += 1;
  console.log(`${counts.uploaded} uploaded, ${counts.unchanged} already there (same bytes) under ${R2_PREFIX}/${version}/`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}
