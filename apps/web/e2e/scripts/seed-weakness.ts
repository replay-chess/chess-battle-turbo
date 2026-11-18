/**
 * Phase 6 dev seed (phase-06 plan §6.8 "Dev seed personas"): puts one of the plan's Weakness Profile states on a pool
 * user or the persona user S, through the persona tool (scripts/dev/personas.ts), so it carries the same guards and the
 * same writer as the leased e2e personas. Every state is real data: CC0 Lichess games written as the user's finished
 * games, graded by the RUNNING analysis worker (on the Neon dev branch: the deployed dev worker with Stockfish, about
 * 10–20 s a game the first time; later resets keep graded games under 6 h old), the Mistake Bank J1 extracts and the
 * profile RECOMPUTE_WEAKNESS writes (packages/db/seed/p06-personas.ts):
 *
 *   new          no games                                                     insufficient, 0 of 20
 *   trial        a trialist with 14 graded rapid/blitz games                  insufficient with preliminary patterns
 *   member       54 graded blitz/rapid games, the bank, a READY profile        profile, all tabs, drill, the Train dot
 *   weakcompute  25 games, the 12 newest graded, 13 queued two years ahead     computing at about half
 *   weakfail     22 graded games, the recompute dead on its last attempt       failed, Retry
 *   bullet       20 bullet + 6 blitz graded games                             insufficient + "Include bullet games"
 *   noclock      30 graded games without clocks                               profile without the Clock tab
 *
 * Any lease-pool name (weak-member, weak-orphaned, …) works too. `--step weak-computing:ready` lets a `weakcompute`
 * user's queued analyses run (the build finishes and the dev worker pushes `weakness:ready`).
 *
 *   cd apps/web
 *   npx tsx e2e/scripts/seed-weakness.ts --list
 *   npx tsx e2e/scripts/seed-weakness.ts --reset S --persona member [--dry-run]
 *   npx tsx e2e/scripts/seed-weakness.ts --reset E2E_POOL_05 --persona weakcompute
 *   npx tsx e2e/scripts/seed-weakness.ts --reset E2E_POOL_05 --step weak-computing:ready
 *
 * Guards (all from the persona tool, before any write): the target is a pool user or S (never A–R, the admin or a real
 * user); DIRECT_URL from the shell or .env.development.local, never .env.local; the host is the Neon dev endpoint or a
 * local Postgres; the user-count tripwire. The worker is reached through ANALYSIS_WORKER_URL with the web's key ring
 * (INTERNAL_API_SECRET with `webwk`). Nothing runs against production.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P06_DEV_SEED_NAMES, P06_PERSONA_STATES } from "@repo/db/seed/p06-persona-states";
import { SeedGuardError } from "@repo/db/seed-guards";
import { resetPersona, runPersonaStep } from "../../scripts/dev/personas";

/** The plan's dev-seed names and every registered P6 state, resolved to the persona tool's name. */
export function weaknessPersonaName(name: string): string {
  const mapped = (P06_DEV_SEED_NAMES as Record<string, string>)[name];
  if (mapped) return mapped;
  if (name in P06_PERSONA_STATES) return name;
  throw new SeedGuardError(
    `unknown weakness persona "${name}" (dev seed: ${Object.keys(P06_DEV_SEED_NAMES).join(", ")}; pool: ${Object.keys(P06_PERSONA_STATES).join(", ")})`,
  );
}

export function parseSeedArgs(argv: string[]): { reset?: string; persona?: string; step?: string; dryRun: boolean; list: boolean } {
  const out: { reset?: string; persona?: string; step?: string; dryRun: boolean; list: boolean } = { dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = argv[++i];
    else if (a === "--persona") out.persona = argv[++i];
    else if (a === "--step") out.step = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list") out.list = true;
    else throw new SeedGuardError(`unknown argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.list) {
    for (const [plan, name] of Object.entries(P06_DEV_SEED_NAMES)) console.log(`${plan.padEnd(12)} → ${name.padEnd(17)} ${P06_PERSONA_STATES[name]!.description}`);
    for (const s of Object.values(P06_PERSONA_STATES)) if (!s.name.startsWith("dev-")) console.log(`${s.name.padEnd(30)} ${s.description}`);
    return;
  }
  if (args.reset && args.step) {
    await runPersonaStep(args.reset, args.step);
    return;
  }
  if (!args.reset || !args.persona) {
    throw new SeedGuardError(
      "usage: seed-weakness.ts --reset <E2E_POOL_NN|S> --persona <new|trial|member|weakcompute|weakfail|bullet|noclock|pool name> [--dry-run] | --reset <…> --step weak-computing:ready | --list",
    );
  }
  await resetPersona(args.reset, weaknessPersonaName(args.persona), { dryRun: args.dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof SeedGuardError ? `[seed-weakness] ${err.message}` : err);
    process.exit(1);
  });
}
