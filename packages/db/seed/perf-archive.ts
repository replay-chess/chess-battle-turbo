// Phase 3 perf seed (phase-03 plan §9.3, §12.7): one member with 2,000 finished games, the "2,000-row user" the
// archive EXPLAIN gate (`scripts/explain-hot.ts`) and the k6 `games-list` / `review-read` scenarios run against.
// Dev branch or a local Postgres only (CI runs it on Docker before the EXPLAIN gate); dry run unless --apply.
//
//   pnpm --filter @repo/db exec tsx seed/perf-archive.ts [--apply] [--rows 2000] [--email <member>]
//
// Every game is coherent with what the app reads: the ≈ 1,330 DONE games carry a full game_analyses row and a
// player_reviews row (real Lichess-analysed games from the CC0 oracle set, graded by the worker's code), the NONE
// games carry none, and 1 in 100 is a 4-ply resignation (SKIPPED). Opponents are bots, so no other member's
// archive grows. The default member is synthetic (no Clerk identity); pass --email to give a provisioned perf login
// the same archive (never a shared e2e letter A–R: they only gain data, and 2,000 rows would swamp their specs).
//
// Idempotent: a re-run writes only games whose definition or state changed (`seed/writer.ts`).
import type { PrismaClient } from "#generated";
import type { Color } from "@repo/chess-analysis/codec";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { Prisma } from "#generated";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import type { GameWinner } from "../src/live/types";
import { buildFixture, oracleEnding, oracleInput, type GameSpec, type SeedFixture, type SeedMember, type TimeControl } from "./builders";
import { checkTripwire, isEntryPoint, parseFlags, positiveInt, reportFailure, resolveWriteTarget, SeedGuardError } from "./target";
import {
  ensureSeedUser,
  fixtureAction,
  memberByEmail,
  placeholderMember,
  readFixtureStates,
  SHARED_LETTER_EMAIL,
  writeFixtures,
  type SeedUserSpec,
} from "./writer";

export const PERF_SEED_TAG = "perf-archive";
export const PERF_USER = {
  email: "perf-archive@replaychess.local",
  code: "SEED_P3_PERF",
  googleId: "seed_p3_perf_archive",
  name: "perf_archive",
  rating: 1350,
} as const satisfies SeedUserSpec;
export const PERF_ROWS = 2000;
export const PERF_ROWS_MAX = 5000;
/** The k6 review-read scenario reads this many reviews (plan 12.7): the first DONE games of the archive. */
export const PERF_REVIEW_SET = 40;

const BOT_ELOS = [800, 1000, 1200, 1400, 1600, 1800, 2000] as const;
const TCS: readonly TimeControl[] = [
  { initialSeconds: 60, incrementSeconds: 0 },
  { initialSeconds: 180, incrementSeconds: 2 },
  { initialSeconds: 300, incrementSeconds: 0 },
  { initialSeconds: 600, incrementSeconds: 0 },
  { initialSeconds: 900, incrementSeconds: 10 },
  { initialSeconds: 1800, incrementSeconds: 0 },
];
/** A 4-ply game the member resigned: under ANALYSIS_MIN_PLIES, so SKIPPED. */
const SHORT_GAME = ["e2e4", "e7e5", "d1h5", "b8c6"];
const ANCHOR = Date.UTC(2026, 10, 4, 22, 0, 0);

export type PerfKind = "done" | "none" | "skipped";

/** Which kind row `i` is: 1 in 100 SKIPPED, then two of every three DONE. */
export function perfKind(i: number): PerfKind {
  if (i % 100 === 99) return "skipped";
  return i % 3 === 2 ? "none" : "done";
}

/** Perf archive row `i` (0-based) for `member`. */
export function perfFixture(member: SeedMember, i: number, botUserId: bigint | null): SeedFixture {
  const kind = perfKind(i);
  const memberColor: Color = i % 2 === 0 ? "w" : "b";
  const base = {
    key: `perf-${String(i).padStart(4, "0")}`,
    scope: member.ref,
    member,
    memberColor,
    opponent: { kind: "bot" as const, elo: BOT_ELOS[i % BOT_ELOS.length]! },
    botUserId,
    mode: "BOT" as const,
    completedAt: new Date(ANCHOR - i * 4 * 3_600_000 - (i % 7) * 11 * 60_000),
    tag: PERF_SEED_TAG,
  };
  if (kind === "skipped") {
    const outcome: GameWinner = memberColor === "w" ? "BLACK" : "WHITE";
    return buildFixture({
      ...base,
      startFen: INITIAL_FEN,
      moves: SHORT_GAME,
      tc: TCS[i % TCS.length]!,
      outcome,
      method: "RESIGNATION",
      analysis: { kind: "skipped" },
    });
  }
  const { game, input } = oracleInput(i, []);
  const end = oracleEnding(game);
  const timed = end.method === "TIMEOUT" || end.method === "TIMEOUT_VS_INSUFFICIENT" || i % 9 !== 8;
  const spec: GameSpec = {
    ...base,
    startFen: input.startFen,
    moves: input.moves,
    tc: timed ? TCS[i % TCS.length]! : null,
    outcome: end.outcome,
    method: end.method,
    analysis:
      kind === "done"
        ? {
            kind: "done",
            input: {
              ...input,
              members: [
                {
                  side: memberColor,
                  result: end.outcome === "DRAW" ? "draw" : (end.outcome === "WHITE") === (memberColor === "w") ? "win" : "loss",
                },
              ],
            },
            provenance: "lichess-oracle",
            reason: "bot_end",
            priority: JOB_PRIORITY.GAME_ENDED,
          }
        : { kind: "none" },
  };
  return buildFixture(spec);
}

