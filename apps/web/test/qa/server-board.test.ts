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

test("the review's route loading state renders its board through a client module", () => {
  const loading = readFileSync(path.join(WEB, "app/(app)/review/[ref]/loading.tsx"), "utf8");
  assert.equal(isClientModule(loading), false, "loading.tsx stays a server component");
  assert.doesNotMatch(loading, BOARD_IMPORT);
  assert.match(loading, /LoadingBoard/);
  assert.equal(isClientModule(readFileSync(path.join(WEB, "features/review/components/LoadingBoard.tsx"), "utf8")), true);
});
