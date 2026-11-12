// The licence gate of the grading stack (phase-03 plan §8 clean-room rules, §11.4, task A7; LIC-4): no AGPL or GPL
// npm dependency in the production tree of the grading library or the analysis worker.
//
//   tsx scripts/license-check.ts [<pnpm filter> …]        (default: @repo/chess-analysis analysis-worker)
//
// `license-checker --start <pkg>` only sees a package's direct dependencies under pnpm (the `.pnpm` store is not
// walked; P3 interface-check §1), so the gate reads `pnpm licenses list --prod --json --filter <pkg>`, which resolves
// the whole production tree. It fails on any licence naming AGPL or GPL (LGPL is not matched), and on packages whose
// licence is unknown, so an unlabelled dependency cannot slip through. The Stockfish binary (GPLv3) is not an npm
// dependency: it is a separate asset of the worker image, documented in the worker's NOTICE (plan §11.4).

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FILTERS = ["@repo/chess-analysis", "analysis-worker"] as const;
/** AGPL and GPL in any version or form ("GPL-3.0-only", "AGPL-3.0-or-later", "(MIT OR GPL-2.0)"); LGPL is allowed. */
export const FORBIDDEN = /\bA?GPL\b|\bA?GPL-/i;
const UNKNOWN = /^(unknown|unlicensed|see license in .*)$/i;

type LicensesJson = Record<string, { name: string; versions: string[]; license?: string }[]>;

export interface Finding {
  name: string;
  versions: string[];
  license: string;
  reason: "forbidden" | "unknown";
}

/** The packages of one `pnpm licenses list --json` result that break the gate. */
export function findings(json: LicensesJson): Finding[] {
  const out: Finding[] = [];
  for (const [group, pkgs] of Object.entries(json)) {
    for (const p of pkgs) {
      const license = p.license ?? group;
      if (FORBIDDEN.test(license)) out.push({ name: p.name, versions: p.versions, license, reason: "forbidden" });
      else if (UNKNOWN.test(license.trim()))
        out.push({ name: p.name, versions: p.versions, license, reason: "unknown" });
    }
  }
  return out;
}

/** Counts per licence (for the log line). */
export function summary(json: LicensesJson): string {
  return Object.entries(json)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(", ");
}

function listLicenses(filter: string, cwd: string): LicensesJson {
  const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json", "--filter", filter], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = raw.trim();
  return text === "" ? {} : (JSON.parse(text) as LicensesJson);
}

function main(argv: readonly string[]): number {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const filters = argv.length ? argv : DEFAULT_FILTERS;
  let bad = 0;
  for (const filter of filters) {
    const json = listLicenses(filter, repo);
    const found = findings(json);
    console.log(`license-check ${filter}: ${summary(json) || "no production dependencies"}`);
    for (const f of found) console.log(`  ${f.reason}: ${f.name}@${f.versions.join(",")} (${f.license})`);
    bad += found.length;
  }
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
