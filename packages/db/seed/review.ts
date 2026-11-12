// Phase 3 review seed (phase-03 plan §6.9): finished, reviewed games for e2e user A, the persona writers' fixtures,
// and the expired/revoked shares. Dev branch or a local Postgres only; a dry run unless --apply.
//
//   pnpm --filter @repo/db exec tsx seed/review.ts                       # plan only (dry run)
//   pnpm --filter @repo/db exec tsx seed/review.ts --apply               # write what is missing or changed
//   pnpm --filter @repo/db exec tsx seed/review.ts --apply --reset-progress   # also clear user A's walkthrough state
//   … --member <email>   seed another member instead of user A (never a real user: the guards still apply)
//
// What user A gets (40 games, 25 analysed; specs never assert absolute counts, members only gain data):
//   GAME        knightowl-style design game vs member tal_fan_77, 54 plies, Rapid 10+0, lost by resignation; DONE
//   CLEAN       the Opera Game vs Engine 1200, untimed, 17.Rd8#; DONE, clean, best decision 16.Qb8+
//   LEGEND      Morphy's Opera position, 12.Ba4 for 12.O-O-O (2 of 3 matched), drawn by threefold; comparison READY
//   LEGEND_KT   Kasparov–Topalov from move 24, 27.Qc3+ for 27.b4+; comparison FACTS_READY (evals pending)
//   UNANALYSED  a classical game vs member martin_k; analysisStatus NONE, no job (opening it starts the analysis)
//   archive-01…35  real Lichess-analysed games (CC0 oracle set) spread over results, time classes and opponents;
//               the first 23 DONE, the rest NONE
// plus an expired and a revoked share of GAME (`/r/<code>` → gone).
//
// The seed writes finished states only: no QUEUED or RUNNING job, so the worker never picks a seeded row up. Every
// seeded game carries `gameData.p3Seed`; the enqueue backfill skips those, so their fixture state stays put.
// Leased personas (`review-empty`, `review-terminal`, `review-lapsed`) are written by scripts/dev/personas.ts through
// `writePersonaFixtures` / `clearMemberGames` below (WP-H wires them).
import type { PrismaClient } from "#generated";
import type { AnalysisInput } from "@repo/chess-analysis/analysis";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import type { Color } from "@repo/chess-analysis/codec";
import { cleanAnalysisInput, gameAnalysisInput } from "@repo/chess-analysis/fixtures/review-inputs";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "@repo/chess-analysis/fixtures/legend";
import { compareWithLegend } from "@repo/chess-analysis/legend/compare";
import { legendLineFrom, legendResultOf, startPlyOfFen } from "@repo/chess-analysis/legend/slice";
import { replaySan } from "@repo/chess-analysis/replay";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { Prisma } from "#generated";
import { FIXTURE_POSITIONS } from "../prisma/fixtures/design-legend-positions";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import type { GameEndMethod, GameMode, GameWinner } from "../src/live/types";
import type { SqlClient } from "../src/live/types";
import {
  buildFixture,
  goneShares,
  liveShare,
  oracleEnding,
  oracleGames,
  oracleInput,
  seededRef,
  type GameSpec,
  type SeedFixture,
  type SeedMember,
  type SeedShareKind,
  type ShareRow,
  type TimeControl,
} from "./builders";
import {
  checkTripwire,
  isEntryPoint,
  parseFlags,
  reportFailure,
  resolveWriteTarget,
  SeedGuardError,
} from "./target";
import {
  ensureSeedUser,
  fixtureAction,
  memberByEmail,
  placeholderMember,
  readFixtureStates,
  readShares,
  resetReviewProgress,
  sharesToWrite,
  writeFixtures,
  writeShares,
  type SeedUserSpec,
} from "./writer";

export { clearMemberGames } from "./writer";

/** `gameData.p3Seed` of this seed's games. */
export const REVIEW_SEED_TAG = "review";

/** E2E user A (apps/web/e2e/fixtures/users.ts letterEmailDefault("A"); E2E_USER_A_EMAIL overrides it there too). */
export const DEFAULT_MEMBER_EMAIL = "e2e-playera+clerk_test@chessbattle.dev";

/** The displayed rating of a member without a linked Chess.com profile (the design's knightowl_88). */
export const DEFAULT_MEMBER_RATING = 1184;

