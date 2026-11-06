#!/usr/bin/env node
/* global process */
// Uploads the hashed engine folder to Cloudflare R2 (phase-02 plan 0.2, 7.8, 9.3, 13.1 WP-H). OWNER-RUN, once per
// engine hash; never run by CI or by the build. After it succeeds, set NEXT_PUBLIC_ENGINE_BASE_URL on Vercel to
// the printed URL (e.g. https://media.playchess.tech/engine/sf18-<hash>/) and redeploy; until then the app uses
// the same-origin copy under /workers/sf18-<hash>/.
//
// Usage, from apps/web (after `node scripts/build-engine-assets.mjs`):
//   node scripts/upload-engine-r2.mjs --dry-run                 # what would be uploaded, and the CORS rule
//   node scripts/upload-engine-r2.mjs                           # upload the folder (skips files already there)
//   node scripts/upload-engine-r2.mjs --cors                    # also merge the engine CORS rule into the bucket
//   node scripts/upload-engine-r2.mjs --verify                  # GET the public URLs and check the headers
//
// Environment (or apps/web/.env.local): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (an R2
// API token with Object Read & Write on the bucket; --cors needs Admin Read & Write), NEXT_PUBLIC_MEDIA_URL (the
// bucket's public base, e.g. https://media.playchess.tech), ENGINE_CORS_ORIGINS (comma-separated app origins;
// default: the production site, the dev Vercel URL and http://localhost:3000). Secrets are never printed.
//
// Every object gets `Cache-Control: public, max-age=31536000, immutable` and its Content-Type
// (`application/wasm` for the WASM, so `WebAssembly.instantiateStreaming` works). The CORS rule allows GET/HEAD
// from the app origins; the bucket's other CORS rules are kept (the script merges, never replaces).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GetBucketCorsCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config as loadEnv } from "dotenv";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = path.join(WEB, "public", "workers");
const MANIFEST_TS = path.join(WEB, "features", "engine", "manifest.ts");
const KEY_PREFIX = "engine";
const IMMUTABLE = "public, max-age=31536000, immutable";
const DEFAULT_ORIGINS = [
  "https://playchess.tech",
  "https://www.playchess.tech",
  "https://replay-chess-dev-replaychess007-1069.vercel.app",
  "http://localhost:3000",
];

loadEnv({ path: [path.join(WEB, ".env.local"), path.join(WEB, ".env")], quiet: true });

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const withCors = args.has("--cors");
const verifyOnly = args.has("--verify");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (environment or apps/web/.env.local)`);
  return value;
}

async function engineFolder() {
  const ts = await readFile(MANIFEST_TS, "utf8");
  const hash = /export const ENGINE_HASH = "([0-9a-f]+)";/.exec(ts)?.[1];
  if (!hash) throw new Error("ENGINE_HASH is empty: run `node scripts/build-engine-assets.mjs` first");
  const folder = `sf18-${hash}`;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(WORKERS, folder, "manifest.json"), "utf8"));
  } catch {
    throw new Error(`public/workers/${folder}/manifest.json is missing: run \`node scripts/build-engine-assets.mjs\``);
  }
  if (manifest.hash !== hash) throw new Error(`manifest hash ${manifest.hash} != ENGINE_HASH ${hash}`);
  const files = [
    { name: manifest.files.glue.name, contentType: manifest.files.glue.contentType },
    { name: manifest.files.wasm.name, contentType: manifest.files.wasm.contentType },
    { name: "COPYING", contentType: "text/plain; charset=utf-8" },
    { name: "SOURCE.txt", contentType: "text/plain; charset=utf-8" },
    { name: "manifest.json", contentType: "application/json" },
  ];
  return { hash, folder, files };
}

function corsOrigins() {
  const raw = process.env.ENGINE_CORS_ORIGINS;
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  for (const o of list) if (!/^https?:\/\/[^/\s]+$/.test(o)) throw new Error(`bad origin in ENGINE_CORS_ORIGINS: ${o}`);
  return list;
}

