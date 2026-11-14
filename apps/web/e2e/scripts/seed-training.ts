/**
 * Phase 5 dev seed (phase-05 plan 6.7 "Dev seed"): puts one of the plan's training states on a pool user or the
 * persona user S, through the persona tool (scripts/dev/personas.ts), so it carries the same guards and the same writer
 * as the leased e2e personas:
 *
 *   member     41 bank positions from their games, 4 due today, streak 4 (best 9), mastery bars, rating 1512
 *   caughtup   today's 10 reviewed (cap reached), nothing due, Tomorrow 6 · day 2 3 · day 3 5 · next week 9
 *   trial      a trial member while a Chess.com import runs (212 / 480) with 6 due cards
 *   new        no games, no bank, no linked account
 *   perfect    member plus one completed five-item session, all first try, crossing forks 70 %
 *
 * Any lease-pool name (bank-member, bank-empty, …) works too. Training state is generated relative to now, so "due
 * today" is due on the day the seed runs.
 *
 *   cd apps/web
 *   npx tsx e2e/scripts/seed-training.ts --list
 *   npx tsx e2e/scripts/seed-training.ts --reset S --persona member [--dry-run]
 *   npx tsx e2e/scripts/seed-training.ts --reset E2E_POOL_05 --persona caughtup
 *
 * Guards (all from the persona tool, before any write): the target is a pool user or S (never A–R, the admin or a real
 * user); DIRECT_URL from the shell or .env.development.local, never .env.local; the host is the Neon dev endpoint or a
 * local Postgres; the user-count tripwire. Nothing runs against production.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P05_DEV_SEED_NAMES, P05_PERSONA_STATES } from "@repo/db/seed/p05-persona-states";
import { SeedGuardError } from "@repo/db/seed-guards";
import { resetPersona } from "../../scripts/dev/personas";

/** The plan's dev-seed names and every registered P5 state, resolved to the persona tool's name. */
export function trainingPersonaName(name: string): string {
  const mapped = (P05_DEV_SEED_NAMES as Record<string, string>)[name];
  if (mapped) return mapped;
  if (name in P05_PERSONA_STATES) return name;
  throw new SeedGuardError(
    `unknown training persona "${name}" (dev seed: ${Object.keys(P05_DEV_SEED_NAMES).join(", ")}; pool: ${Object.keys(P05_PERSONA_STATES).join(", ")})`,
  );
}

export function parseSeedArgs(argv: string[]): { reset?: string; persona?: string; dryRun: boolean; list: boolean } {
  const out: { reset?: string; persona?: string; dryRun: boolean; list: boolean } = { dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = argv[++i];
    else if (a === "--persona") out.persona = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list") out.list = true;
    else throw new SeedGuardError(`unknown argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseSeedArgs(process.argv.slice(2));
  if (args.list) {
    for (const [plan, name] of Object.entries(P05_DEV_SEED_NAMES)) console.log(`${plan.padEnd(10)} → ${name.padEnd(14)} ${P05_PERSONA_STATES[name]!.description}`);
    for (const s of Object.values(P05_PERSONA_STATES)) if (!s.name.startsWith("dev-")) console.log(`${s.name.padEnd(25)} ${s.description}`);
    return;
  }
  if (!args.reset || !args.persona) {
    throw new SeedGuardError("usage: seed-training.ts --reset <E2E_POOL_NN|S> --persona <member|caughtup|trial|new|perfect|pool name> [--dry-run] | --list");
  }
  await resetPersona(args.reset, trainingPersonaName(args.persona), { dryRun: args.dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof SeedGuardError ? `[seed-training] ${err.message}` : err);
    process.exit(1);
  });
}
