#!/usr/bin/env node
// Orphan-test guard (phase-01 plan §12.0, CT X1).
//
// Lists every test file in the repo (tracked plus new untracked ones, so it also
// works before a commit) and fails when no `test*` script of the file's
// workspace package would run it. Globs are read from the package's
// `tsx --test` / `node --test` scripts and matched with node:path matchesGlob.
//
//   node scripts/qa/check-test-globs.mjs [--verbose]
//
// Exit 0 = every test file is covered; 1 = orphans (listed); 2 = setup error.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERBOSE = process.argv.includes("--verbose");
const TEST_FILE = ["*.test.ts", "*.test.tsx", "*.test.mts", "*.test.js", "*.test.mjs"];

if (typeof path.matchesGlob !== "function") {
  console.error("check-test-globs: node:path matchesGlob is missing; use Node 22.5 or newer");
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** Splits a shell command into words, keeping quoted strings together. */
export function shellWords(cmd) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) words.push(m[1] ?? m[2] ?? m[3]);
  return words;
}

/** Test globs of one script: the non-flag words after `--test` up to the next `&&`, `;` or `|`. */
export function globsOfScript(cmd) {
  const globs = [];
  const words = shellWords(cmd);
  let inTest = false;
  for (const w of words) {
    if (w === "&&" || w === ";" || w === "|" || w === "||") {
      inTest = false;
      continue;
    }
    if (w === "--test") {
      inTest = true;
      continue;
    }
    if (inTest && !w.startsWith("-")) globs.push(w);
  }
  return globs;
}

function workspacePackages() {
  const manifests = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", "package.json", "*/package.json"])
    .filter((f) => !f.includes("node_modules/"));
  return manifests.map((f) => {
    const dir = path.posix.dirname(f) === "." ? "" : path.posix.dirname(f);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));
    const scripts = Object.entries(pkg.scripts ?? {}).filter(([name]) => name === "test" || name.startsWith("test:"));
    const globs = scripts.flatMap(([name, cmd]) => globsOfScript(cmd).map((g) => ({ script: name, glob: g })));
    return { dir, name: pkg.name ?? (dir || "(root)"), globs };
  });
}

function main() {
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...TEST_FILE]).filter(
    (f) => !f.includes("node_modules/") && existsSync(path.join(ROOT, f)),
  );
  const packages = workspacePackages().sort((a, b) => b.dir.length - a.dir.length);
  const orphans = [];
  let covered = 0;
  for (const file of files) {
    const pkg = packages.find((p) => p.dir === "" || file.startsWith(`${p.dir}/`));
    const rel = pkg && pkg.dir ? file.slice(pkg.dir.length + 1) : file;
    const hit = pkg?.globs.find((g) => path.matchesGlob(rel, g.glob));
    if (hit) {
      covered++;
      if (VERBOSE) console.log(`ok  ${file}  (${pkg.name} ${hit.script}: ${hit.glob})`);
    } else {
      orphans.push(`${file}  (package ${pkg?.name ?? "none"}; globs: ${pkg?.globs.map((g) => g.glob).join(" ") || "no test script"})`);
    }
  }
  if (orphans.length) {
    console.error(`check-test-globs: ${orphans.length} test file(s) no script runs:`);
    for (const o of orphans) console.error(`  ${o}`);
    console.error("Fix: move the file under a globbed folder, or add the glob to the package's test script.");
    process.exit(1);
  }
  console.log(`check-test-globs: ${covered} test file(s), all covered`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
