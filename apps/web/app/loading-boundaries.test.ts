// A route's loading.tsx is a Suspense boundary around its page AND every nested segment (their layouts and pages).
// A nested segment rendered inside it streams the wrong skeleton first, and a redirect() it throws after that
// skeleton streamed is the P2 FIX-A crash class (T17). Regression (P5 INTEGRATE-2): /train's hub skeleton wrapped the
// runners, the session redirect page and the summary, and /train/bank's list skeleton wrapped the bank drill. The hub
// and the bank list now keep their loading.tsx inside route groups (`train/(hub)`, `train/bank/(list)`), so each
// skeleton wraps its own page only.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = path.dirname(fileURLToPath(import.meta.url));

/**
 * Boundaries that knowingly wrap nested pages, with the reason. P3's review shell: the skeleton of /review/[ref] is
 * also right for its complete, share and legend pages, which do no redirect after streaming.
 */
const ALLOWED = new Set(["(app)/review/[ref]"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(path.relative(APP, full).split(path.sep).join("/"));
  }
  return out;
}

const files = walk(APP);
const pagesUnder = (dir: string) => files.filter((f) => f.startsWith(`${dir}/`) && f.endsWith("/page.tsx") && f !== `${dir}/page.tsx`);

test("a loading.tsx wraps only its own page, never a nested segment's layout or page", () => {
  const offenders = files
    .filter((f) => f.endsWith("/loading.tsx"))
    .map((f) => path.posix.dirname(f))
    .filter((dir) => !ALLOWED.has(dir))
    .map((dir) => ({ dir, nested: pagesUnder(dir) }))
    .filter((o) => o.nested.length > 0);
  assert.deepEqual(offenders, [], "move the page and its loading.tsx into a route group, e.g. train/(hub)/");
});

test("the P5 hub and bank list skeletons sit in their route groups next to their pages", () => {
  for (const dir of ["(app)/train/(hub)", "(app)/train/bank/(list)"]) {
    assert.ok(files.includes(`${dir}/page.tsx`), `${dir}/page.tsx`);
    assert.ok(files.includes(`${dir}/loading.tsx`), `${dir}/loading.tsx`);
  }
  assert.ok(!files.includes("(app)/train/loading.tsx"), "no /train-wide skeleton over the runners and the summary");
  assert.ok(!files.includes("(app)/train/bank/loading.tsx"), "no bank-wide skeleton over the bank drill");
});