/** Member opponents (synthetic accounts: no Clerk identity, they cannot sign in). Names and ratings from the design. */
export const SEED_OPPONENTS = {
  talFan: { email: "tal_fan_77@replaychess.local", code: "SEED_P3_TALFAN77", googleId: "seed_p3_tal_fan_77", name: "tal_fan_77", rating: 1203 },
  martin: { email: "martin_k@replaychess.local", code: "SEED_P3_MARTINK", googleId: "seed_p3_martin_k", name: "martin_k", rating: 1212 },
} as const satisfies Record<string, SeedUserSpec>;

/** The legend positions of the content seed (prisma/fixtures/design-legend-positions.ts). */
export const OPERA_FEN = FIXTURE_POSITIONS.find((p) => p.key === "mo")!.fen;
export const KT_FEN = FIXTURE_POSITIONS.find((p) => p.key === "kt")!.fen;

export const NAMED_FIXTURES = ["GAME", "CLEAN", "LEGEND", "LEGEND_KT", "UNANALYSED"] as const;
export type NamedFixture = (typeof NAMED_FIXTURES)[number];
export const ARCHIVE_FILLERS = 35;
export const ARCHIVE_ANALYSED = 23;

export interface ReviewSeedContext {
  member: SeedMember;
  talFan: SeedMember;
  martin: SeedMember;
  /** The legacy bot user CHESS_BOT_001 (games."opponentId" of bot games), when it exists. */
  botUserId: bigint | null;
  operaPositionId: bigint | null;
  ktPositionId: bigint | null;
}

const at = (iso: string) => new Date(iso);
type Result = "win" | "loss" | "draw";
const resultOf = (outcome: GameWinner, side: Color): Result =>
  outcome === "DRAW" ? "draw" : (outcome === "WHITE") === (side === "w") ? "win" : "loss";

function withMembers(input: AnalysisInput, outcome: GameWinner, sides: readonly Color[]): AnalysisInput {
  return { ...input, members: sides.map((side) => ({ side, result: resultOf(outcome, side) })) };
}

function bot(elo: number, ctx: Pick<ReviewSeedContext, "botUserId">) {
  return { opponent: { kind: "bot" as const, elo }, botUserId: ctx.botUserId };
}

/** The design GAME (plan 6.9 row 1) for `member`, against the member tal_fan_77. */
export function gameFixture(ctx: Pick<ReviewSeedContext, "member" | "talFan">): SeedFixture {
  const outcome: GameWinner = "BLACK";
  return buildFixture({
    key: "GAME",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    opponent: { kind: "member", member: ctx.talFan },
    mode: "ONLINE",
    startFen: INITIAL_FEN,
    moves: gameAnalysisInput().moves,
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome,
    method: "RESIGNATION",
    completedAt: at("2026-11-09T18:42:10.000Z"),
    analysis: {
      kind: "done",
      input: withMembers(gameAnalysisInput(), outcome, ["w", "b"]),
      provenance: "design-mock",
      reason: "live_end",
      priority: JOB_PRIORITY.GAME_ENDED,
    },
    tag: REVIEW_SEED_TAG,
  });
}

/** The design CLEAN game (plan 6.9 row 2): the Opera Game against Engine 1200, untimed. */
export function cleanFixture(ctx: Pick<ReviewSeedContext, "member" | "botUserId">): SeedFixture {
  const outcome: GameWinner = "WHITE";
  return buildFixture({
    key: "CLEAN",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    ...bot(1200, ctx),
    mode: "BOT",
    startFen: INITIAL_FEN,
    moves: cleanAnalysisInput().moves,
    tc: null,
    outcome,
    method: "CHECKMATE",
    completedAt: at("2026-11-08T16:20:00.000Z"),
    analysis: {
      kind: "done",
      input: withMembers(cleanAnalysisInput(), outcome, ["w"]),
      provenance: "design-mock",
      reason: "bot_end",
      priority: JOB_PRIORITY.GAME_ENDED,
    },
    tag: REVIEW_SEED_TAG,
  });
}

/**
 * The legend fixture's member line, played on until the position repeats a third time (12.Ba4 Rb8 13.Bb5 Ra8 …:
 * the first Ba4 position still has Black's queen-side castling right, so the third repetition comes at 16.Ba4).
 */
export const OPERA_DRAW_TAIL = ["Rb8", "Bb5", "Ra8", "Ba4"] as const;

