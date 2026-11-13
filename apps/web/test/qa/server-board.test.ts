// Regression (INTEGRATE-2, phase-03): /review/[ref] answered 500 on every hard load because its route loading state,
// a server component, rendered the interactive Board with function props (`dests`, `onMove`), which React cannot pass
// from a server component to a client one ("Functions cannot be passed directly to Client Components"). The demo
// routes never showed it (their screens are client components). Server modules may use the static MiniBoard; the
// interactive Board is rendered only from client modules (`"use client"`).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOTS = ["app", "features", "components"];
const BOARD_IMPORT = /from\s+["']@\/components\/board\/Board["']|import\s*\{[^}]*\bBoard\b[^}]*\}\s*from\s+["']@\/components\/board["']/;

function tsxFiles(rel: string): string[] {
  return readdirSync(path.join(WEB, rel), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.includes(".test."))
    .map((e) => path.relative(WEB, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

function isClientModule(source: string): boolean {
  const first = source.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/, "").trimStart();
  return first.startsWith('"use client"') || first.startsWith("'use client'");
}

test("no server component imports the interactive Board (it takes function props)", () => {
  const offenders = ROOTS.flatMap(tsxFiles).filter((f) => {
    const source = readFileSync(path.join(WEB, f), "utf8");
    return BOARD_IMPORT.test(source) && !isClientModule(source);
  });
  assert.deepEqual(offenders, [], `server modules importing the interactive Board: ${offenders.join(", ")}`);
});

// The review's route loading state (the first regression's file) is gone: /game/[ref] and the /review/[ref] pages
// render their screen in the document's shell, with no Suspense boundary around it (a streamed segment left a hidden
// second copy of the screen when React client-rendered the boundary first: bot-resume-starved-frames.spec.ts,
// review-document.spec.ts). A loading.tsx in those segments would bring the boundary back.
test("the game and review screens have no route loading boundary", () => {
  const segments = ["app/(app)/game/[ref]", "app/(app)/review/[ref]", "app/(app)/review/[ref]/complete", "app/(app)/review/[ref]/legend", "app/(app)/review/[ref]/share"];
  const found = segments.flatMap((dir) => readdirSync(path.join(WEB, dir)).filter((f) => /^loading\.(tsx|ts|jsx|js)$/.test(f)).map((f) => `${dir}/${f}`));
  assert.deepEqual(found, []);
});
