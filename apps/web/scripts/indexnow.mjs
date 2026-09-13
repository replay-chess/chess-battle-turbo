#!/usr/bin/env node
/**
 * Submit URLs to IndexNow (Bing, Yandex, Seznam, Naver, Yep — Google does not
 * participate). Dependency-free so it can run in CI on plain Node 22+.
 *
 *   node scripts/indexnow.mjs --scope recent   # URLs whose <lastmod> is within --days (default 2)
 *   node scripts/indexnow.mjs --scope all      # every URL in every sitemap (one-time bootstrap)
 *   node scripts/indexnow.mjs --urls https://www.playchess.tech/blog/foo,...   # explicit list
 *
 * Reads the live sitemaps so it never disagrees with what the site publishes.
 * Exits 0 when there is nothing to submit.
 */

const HOST = "www.playchess.tech";
const BASE_URL = `https://${HOST}`;
// Keep in sync with lib/indexnow.ts and the key file in public/.
const KEY = "cb05b2e2d0f759b927d51cf825110140";
const KEY_LOCATION = `${BASE_URL}/${KEY}.txt`;
const SITEMAPS = [
  `${BASE_URL}/sitemap.xml`,
  `${BASE_URL}/sitemap-legends.xml`,
  `${BASE_URL}/sitemap-openings.xml`,
];
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10000; // protocol max per request

const args = parseArgs(process.argv.slice(2));
const scope = args.scope ?? "recent";
const days = Number(args.days ?? 2);
const dryRun = "dry-run" in args;

const urls = args.urls
  ? args.urls.split(",").map((u) => u.trim()).filter(Boolean)
  : await collectFromSitemaps(scope, days);

if (urls.length === 0) {
  console.log(`indexnow: nothing to submit (scope=${scope}, days=${days})`);
  process.exit(0);
}

console.log(`indexnow: ${urls.length} URL(s) to submit (scope=${scope})`);
if (dryRun) {
  for (const u of urls) console.log("  " + u);
  process.exit(0);
}

let failed = false;
for (let i = 0; i < urls.length; i += BATCH) {
  const urlList = urls.slice(i, i + BATCH);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  // 200 = submitted, 202 = accepted (key pending validation). Anything else is a real problem.
  const ok = res.status === 200 || res.status === 202;
  console.log(`indexnow: batch ${i / BATCH + 1} → HTTP ${res.status}${ok ? "" : " " + (await res.text())}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);

// ───────────────────────── helpers ─────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "";
    }
  }
  return out;
}

async function collectFromSitemaps(scope, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const found = new Set();
  for (const sitemap of SITEMAPS) {
    const res = await fetch(sitemap, { headers: { "User-Agent": "replaychess-indexnow/1.0" } });
    if (!res.ok) {
      console.warn(`indexnow: ${sitemap} → HTTP ${res.status}, skipping`);
      continue;
    }
    const xml = await res.text();
    for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = block[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
      if (!loc || !loc.startsWith(BASE_URL)) continue;
      if (scope === "all") {
        found.add(loc);
        continue;
      }
      const lastmod = block[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
      if (lastmod && Date.parse(lastmod) >= cutoff) found.add(loc);
    }
  }
  return [...found];
}