/**
 * The Opera legend game (plan 6.9 row 3, `V3GameOverLegend` over_legend): Morphy's position before 10.Nxb5, the
 * member matches 10.Nxb5 and 11.Bxb5+, plays 12.Ba4 for Morphy's 12.O-O-O, then the game is drawn by threefold
 * repetition. The facts come from the writers' own path (`compareWithLegend` over the game's moves and the legend's
 * PGN); the comparison is READY with the evals at the divergence the legend fixture records.
 */
export function legendFixtureGame(ctx: Pick<ReviewSeedContext, "member" | "botUserId" | "operaPositionId">): SeedFixture {
  if (ctx.operaPositionId === null) throw new SeedGuardError("the Opera legend position is missing: run `pnpm --filter @repo/db seed:content`");
  const f = legendFixture("opera");
  const evalAt = f.expected.paragraphWithEvals?.evalAtDivergence;
  if (!evalAt) throw new Error("the opera legend fixture has no evalAtDivergence");
  const moves = replaySan(f.startFen, [...f.game, ...OPERA_DRAW_TAIL]).uci;
  const line = legendLineFrom(f.legendPgn, f.startFen);
  const result = legendResultOf(f.legendPgn, f.metadata);
  if (!line || !result) throw new Error("the opera legend fixture's PGN does not reach its position");
  const facts = compareWithLegend({
    startFen: f.startFen,
    startPly: startPlyOfFen(f.startFen),
    moves,
    member: f.member,
    legendUci: line.uci,
    historicalName: f.historicalName,
    legendResult: result,
    legendTotalMoves: line.totalMoves,
  });
  return buildFixture({
    key: "LEGEND",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    ...bot(1500, ctx),
    mode: "LEGEND_BOT",
    startFen: f.startFen,
    moves,
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome: "DRAW",
    method: "THREEFOLD",
    completedAt: at("2026-11-10T19:05:00.000Z"),
    analysis: { kind: "none" },
    chessPositionId: ctx.operaPositionId,
    position: { name: "Opera Game, Paris 1858", event: "Paris Opera", year: 1858, legendSide: "w", moveNumber: 10 },
    legend: { status: "READY", facts: { ...facts, evalAtDivergence: evalAt } },
    tag: REVIEW_SEED_TAG,
  });
}

/**
 * Kasparov–Topalov (plan 6.9 row 4, play-b F9): the member plays Kasparov's 24.Rxd4, 25.Re7+ and 26.Qxd4+, then
 * 27.Qc3+ where Kasparov played 27.b4+ (divergenceBy "user"; six plies of the game match). Facts only (FACTS_READY):
 * the compare page's `pending_evals` variant computes the evals through A9b.
 */
export function legendKtFixture(ctx: Pick<ReviewSeedContext, "member" | "botUserId" | "ktPositionId">): SeedFixture {
  if (ctx.ktPositionId === null) throw new SeedGuardError("the Kasparov–Topalov position is missing: run `pnpm --filter @repo/db seed:content`");
  const f = legendFixture("kt");
  return buildFixture({
    key: "LEGEND_KT",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    ...bot(1800, ctx),
    mode: "LEGEND_BOT",
    startFen: f.startFen,
    moves: legendFixtureMoves(f),
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome: "BLACK",
    method: "RESIGNATION",
    completedAt: at("2026-11-07T15:00:00.000Z"),
    analysis: { kind: "none" },
    chessPositionId: ctx.ktPositionId,
    position: { name: "Kasparov vs Topalov, Wijk aan Zee 1999", event: "Wijk aan Zee", year: 1999, legendSide: "w", moveNumber: 24 },
    legend: { status: "FACTS_READY", facts: legendFixtureFacts(f) },
    tag: REVIEW_SEED_TAG,
  });
}

/** The oracle game the UNANALYSED fixture replays (a 54-ply classical game). */
export const UNANALYSED_ORACLE_ID = "agENlnZZ";

function oracleIndexOf(id: string): number {
  const i = oracleGames().findIndex((g) => g.id === id);
  if (i < 0) throw new Error(`oracle game ${id} is not in the fixtures`);
  return i;
}

