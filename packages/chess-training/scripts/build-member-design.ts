// Writes the golden fixtures of the weakness engine (phase-06 plan §12.1 compute.golden): `member-design.json` from
// test/member-design.ts, and — only with `--update`, after a review of the diff — `member-design.golden.json` (the
// expected `computeWeakness()` output with the synthetic baseline) and its no-band variant (FIX-4). Laptop / CI only (Node built-ins allowed).
//   pnpm --filter @repo/chess-training exec tsx scripts/build-member-design.ts [--update]
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBaseline } from "../baselines/load";
import { computeWeakness } from "../src/weakness/compute";
import { fromJson } from "../test/gen";
import { buildMemberDesign, noBandGames } from "../test/member-design";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/weakness");
const md = buildMemberDesign();
writeFileSync(resolve(dir, "member-design.json"), `${JSON.stringify(md, null, 1)}\n`);
console.log(`wrote member-design.json (${md.games.length} game sides)`);
if (process.argv.includes("--update")) {
  const out = computeWeakness(md.games.map(fromJson), loadBaseline("v0-synthetic"), {
    now: new Date(md.now),
    timeZone: md.timeZone,
    profile: md.profile,
    ratingBand: md.ratingBand,
  });
  writeFileSync(resolve(dir, "member-design.golden.json"), `${JSON.stringify(out, null, 1)}\n`);
  console.log("wrote member-design.golden.json (review the diff before committing)");
  // FIX-4: the demo's no-band state, from the same engine (no rated games, no onboarding band).
  const noBand = computeWeakness(noBandGames(md.games.map(fromJson)), loadBaseline("v0-synthetic"), {
    now: new Date(md.now),
    timeZone: md.timeZone,
    profile: md.profile,
    ratingBand: null,
  });
  writeFileSync(resolve(dir, "member-design.no-band.golden.json"), `${JSON.stringify(noBand, null, 1)}\n`);
  console.log("wrote member-design.no-band.golden.json (review the diff before committing)");
}