export function perfFixtures(member: SeedMember, rows: number, botUserId: bigint | null): SeedFixture[] {
  return Array.from({ length: rows }, (_, i) => perfFixture(member, i, botUserId));
}

/** The refs of the k6 review-read set: the first PERF_REVIEW_SET DONE games. */
export function perfReviewRefs(fixtures: readonly SeedFixture[]): string[] {
  return fixtures.filter((f) => f.game.analysisStatus === "DONE").slice(0, PERF_REVIEW_SET).map((f) => f.game.ref);
}

export interface PerfSeedResult {
  member: string;
  userCreated: boolean;
  insert: number;
  update: number;
  unchanged: number;
  written: number;
  reviewRefs: string[];
}

export async function runPerfSeed(
  db: PrismaClient,
  opts: { apply: boolean; rows: number; email?: string; log?: (line: string) => void },
): Promise<PerfSeedResult> {
  let member: SeedMember;
  let userCreated = false;
  if (opts.email) {
    if (SHARED_LETTER_EMAIL.test(opts.email)) throw new SeedGuardError(`refusing: ${opts.email} is a shared e2e user`);
    const m = await memberByEmail(db, opts.email, PERF_USER.rating);
    if (!m) throw new SeedGuardError(`no user ${opts.email}`);
    member = m;
  } else {
    const r = await ensureSeedUser(db, PERF_USER, opts.apply);
    member = r.member ?? placeholderMember(PERF_USER);
    userCreated = r.created;
  }
  const bot = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE code = 'CHESS_BOT_001' LIMIT 1`);
  const fixtures = perfFixtures(member, opts.rows, bot[0]?.id ?? null);
  const stored = await readFixtureStates(db, fixtures.map((f) => f.game.ref));
  const actions = fixtures.map((f) => fixtureAction(f, stored.get(f.game.ref)));
  const changed = fixtures.filter((_, k) => actions[k]!.action !== "unchanged");
  const count = (a: string) => actions.filter((x) => x.action === a).length;
  let written = 0;
  if (opts.apply && changed.length > 0) written = await writeFixtures(db, changed, opts.log ? { log: opts.log } : {});
  return {
    member: member.name,
    userCreated,
    insert: count("insert"),
    update: count("update"),
    unchanged: count("unchanged"),
    written,
    reviewRefs: perfReviewRefs(fixtures),
  };
}

async function main() {
  const { flags, values } = parseFlags(process.argv.slice(2), { booleans: ["--apply"], values: ["--rows", "--email"] });
  const apply = flags.has("--apply");
  const rows = positiveInt("--rows", values.get("--rows"), PERF_ROWS, PERF_ROWS_MAX);
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const started = Date.now();
    const email = values.get("--email");
    const r = await runPerfSeed(db, { apply, rows, ...(email ? { email } : {}), log: (l) => console.log(l) });
    console.log(`member   ${r.member}${r.userCreated ? (apply ? " (created)" : " (would be created)") : ""}`);
    console.log(`games    insert ${r.insert}  update ${r.update}  unchanged ${r.unchanged}`);
    console.log(`review-read set (${r.reviewRefs.length}): ${r.reviewRefs.slice(0, 3).join(", ")}, …`);
    console.log(apply ? `applied: ${r.written} game(s) in ${Date.now() - started} ms.` : "dry run: no writes.");
    if (apply && r.written > 0) {
      // The bulk write leaves the planner statistics behind until autovacuum's next ANALYZE, and the EXPLAIN gate that
      // CI runs right after this seed (scripts/explain-hot.ts) then measured plans for an empty archive: a Sort over
      // game_players for G1 at ~8,000 buffers instead of the index walk at ~100 (FIX-1). Production tables are
      // analysed continuously, so refresh the statistics of what was written and the gate measures prod's plans.
      await db.$executeRawUnsafe(`ANALYZE games, game_players, game_analyses, player_reviews, jobs, users`);
      console.log("analyzed: games, game_players, game_analyses, player_reviews, jobs, users");
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("seed/perf-archive", err));
