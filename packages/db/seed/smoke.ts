// Phase 3 smoke seed (phase-03 plan §6.9 row "smoke-26", §12.8): the dedicated `smoke` member and its 26-ply game
// that the post-deploy real-engine smoke (`apps/analysis-worker/scripts/smoke.ts`, WP-C) analyses on the dev box.
// The smoke script resets the game before each run (deletes its game_analyses / player_reviews rows and its job,
// sets analysisStatus NONE), so this seed only makes sure the member and the game exist with this definition: a
// re-run does not undo a smoke result.
//
//   pnpm --filter @repo/db exec tsx seed/smoke.ts            # dry run
//   pnpm --filter @repo/db exec tsx seed/smoke.ts --apply
//
// The game ref is fixed (SMOKE_GAME_REF), the same on every database, so the smoke script needs no lookup.
import type { PrismaClient } from "#generated";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { gameAnalysisInput } from "@repo/chess-analysis/fixtures/review-inputs";
import { Prisma } from "#generated";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import { buildFixture, seededRef, type SeedFixture, type SeedMember } from "./builders";
import { checkTripwire, isEntryPoint, parseFlags, reportFailure, resolveWriteTarget } from "./target";
import { ensureSeedUser, fixtureAction, placeholderMember, readFixtureStates, writeFixtures, type SeedUserSpec } from "./writer";

export const SMOKE_SEED_TAG = "smoke";
/** The dedicated smoke member (synthetic: no Clerk identity). */
export const SMOKE_USER = {
  email: "smoke-p3@replaychess.local",
  code: "SEED_P3_SMOKE",
  googleId: "seed_p3_smoke",
  name: "smoke_p3",
  rating: null,
} as const satisfies SeedUserSpec;
export const SMOKE_GAME_KEY = "smoke-26";
export const SMOKE_SCOPE = "smoke";
/** `games."referenceId"` of the smoke game on every database. */
export const SMOKE_GAME_REF = seededRef(SMOKE_GAME_KEY, SMOKE_SCOPE);
export const SMOKE_PLIES = 26;

/** The smoke game: the first 26 plies of the design GAME against Engine 1200 (Rapid 10+0), resigned; NONE. */
export function smokeFixture(member: SeedMember, botUserId: bigint | null): SeedFixture {
  return buildFixture({
    key: SMOKE_GAME_KEY,
    scope: SMOKE_SCOPE,
    member,
    memberColor: "w",
    opponent: { kind: "bot", elo: 1200 },
    botUserId,
    mode: "BOT",
    startFen: INITIAL_FEN,
    moves: gameAnalysisInput().moves.slice(0, SMOKE_PLIES),
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome: "BLACK",
    method: "RESIGNATION",
    completedAt: new Date("2026-11-11T00:00:00.000Z"),
    analysis: { kind: "none" },
    tag: SMOKE_SEED_TAG,
  });
}

export interface SmokeSeedResult {
  userCreated: boolean;
  action: "insert" | "update" | "unchanged";
  reason?: string;
  ref: string;
}

export async function runSmokeSeed(db: PrismaClient, opts: { apply: boolean }): Promise<SmokeSeedResult> {
  const { member, created } = await ensureSeedUser(db, SMOKE_USER, opts.apply);
  const bot = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE code = 'CHESS_BOT_001' LIMIT 1`);
  const fixture = smokeFixture(member ?? placeholderMember(SMOKE_USER), bot[0]?.id ?? null);
  const stored = await readFixtureStates(db, [fixture.game.ref]);
  // Loose: the smoke script owns the analysis state of this game.
  const a = fixtureAction(fixture, stored.get(fixture.game.ref), { loose: true });
  if (opts.apply && a.action !== "unchanged") await writeFixtures(db, [fixture]);
  return { userCreated: created, action: a.action, ...(a.action === "update" ? { reason: a.reason } : {}), ref: fixture.game.ref };
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2), { booleans: ["--apply"], values: [] });
  const apply = flags.has("--apply");
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const r = await runSmokeSeed(db, { apply });
    console.log(`user     ${SMOKE_USER.email}  ${r.userCreated ? (apply ? "created" : "would be created") : "exists"}`);
    console.log(`game     ${SMOKE_GAME_KEY}  ${r.action}${r.reason ? ` (${r.reason})` : ""}  /review/${r.ref}`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("seed/smoke", err));