/** An unanalysed game (plan 6.9 row 6): "Not reviewed yet", and opening the review starts the analysis (A3). */
export function unanalysedFixture(ctx: Pick<ReviewSeedContext, "member" | "martin">): SeedFixture {
  const { game, input } = oracleInput(oracleIndexOf(UNANALYSED_ORACLE_ID), []);
  const end = oracleEnding(game);
  return buildFixture({
    key: "UNANALYSED",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    opponent: { kind: "member", member: ctx.martin },
    mode: "FRIEND",
    startFen: input.startFen,
    moves: input.moves,
    tc: { initialSeconds: 1800, incrementSeconds: 0 },
    outcome: end.outcome,
    method: end.method,
    completedAt: at("2026-11-06T12:00:00.000Z"),
    analysis: { kind: "none" },
    tag: REVIEW_SEED_TAG,
  });
}

const BOT_ELOS = [800, 1000, 1200, 1400, 1600, 1800, 2000] as const;
const TIME_CONTROLS: Record<string, readonly [TimeControl, TimeControl]> = {
  bullet: [
    { initialSeconds: 60, incrementSeconds: 0 },
    { initialSeconds: 120, incrementSeconds: 1 },
  ],
  blitz: [
    { initialSeconds: 180, incrementSeconds: 2 },
    { initialSeconds: 300, incrementSeconds: 0 },
  ],
  rapid: [
    { initialSeconds: 600, incrementSeconds: 0 },
    { initialSeconds: 900, incrementSeconds: 10 },
  ],
  classical: [
    { initialSeconds: 1800, incrementSeconds: 0 },
    { initialSeconds: 1800, incrementSeconds: 20 },
  ],
};

/** Archive filler `n` (1-based, plan 6.9 "40 mixed archive rows"): a real Lichess-analysed game. */
export function archiveFixture(ctx: ReviewSeedContext, n: number): SeedFixture {
  const i = n - 1;
  const memberColor: Color = i % 2 === 0 ? "w" : "b";
  const slot = i % 5; // 0, 2, 4 bots; 1 tal_fan_77; 3 martin_k
  const opponentMember = slot === 1 ? ctx.talFan : slot === 3 ? ctx.martin : null;
  const { game, input } = oracleInput(i, []);
  const end = oracleEnding(game);
  const sides: Color[] = opponentMember ? ["w", "b"] : [memberColor];
  const tcs = TIME_CONTROLS[game.speed] ?? TIME_CONTROLS.rapid!;
  const untimed = !opponentMember && i % 7 === 6 && end.method !== "TIMEOUT" && end.method !== "TIMEOUT_VS_INSUFFICIENT";
  const mode: GameMode = opponentMember ? (i % 2 === 0 ? "ONLINE" : "FRIEND") : "BOT";
  const completedAt = new Date(Date.UTC(2026, 10, 5, 20, 0, 0) - i * 26 * 3_600_000 - (i % 4) * 37 * 60_000);
  const spec: GameSpec = {
    key: `archive-${String(n).padStart(2, "0")}`,
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor,
    ...(opponentMember ? { opponent: { kind: "member" as const, member: opponentMember } } : bot(BOT_ELOS[i % BOT_ELOS.length]!, ctx)),
    mode,
    startFen: input.startFen,
    moves: input.moves,
    tc: untimed ? null : tcs[i % 2]!,
    outcome: end.outcome,
    method: end.method as GameEndMethod,
    completedAt,
    analysis:
      n <= ARCHIVE_ANALYSED
        ? {
            kind: "done",
            input: withMembers(input, end.outcome, sides),
            provenance: "lichess-oracle",
            reason: opponentMember ? "live_end" : "bot_end",
            priority: JOB_PRIORITY.GAME_ENDED,
          }
        : { kind: "none" },
    tag: REVIEW_SEED_TAG,
  };
  return buildFixture(spec);
}

/** Every fixture of user A's seed, in a stable order. */
export function reviewFixtures(ctx: ReviewSeedContext): SeedFixture[] {
  return [
    gameFixture(ctx),
    cleanFixture(ctx),
    legendFixtureGame(ctx),
    legendKtFixture(ctx),
    unanalysedFixture(ctx),
    ...Array.from({ length: ARCHIVE_FILLERS }, (_, k) => archiveFixture(ctx, k + 1)),
  ];
}

