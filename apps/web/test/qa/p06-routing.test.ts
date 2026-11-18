// Phase 6 routing data (phase-06 plan §4.1, §3.1 next.config row): `/weakness` → `/train/weakness`, 307 on dev and
// every non-production build (a browser caches a 308 for good while the page is behind the `weakness` flag), 308 in
// production only; after the P0 host canonicalisation and the P3 rule; only the exact path matches.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The plain .mjs registry next.config.js imports (typed through its JSDoc).
import { allRedirects } from "../../config/redirects/index.mjs";
import { redirects as p00 } from "../../config/redirects/p00-legacy.mjs";

type Redirect = { source: string; destination: string; permanent: boolean };

const of = (env: Record<string, string | undefined>) => allRedirects(env) as Redirect[];

describe("P6 redirects", () => {
  it("/weakness → /train/weakness: temporary (307) on dev, test, local and preview builds, permanent only in production", () => {
    for (const APP_ENV of ["dev", "test", undefined, "preview"]) {
      assert.deepEqual(
        of({ APP_ENV }).filter((r) => r.source === "/weakness"),
        [{ source: "/weakness", destination: "/train/weakness", permanent: false }],
        String(APP_ENV),
      );
    }
    assert.deepEqual(
      of({ APP_ENV: "production" }).filter((r) => r.source === "/weakness"),
      [{ source: "/weakness", destination: "/train/weakness", permanent: true }],
    );
  });

  it("runs after the P0 rules and the P3 rule, and matches only the exact path", () => {
    const all = of({ APP_ENV: "dev" });
    const i = all.findIndex((r) => r.source === "/weakness");
    assert.ok(i >= p00({ APP_ENV: "dev" }).length, "after every P0 rule (host canonicalisation first)");
    assert.ok(i > all.findIndex((r) => r.source === "/review"), "after P3's /review");
    assert.equal(all.some((r) => r.source.startsWith("/weakness/") || r.source.startsWith("/weakness:")), false);
    assert.equal(all.filter((r) => r.destination.startsWith("/train/weakness")).length, 1);
  });
});

// regression: weakness-page-flag-skipped (P6 FIX-1, plan §7.8): a request that renders only a page segment (a soft
// navigation, a crafted RSC request whose router state says the layout is mounted) skips the layouts, so every page
// under /train/weakness runs the weakness gate itself, never trainGate() alone before reading the payload.
describe("P6 /train/weakness pages repeat the weakness flag gate", () => {
  it("each page.tsx calls weaknessGate / weaknessPatternGate and no bare trainGate", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../../app/(app)/train/weakness/", import.meta.url));
    const pages = { "page.tsx": "weaknessGate()", "[pattern]/page.tsx": "weaknessPatternGate(" } as const;
    for (const [file, gate] of Object.entries(pages)) {
      const src = readFileSync(`${dir}${file}`, "utf8");
      assert.ok(src.includes(`await ${gate}`), `${file} calls ${gate}`);
      assert.ok(!/\btrainGate\(/.test(src), `${file} does not stop at trainGate()`);
    }
    const load = readFileSync(`${dir}load.ts`, "utf8");
    assert.match(load, /export async function weaknessGate\(\)[\s\S]*?if \(!\(await weaknessEnabled\(viewer\)\)\) redirect\("\/train"\)/);
  });
});
