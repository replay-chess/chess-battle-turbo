#!/usr/bin/env node
/* global process */
// Lint gate against the Phase 0 baseline (SPEC D19, 5.2; phase-01 plan 13.4 CI `verify`).
//
//   node apps/web/scripts/lint-delta.mjs <files...>   each file: warnings and errors <= its baseline count
//                                                     (files not in the baseline must have 0)
//   node apps/web/scripts/lint-delta.mjs --all        the whole app: every file as above, plus app totals
//                                                     <= baseline totals and 0 errors
//
// Runs from any directory: ESLint always runs in apps/web (this script's parent directory).
// File arguments are resolved against the current directory.
// Baseline: $LINT_BASELINE, else apps/web/.lint-baseline.json. Entries are { filePath, warningCount,
// errorCount, rules } with filePath relative to apps/web; files with no findings are left out.
// Exit 0 = within baseline, 1 = over baseline, 2 = usage or ESLint failure.
//
// Lowering the baseline (after fixing warnings) is welcome: regenerate it with --write-baseline.
// Raising it needs a reviewer's OK in the PR.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = process.env.LINT_BASELINE ?? path.join(web, ".lint-baseline.json");

const args = process.argv.slice(2);
const writeBaseline = args.includes("--write-baseline");
const all = args.includes("--all") || writeBaseline;
const files = args.filter((a) => !a.startsWith("--"));
if (!all && files.length === 0) {
  console.error("usage: lint-delta.mjs <files...> | --all | --write-baseline");
  process.exit(2);
}

/** Path relative to apps/web with forward slashes (baseline key). */
const rel = (p) => path.relative(web, path.resolve(web, p)).split(path.sep).join("/");
const count = (r) => ({ warnings: r.warningCount, errors: r.errorCount });

function runEslint(targets) {
  try {
    return execFileSync("npx", ["eslint", "-f", "json", ...targets], {
      cwd: web,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // ESLint exits 1 when it finds errors; the JSON is still on stdout.
    if (err.stdout && err.stdout.trim().startsWith("[")) return err.stdout;
    console.error(err.stderr || err.message);
    process.exit(2);
  }
}

const targets = all ? ["."] : files.map((f) => rel(path.resolve(process.cwd(), f)));
const results = JSON.parse(runEslint(targets));

if (writeBaseline) {
  const entries = results
    .filter((r) => r.warningCount || r.errorCount)
    .map((r) => ({
      filePath: rel(r.filePath),
      warningCount: r.warningCount,
      errorCount: r.errorCount,
      rules: [...new Set(r.messages.map((m) => m.ruleId ?? "eslint"))].sort(),
    }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
  writeFileSync(baselinePath, `${JSON.stringify(entries, null, 2)}\n`);
  const w = entries.reduce((n, r) => n + r.warningCount, 0);
  const e = entries.reduce((n, r) => n + r.errorCount, 0);
  console.log(`lint-delta: wrote ${path.relative(process.cwd(), baselinePath)} (${entries.length} files, ${w} warnings, ${e} errors)`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (err) {
  console.error(`cannot read baseline ${baselinePath}: ${err.message}`);
  process.exit(2);
}
const base = new Map(baseline.map((r) => [rel(r.filePath), count(r)]));

const over = [];
let totalW = 0;
let totalE = 0;
for (const r of results) {
  const file = rel(r.filePath);
  const now = count(r);
  totalW += now.warnings;
  totalE += now.errors;
  const was = base.get(file) ?? { warnings: 0, errors: 0 };
  if (now.warnings > was.warnings || now.errors > was.errors) {
    over.push({ file, was, now, messages: r.messages.map((m) => `${m.line}:${m.column} ${m.ruleId ?? "eslint"} ${m.message}`) });
  }
}

for (const o of over) {
  console.log(`OVER  ${o.file}  warnings ${o.was.warnings} -> ${o.now.warnings}, errors ${o.was.errors} -> ${o.now.errors}`);
  for (const m of o.messages) console.log(`      ${m}`);
}

let failed = over.length > 0;
if (all) {
  const baseW = baseline.reduce((n, r) => n + r.warningCount, 0);
  console.log(`app totals: ${totalW} warnings (baseline ${baseW}), ${totalE} errors`);
  if (totalW > baseW || totalE > 0) failed = true;
}
console.log(failed ? `lint-delta: FAIL (${over.length} file(s) over baseline)` : `lint-delta: OK (${results.length} file(s) within baseline)`);
process.exit(failed ? 1 : 0);