/** The terminal-failure fixture (plan 6.9 row 5): FAILED after 30 graded plies, the job out of attempts. */
export function terminalFixture(ctx: Pick<ReviewSeedContext, "member" | "botUserId">): SeedFixture {
  const outcome: GameWinner = "BLACK";
  return buildFixture({
    key: "TERMINAL",
    scope: ctx.member.ref,
    member: ctx.member,
    memberColor: "w",
    ...bot(1400, ctx),
    mode: "BOT",
    startFen: INITIAL_FEN,
    moves: gameAnalysisInput().moves,
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    outcome,
    method: "RESIGNATION",
    completedAt: at("2026-11-08T10:15:00.000Z"),
    analysis: {
      kind: "terminal",
      input: withMembers(gameAnalysisInput(), outcome, ["w"]),
      provenance: "design-mock",
      gradedPlies: 30,
      lastError: "engine_failed: no bestmove within 10 s, twice",
    },
    tag: REVIEW_SEED_TAG,
  });
}

/** The refs e2e helpers use: `seededRef(key, users.referenceId)`. */
export function reviewFixtureRef(key: NamedFixture | "TERMINAL" | `archive-${string}`, memberRef: string): string {
  return seededRef(key, memberRef);
}

// ── Context ────────────────────────────────────────────────────────────────────────────────────────────────────

