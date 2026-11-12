// Phase 3 throughput-bench seed (phase-03 plan §12.7 "Worker throughput: WK/scripts/bench.ts on the dev VM: enqueue 60
// fixture games at BACKLOG"; §9.1 worker throughput and co-location; FIX-1). The dedicated synthetic `bench` member
// and its 60 finished bot games, average 60 plies: the first 60 plies of the 30 Lichess oracle games (fewer when the
// game is shorter), and 30 seeded pseudo-random 60-ply games from the initial position (distinct positions, so the
// eval cache does not make the run look faster than real traffic). Every game is NONE: the throughput tool
// (`apps/analysis-worker/scripts/worker-flood.ts`) resets and enqueues them itself, so a re-run needs no reseed.
//
//   pnpm --filter @repo/db exec tsx seed/bench.ts            # dry run
//   pnpm --filter @repo/db exec tsx seed/bench.ts --apply
//
// The games carry `gameData.p3Seed = "bench"`; the fallback backfill (scripts/backfill/enqueue-analysis.ts) skips seeded
// games, so they are analysed only by the bench. Dev branch or a local Postgres only (seed/target.ts guards).
import type { PrismaClient } from "#generated";
import { Prisma } from "#generated";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { loadOracleGames, oracleReplay } from "@repo/chess-analysis/fixtures/oracle";
import { Chess } from "chess.js";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import { buildFixture, type SeedFixture, type SeedMember } from "./builders";
import { checkTripwire, isEntryPoint, parseFlags, reportFailure, resolveWriteTarget } from "./target";
import { ensureSeedUser, fixtureAction, placeholderMember, readFixtureStates, writeFixtures, type SeedUserSpec } from "./writer";

export const BENCH_SEED_TAG = "bench";
export const BENCH_SCOPE = "bench";
export const BENCH_GAMES = 60;
export const BENCH_PLIES = 60;
/** The dedicated bench member (synthetic: no Clerk identity, never signs in). */
export const BENCH_USER = {
  email: "bench-p3@replaychess.local",
  code: "SEED_P3_BENCH",
  googleId: "seed_p3_bench",
  name: "bench_p3",
  rating: null,
} as const satisfies SeedUserSpec;

/** mulberry32: the same walk on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A legal pseudo-random game of up to `plies` plies (it stops early at a mate or a draw), as UCI. */
export function randomGame(seed: number, plies: number): string[] {
  const chess = new Chess();
  const next = prng(seed);
  const out: string[] = [];
  while (out.length < plies && !chess.isGameOver()) {
    const moves = chess.moves({ verbose: true });
    const m = moves[Math.floor(next() * moves.length)]!;
    chess.move(m);
    out.push(`${m.from}${m.to}${m.promotion ?? ""}`);
  }
  return out;
}

/** The bench games' move lists: 30 oracle openings (≤ 60 plies), then seeded random games to `count`. */
export function benchMoveLists(count: number = BENCH_GAMES): string[][] {
  const oracle = loadOracleGames().map((g) => oracleReplay(g).uci.slice(0, BENCH_PLIES));
  const lists: string[][] = [];
  for (let i = 0; i < count; i++) {
    lists.push(i < oracle.length ? [...oracle[i]!] : randomGame(1_000 + i, BENCH_PLIES));
  }
  return lists;
}

export function benchFixtures(member: SeedMember, botUserId: bigint | null, count: number = BENCH_GAMES): SeedFixture[] {
  return benchMoveLists(count).map((moves, i) =>
    buildFixture({
      key: `bench-${String(i + 1).padStart(2, "0")}`,
      scope: BENCH_SCOPE,
      member,
      memberColor: i % 2 === 0 ? "w" : "b",
      opponent: { kind: "bot", elo: 1500 },
      botUserId,
      mode: "BOT",
      startFen: INITIAL_FEN,
      moves,
      tc: { initialSeconds: 600, incrementSeconds: 0 },
      outcome: i % 3 === 0 ? "WHITE" : i % 3 === 1 ? "BLACK" : "DRAW",
      method: i % 3 === 2 ? "AGREEMENT" : "RESIGNATION",
      completedAt: new Date(Date.UTC(2026, 10, 1, 12, i)),
      analysis: { kind: "none" },
      tag: BENCH_SEED_TAG,
    }),
  );
}

export interface BenchSeedResult {
  userCreated: boolean;
  games: number;
  written: number;
  averagePlies: number;
}

export async function runBenchSeed(db: PrismaClient, opts: { apply: boolean; count?: number }): Promise<BenchSeedResult> {
  const { member, created } = await ensureSeedUser(db, BENCH_USER, opts.apply);
  const bot = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE code = 'CHESS_BOT_001' LIMIT 1`);
  const fixtures = benchFixtures(member ?? placeholderMember(BENCH_USER), bot[0]?.id ?? null, opts.count);
  const stored = await readFixtureStates(db, fixtures.map((f) => f.game.ref));
  // Loose: the throughput tool owns the analysis state of these games.
  const changed = fixtures.filter((f) => fixtureAction(f, stored.get(f.game.ref), { loose: true }).action !== "unchanged");
  if (opts.apply && changed.length > 0) await writeFixtures(db, changed);
  const plies = fixtures.reduce((n, f) => n + f.game.plyCount, 0);
  return { userCreated: created, games: fixtures.length, written: opts.apply ? changed.length : 0, averagePlies: plies / fixtures.length };
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
    const r = await runBenchSeed(db, { apply });
    console.log(`user     ${BENCH_USER.email}  ${r.userCreated ? (apply ? "created" : "would be created") : "exists"}`);
    console.log(`games    ${r.games} (average ${r.averagePlies.toFixed(1)} plies), ${apply ? `${r.written} written` : "dry run"}`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("seed/bench", err));
