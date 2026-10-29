/**
 * Uploads the large public/ media (sounds, trailer, clips) to the Cloudflare
 * R2 bucket served at NEXT_PUBLIC_MEDIA_URL. Keys mirror the public/ paths, so
 * "/sounds/move.webm" becomes "<bucket>/sounds/move.webm".
 *
 * Usage, from apps/web:
 *   pnpm media:upload             # upload
 *   pnpm media:upload -- --dry-run  # list what would be uploaded
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET
 * (an R2 API token with Object Read & Write on the bucket) in the
 * environment or in .env.local.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const PUBLIC_DIR = "public";
const FILES = [
  "ReplayChessTrailer.mp4",
  "Kings_Gambit_Chess_Board_Animation.mp4",
  "video_clip.webm",
];
const DIRS = ["sounds"];

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (apps/web/.env.local)`);
  return value;
}

async function listFiles(): Promise<string[]> {
  const nested = await Promise.all(
    DIRS.map(async (dir) =>
      (await readdir(path.join(PUBLIC_DIR, dir))).map((file) => `${dir}/${file}`),
    ),
  );
  return [...FILES, ...nested.flat()];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = await listFiles();

  if (dryRun) {
    files.forEach((file) => console.log(`would upload ${file}`));
    return;
  }

  const bucket = requireEnv("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  for (const file of files) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: file,
        Body: await readFile(path.join(PUBLIC_DIR, file)),
        ContentType: CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        // Paths are stable but files can be replaced, so cache for a day
        CacheControl: "public, max-age=86400",
      }),
    );
    console.log(`uploaded ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