async function positionIdByFen(db: SqlClient, fen: string): Promise<bigint | null> {
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM chess_positions WHERE fen = ${fen} LIMIT 1`);
  return rows[0]?.id ?? null;
}

async function botUserId(db: SqlClient): Promise<bigint | null> {
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE code = 'CHESS_BOT_001' LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** Resolves the member, the opponents (created when `apply`), the bot user and the legend positions. */
export async function loadContext(
  db: SqlClient,
  memberEmail: string,
  apply: boolean,
  log: (line: string) => void = () => {},
): Promise<ReviewSeedContext> {
  const member = await memberByEmail(db, memberEmail, DEFAULT_MEMBER_RATING);
  if (!member) {
    throw new SeedGuardError(`no user ${memberEmail}: provision it first (apps/web: npx tsx e2e/scripts/provision-test-users.ts)`);
  }
  const opp = async (spec: SeedUserSpec) => {
    const r = await ensureSeedUser(db, spec, apply);
    if (r.created) log(`  user     ${spec.name.padEnd(12)} ${apply ? "created" : "would be created"}`);
    return r.member ?? placeholderMember(spec);
  };
  return {
    member,
    talFan: await opp(SEED_OPPONENTS.talFan),
    martin: await opp(SEED_OPPONENTS.martin),
    botUserId: await botUserId(db),
    operaPositionId: await positionIdByFen(db, OPERA_FEN),
    ktPositionId: await positionIdByFen(db, KT_FEN),
  };
}

// ── Plan and apply ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SeedPlanRow {
  key: string;
  ref: string;
  action: "insert" | "update" | "unchanged";
  reason?: string;
}

export async function planFixtures(db: SqlClient, fixtures: readonly SeedFixture[], opts: { loose?: boolean } = {}) {
  const stored = await readFixtureStates(db, fixtures.map((f) => f.game.ref));
  return fixtures.map((f): SeedPlanRow => {
    const a = fixtureAction(f, stored.get(f.game.ref), opts);
    return { key: f.key, ref: f.game.ref, action: a.action, ...(a.action === "update" ? { reason: a.reason } : {}) };
  });
}

export type PersonaFixtureName = "GAME" | "CLEAN" | "UNANALYSED" | "TERMINAL";

/**
 * Persona writer (scripts/dev/personas.ts, WP-H): puts the named fixtures on a pool user or S, exactly (a fixture
 * whose state drifted is rewritten; progress is cleared so a leased walkthrough starts fresh). Returns key → ref.
 * Shared letters A–R are refused (they are seeded by the CLI below, and only gain data).
 */
export async function writePersonaFixtures(
  db: PrismaClient,
  email: string,
  names: readonly PersonaFixtureName[],
  opts: { log?: (line: string) => void } = {},
): Promise<Record<string, string>> {
  if (/^e2e-player[a-r]\+/i.test(email)) throw new SeedGuardError(`refusing: ${email} is a shared e2e user; personas run on pool users or S`);
  await checkTripwire(db, MAX_TARGET_USERS);
  const ctx = await loadContext(db, email, true, opts.log);
  const build: Record<PersonaFixtureName, () => SeedFixture> = {
    GAME: () => gameFixture(ctx),
    CLEAN: () => cleanFixture(ctx),
    UNANALYSED: () => unanalysedFixture(ctx),
    TERMINAL: () => terminalFixture(ctx),
  };
  const fixtures = names.map((n) => build[n]());
  const plan = await planFixtures(db, fixtures);
  const changed = fixtures.filter((_, k) => plan[k]!.action !== "unchanged");
  if (changed.length > 0) await writeFixtures(db, changed);
  await resetReviewProgress(db, fixtures.map((f) => f.game.ref));
  for (const row of plan) opts.log?.(`[personas] ${row.key} ${row.action} /review/${row.ref}`);
  return Object.fromEntries(fixtures.map((f) => [f.key, f.game.ref]));
}

export interface ReviewSeedOptions {
  apply: boolean;
  memberEmail: string;
  resetProgress: boolean;
  now?: Date;
  log?: (line: string) => void;
}

export interface ReviewSeedResult {
  plan: SeedPlanRow[];
  shares: { code: string; kind: string; action: "write" | "unchanged" }[];
  written: number;
  progressReset: number;
  refs: Record<string, string>;
}

/** The seed run (CLI and integration test). `db` must already be guarded by the caller. */
export async function runReviewSeed(db: PrismaClient, opts: ReviewSeedOptions): Promise<ReviewSeedResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const ctx = await loadContext(db, opts.memberEmail, opts.apply, log);
  const fixtures = reviewFixtures(ctx);
  const plan = await planFixtures(db, fixtures);

  const game = fixtures[0]!;
  const shares: (ShareRow & { kind: SeedShareKind })[] = [
    ...goneShares(game, "w", ctx.member.ref, now).map((s, k) => ({ ...s, kind: k === 0 ? ("expired" as const) : ("revoked" as const) })),
    { ...liveShare(game, "w", ctx.member.ref, now), kind: "live" as const },
  ];
  const storedShares = await readShares(db, shares.map((s) => s.code));
  const gameRewritten = plan[0]!.action !== "unchanged";
  // A rewritten GAME cascades its shares away: write them again whatever their stored state.
  const shareWrites = gameRewritten ? shares : sharesToWrite(shares, storedShares, now);

  let written = 0;
  let progressReset = 0;
  if (opts.apply) {
    const changed = fixtures.filter((_, k) => plan[k]!.action !== "unchanged");
    if (changed.length > 0) written = await writeFixtures(db, changed, { log });
    if (shareWrites.length > 0) await writeShares(db, shareWrites);
    if (opts.resetProgress) progressReset = await resetReviewProgress(db, fixtures.map((f) => f.game.ref));
  }
  return {
    plan,
    shares: shares.map((s) => ({ code: s.code, kind: s.kind, action: shareWrites.includes(s) ? "write" : "unchanged" })),
    written,
    progressReset,
    refs: Object.fromEntries(fixtures.map((f) => [f.key, f.game.ref])),
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const { flags, values } = parseFlags(process.argv.slice(2), {
    booleans: ["--apply", "--reset-progress"],
    values: ["--member"],
  });
  const apply = flags.has("--apply");
  const memberEmail = values.get("--member") ?? DEFAULT_MEMBER_EMAIL;
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    const users = await checkTripwire(db);
    console.log(`tripwire users = ${users} (limit ${MAX_TARGET_USERS})`);
    const started = Date.now();
    const r = await runReviewSeed(db, {
      apply,
      memberEmail,
      resetProgress: flags.has("--reset-progress"),
      log: (l) => console.log(l),
    });
    console.log("\nfixtures");
    for (const row of r.plan) {
      console.log(`  ${row.key.padEnd(12)} ${row.action.padEnd(9)} /review/${row.ref}${row.reason ? `  (${row.reason})` : ""}`);
    }
    console.log("shares");
    for (const s of r.shares) console.log(`  ${s.kind.padEnd(12)} ${s.action.padEnd(9)} /r/${s.code}`);
    const changes = r.plan.filter((p) => p.action !== "unchanged").length + r.shares.filter((s) => s.action === "write").length;
    if (!apply) console.log(`\ndry run: ${changes === 0 ? "every row is unchanged" : `${changes} change(s) to write`}.`);
    else console.log(`\napplied: ${r.written} game(s), ${r.shares.filter((s) => s.action === "write").length} share(s), ${r.progressReset} progress reset(s) in ${Date.now() - started} ms.`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("seed/review", err));