const ENGINE_RULE_ID = "replay-chess-engine";

function engineCorsRule(origins) {
  return {
    ID: ENGINE_RULE_ID,
    AllowedOrigins: origins,
    AllowedMethods: ["GET", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["Content-Length", "Content-Type", "ETag"],
    MaxAgeSeconds: 86_400,
  };
}

function publicBase(folder) {
  const media = (process.env.NEXT_PUBLIC_MEDIA_URL ?? "").replace(/\/+$/, "");
  return media ? `${media}/${KEY_PREFIX}/${folder}/` : null;
}

async function verify(folder, files, origins) {
  const base = publicBase(folder);
  if (!base) throw new Error("NEXT_PUBLIC_MEDIA_URL is not set; cannot verify the public URLs");
  let ok = true;
  for (const f of files) {
    const res = await fetch(base + f.name, { method: "GET", headers: { Origin: origins[0] } });
    const type = res.headers.get("content-type") ?? "";
    const cache = res.headers.get("cache-control") ?? "";
    const acao = res.headers.get("access-control-allow-origin") ?? "";
    const good = res.ok && type.startsWith(f.contentType.split(";")[0]) && cache.includes("immutable") && (acao === "*" || acao === origins[0]);
    ok &&= good;
    console.log(`${good ? "ok  " : "FAIL"} ${f.name}: ${res.status}, content-type "${type}", cache-control "${cache}", allow-origin "${acao}"`);
    await res.arrayBuffer().catch(() => {});
  }
  if (!ok) throw new Error("verification failed (see above)");
  console.log(`\nverified. Set NEXT_PUBLIC_ENGINE_BASE_URL=${base}`);
}

async function main() {
  const { folder, files } = await engineFolder();
  const origins = corsOrigins();
  const base = publicBase(folder);

  if (verifyOnly) return verify(folder, files, origins);

  console.log(`engine folder: public/workers/${folder}/ → r2://<bucket>/${KEY_PREFIX}/${folder}/`);
  if (dryRun) {
    for (const f of files) console.log(`would upload ${KEY_PREFIX}/${folder}/${f.name} (${f.contentType}; ${IMMUTABLE})`);
    console.log(`CORS rule ${withCors ? "would be merged" : "(only with --cors)"}: ${JSON.stringify(engineCorsRule(origins))}`);
    if (base) console.log(`public URL: ${base}`);
    return;
  }

  const bucket = requireEnv("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: requireEnv("R2_ACCESS_KEY_ID"), secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY") },
  });

  for (const f of files) {
    const Key = `${KEY_PREFIX}/${folder}/${f.name}`;
    const body = await readFile(path.join(WORKERS, folder, f.name));
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
      if (head.ContentLength === body.length && head.CacheControl === IMMUTABLE && head.ContentType === f.contentType) {
        console.log(`exists ${Key}`);
        continue;
      }
    } catch {
      // not there yet
    }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType: f.contentType, CacheControl: IMMUTABLE }));
    console.log(`uploaded ${Key} (${body.length} bytes)`);
  }

  if (withCors) {
    let rules = [];
    try {
      rules = (await client.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
    } catch {
      rules = []; // no CORS configuration yet
    }
    const merged = [...rules.filter((r) => r.ID !== ENGINE_RULE_ID), engineCorsRule(origins)];
    await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: merged } }));
    console.log(`CORS: kept ${merged.length - 1} other rule(s), set "${ENGINE_RULE_ID}" for ${origins.join(", ")}`);
  } else {
    console.log("CORS: unchanged (pass --cors to merge the engine rule)");
  }

  if (base) console.log(`\nnext: node scripts/upload-engine-r2.mjs --verify, then set NEXT_PUBLIC_ENGINE_BASE_URL=${base}`);
}

main().catch((err) => {
  console.error(`upload-engine-r2: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
