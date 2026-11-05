#!/usr/bin/env node
// Cross-phase ownership check (phase-01 plan §13.5, P1-16; critique-feasibility §7).
//
// Lists every changed file that another ACTIVE phase owns according to REPO/OWNERS.yml.
//
//   node scripts/qa/check-owners.mjs [--report] [--base <sha>] [--head <sha>] [--phase <n>] [--labels a,b]
//
// --base/--head  diff range (CI: the PR base and head, or the push's before/after). Without --base the
//                working tree is compared with HEAD, untracked files included (local use).
// --phase        the phase this change belongs to; default: REPO/docs/qa/phase.txt.
// --labels       the PR's labels; `owner-ok:pNN` accepts touching phase pNN's files.
// --report       never fail (P1: report-only). Without it the check blocks once the current phase is
//                >= OWNERS.yml `enforce_from_phase` (P4).
// The markdown report goes to stdout and to $GITHUB_STEP_SUMMARY when set.
// Exit 0 = nothing to block, 1 = cross-phase touches without a label (enforcing), 2 = setup error.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Parses the YAML subset OWNERS.yml uses: nested maps by indentation, `- scalar` lists, `#` comments,
 * plain or quoted scalars. Anything else (flow collections, anchors, multi-line strings) is an error.
 */
export function parseOwnersYaml(text) {
  const lines = [];
  text.split("\n").forEach((raw, i) => {
    const noComment = raw.replace(/(^|\s)#.*$/, "");
    if (!noComment.trim()) return;
    if (/\t/.test(raw.match(/^\s*/)[0])) throw new Error(`line ${i + 1}: tabs are not allowed`);
    lines.push({ n: i + 1, indent: raw.match(/^ */)[0].length, text: noComment.trim() });
  });
  const scalar = (s) => {
    const q = s.match(/^(["'])(.*)\1$/);
    if (q) return q[2];
    if (/^-?\d+$/.test(s)) return Number(s);
    if (s === "true" || s === "false") return s === "true";
    if (/^[[{&*|>]/.test(s)) throw new Error(`unsupported YAML value: ${s}`);
    return s;
  };
  let i = 0;
  function block(indent) {
    if (i >= lines.length || lines[i].indent < indent) return null;
    const isList = lines[i].text.startsWith("- ");
    const out = isList ? [] : {};
    while (i < lines.length && lines[i].indent >= indent) {
      const line = lines[i];
      if (line.indent !== indent) throw new Error(`line ${line.n}: unexpected indentation`);
      if (isList) {
        if (!line.text.startsWith("- ")) throw new Error(`line ${line.n}: expected a list item`);
        out.push(scalar(line.text.slice(2).trim()));
        i++;
        continue;
      }
      const m = line.text.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`line ${line.n}: expected "key: value"`);
      i++;
      if (m[2] !== undefined && m[2] !== "") out[m[1]] = scalar(m[2]);
      else out[m[1]] = block(lines[i]?.indent > indent ? lines[i].indent : indent + 1) ?? null;
    }
    return out;
  }
  const doc = block(0);
  if (i < lines.length) throw new Error(`line ${lines[i].n}: could not parse`);
  return doc ?? {};
}

export function loadOwners(file = path.join(ROOT, "OWNERS.yml")) {
  const doc = parseOwnersYaml(readFileSync(file, "utf8"));
  const phases = Object.entries(doc.phases ?? {}).map(([id, p]) => {
    if (!/^p\d{2}$/.test(id)) throw new Error(`OWNERS.yml: phase id ${id} must look like p01`);
    if (!["planned", "active", "done"].includes(p?.status)) throw new Error(`OWNERS.yml: ${id}.status must be planned, active or done`);
    if (!Array.isArray(p.globs) || p.globs.length === 0) throw new Error(`OWNERS.yml: ${id}.globs must be a non-empty list`);
    return { id, num: Number(id.slice(1)), name: p.name ?? id, status: p.status, weeks: p.weeks, globs: p.globs };
  });
  const shared = (doc.shared_add_only ?? []).map((d) => (d.endsWith("/") ? d : `${d}/`));
  return { enforceFrom: Number(doc.enforce_from_phase ?? 4), phases, shared };
}

/** Phases whose globs match `file`. */
export function ownersOf(file, phases) {
  return phases.filter((p) => p.globs.some((g) => path.matchesGlob(file, g)));
}

/**
 * Classifies changed files. `changes` = [{ file, status }] with git's status letter (A, M, D, R…).
 * Returns { conflicts, accepted, registryAdds, barrels } for the phase `current`.
 */
export function classify(changes, owners, current, labels = []) {
  const active = owners.phases.filter((p) => p.status === "active");
  const accepted = [];
  const conflicts = [];
  const registryAdds = [];
  const barrels = [];
  for (const { file, status } of changes) {
    const sharedDir = owners.shared.find((d) => file.startsWith(d));
    if (sharedDir && status === "A") {
      registryAdds.push({ file });
      continue;
    }
    if (sharedDir && path.basename(file) === "index.ts") {
      barrels.push({ file });
      continue;
    }
    const others = ownersOf(file, active).filter((p) => p.num !== current);
    if (others.length === 0) continue;
    for (const p of others) {
      const row = { file, status, owner: p.id, ownerName: p.name };
      if (labels.includes(`owner-ok:${p.id}`)) accepted.push(row);
      else conflicts.push(row);
    }
  }
  return { conflicts, accepted, registryAdds, barrels };
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function changedFiles(base, head) {
  const parse = (out) =>
    out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [status, ...paths] = l.split("\t");
        return { status: status[0], file: paths[paths.length - 1] };
      });
  if (base) return parse(git(["diff", "--name-status", "--no-renames", `${base}...${head || "HEAD"}`]));
  const tracked = parse(git(["diff", "--name-status", "--no-renames", "HEAD"]));
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((file) => ({ status: "A", file }));
  return [...tracked, ...untracked];
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reportOnly = args.includes("--report");
  const zeroSha = /^0+$/;
  let base = opt("--base") || undefined;
  if (base && zeroSha.test(base)) base = undefined; // first push of a branch
  const head = opt("--head") || undefined;
  const labels = (opt("--labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  let owners;
  try {
    owners = loadOwners();
  } catch (err) {
    console.error(`check-owners: ${err.message}`);
    process.exit(2);
  }
  const phaseFile = path.join(ROOT, "docs/qa/phase.txt");
  const current = Number(opt("--phase") ?? (existsSync(phaseFile) ? readFileSync(phaseFile, "utf8").trim() : "NaN"));
  if (!Number.isInteger(current)) {
    console.error("check-owners: no current phase (pass --phase or write docs/qa/phase.txt)");
    process.exit(2);
  }

  let changes;
  try {
    changes = changedFiles(base, head);
  } catch (err) {
    console.error(`check-owners: git diff failed (${err.message.split("\n")[0]})`);
    process.exit(2);
  }
  const { conflicts, accepted, registryAdds, barrels } = classify(changes, owners, current, labels);
  const enforcing = !reportOnly && current >= owners.enforceFrom;
  const active = owners.phases.filter((p) => p.status === "active").map((p) => p.id);
  const unowned = changes.filter((c) => ownersOf(c.file, owners.phases).length === 0).length;

  const range = base ? `${base.slice(0, 7)}...${(head ?? "HEAD").slice(0, 7)}` : "working tree vs HEAD";
  const lines = [
    "### OWNERS report (phase-01 plan §13.5)",
    "",
    `Current phase **p${String(current).padStart(2, "0")}**; active phases: ${active.join(", ") || "none"}; ${range}; ${changes.length} changed file(s), ${unowned} owned by no phase.`,
    `Mode: ${enforcing ? "**blocking**" : `report-only (blocking from p${String(owners.enforceFrom).padStart(2, "0")})`}.`,
    "",
  ];
  if (conflicts.length) {
    lines.push(`**Touches another active phase's files (${conflicts.length})** — needs the label \`owner-ok:<phase>\`:`, "");
    for (const c of conflicts) lines.push(`- \`${c.file}\` (${c.status}) — owned by ${c.owner} (${c.ownerName})`);
    lines.push("");
  } else {
    lines.push("No changed file belongs to another active phase.", "");
  }
  if (accepted.length) {
    lines.push(`Accepted by label (${accepted.length}):`, "");
    for (const c of accepted) lines.push(`- \`${c.file}\` — ${c.owner}`);
    lines.push("");
  }
  if (registryAdds.length) lines.push(`New files in shared registries (always allowed): ${registryAdds.map((r) => `\`${r.file}\``).join(", ")}`, "");
  if (barrels.length) lines.push(`Registry barrels edited (append one line per phase): ${barrels.map((r) => `\`${r.file}\``).join(", ")}`, "");
  const report = lines.join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    } catch {
      // the summary is a convenience
    }
  }
  process.exit(enforcing && conflicts.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
