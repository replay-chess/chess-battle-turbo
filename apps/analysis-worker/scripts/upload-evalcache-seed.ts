// Uploads the eval-cache seed to Cloudflare R2 (phase-03 plan §7.8, task C4). Owner-run, once per seed version:
//
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=replay-chess-media \
//     tsx scripts/upload-evalcache-seed.ts --file evalcache-seed-v1.sqlite [--yes]
//
// Without --yes it validates the file and prints what it would upload (no network). The object goes to
// `evalcache/<seed name>.sqlite` with an immutable cache header and its SHA-256 in the metadata; the worker env then
// gets EVAL_CACHE_SEED_URL = <public base>/evalcache/<seed name>.sqlite. Credentials are read from the environment
// and never printed.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { CACHE_FORMAT, SEED_ENGINE } from "../src/cache/schema";

export const DEFAULT_PUBLIC_BASE = "https://media.playchess.tech";
const R2_VARS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

export interface UploadArgs {
  file: string;
  yes: boolean;
  publicBase: string;
}

export function parseArgs(argv: readonly string[]): UploadArgs {
  const args: Partial<UploadArgs> = { yes: false, publicBase: DEFAULT_PUBLIC_BASE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--file") args.file = value();
    else if (a === "--yes") args.yes = true;
    else if (a === "--public-base") args.publicBase = value().replace(/\/+$/, "");
    else throw new Error(`unknown argument ${a}`);
  }
  if (!args.file) throw new Error("usage: --file <evalcache-seed-vN.sqlite> [--yes] [--public-base https://…]");
  return args as UploadArgs;
}

export interface SeedFileInfo {
  name: string;
  rows: number;
  bytes: number;
  sha256: string;
}

/** Opens the file read-only and checks it is a seed the worker will merge (format, name, only lichess-db rows). */
export function validateSeedFile(path: string): SeedFileInfo {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const meta = (k: string) => db.prepare("SELECT value FROM meta WHERE key = ?").pluck().get(k) as string | undefined;
    if (meta("format") !== CACHE_FORMAT) throw new Error(`not an eval cache of format ${CACHE_FORMAT}`);
    const name = meta("name");
    if (!name || !/^evalcache-seed-v\d+$/.test(name)) throw new Error("the file has no seed name (evalcache-seed-vN)");
    const rows = db.prepare("SELECT count(*) FROM evals").pluck().get() as number;
    const foreign = db.prepare(`SELECT count(*) FROM evals WHERE engine <> '${SEED_ENGINE}'`).pluck().get() as number;
    if (rows === 0) throw new Error("the seed has no rows");
    if (foreign > 0) throw new Error(`the seed holds ${foreign} rows that are not ${SEED_ENGINE}`);
    return { name, rows, bytes: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  } finally {
    db.close();
  }
}

export interface UploadPlan extends SeedFileInfo {
  bucket: string | null;
  key: string;
  publicUrl: string;
  uploaded: boolean;
}

type Sender = { send(command: PutObjectCommand): Promise<unknown> };

export async function upload(
  args: UploadArgs,
  env: Readonly<Record<string, string | undefined>>,
  client?: Sender,
): Promise<UploadPlan> {
  const info = validateSeedFile(args.file);
  const key = `evalcache/${info.name}.sqlite`;
  const plan: UploadPlan = { ...info, bucket: env.R2_BUCKET ?? null, key, publicUrl: `${args.publicBase}/${key}`, uploaded: false };
  if (!args.yes) return plan;
  const missing = R2_VARS.filter((v) => !env[v]?.trim());
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`);
  const s3 =
    client ??
    new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    });
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: createReadStream(args.file),
      ContentLength: info.bytes,
      ContentType: "application/vnd.sqlite3",
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: { sha256: info.sha256, rows: String(info.rows) },
    }),
  );
  return { ...plan, uploaded: true };
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  upload(parseArgs(process.argv.slice(2)), process.env)
    .then((plan) => {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      if (!plan.uploaded) process.stdout.write("dry run: pass --yes to upload\n");
      else process.stdout.write(`set EVAL_CACHE_SEED_URL=${plan.publicUrl} in the worker env\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`upload failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
