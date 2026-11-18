// Phase 6 persona writer (phase-06 plan §6.8; testing X4; the owner's "real data, not mocks" rule): puts one P6 state
// (./p06-persona-states.ts) on a pool user or S through the product's own pipelines. Called by
// apps/web/scripts/dev/personas.ts after P1's billing UPDATE, P4's clear and P5's clear (so the bank, cards, attempts,
// sessions, days and the training profile are already gone), and by apps/web/e2e/scripts/seed-weakness.ts (dev seed).
// Shared e2e letters A–R are refused, the user-count tripwire applies, and the persona tool has already checked the
// target host (the Neon dev endpoint or a local Postgres).
//
// A reset:
//   1. the user's zone and rating band (what onboarding writes); the user's weakness snapshots and RECOMPUTE_WEAKNESS
//      row are removed (so TR-12's durable limit starts clean);
//   2. the games: the persona's real CC0 games (the extract) as finished online games against one synthetic opponent
//      (P3's seed builders and writer, deterministic refs per member). When the user already holds exactly these games,
//      all analysed and written less than 6 h ago, they are kept (heavy personas re-lease in seconds) and only their
//      bank is extracted again (EXTRACT_MISTAKES, the worker's own job: P5's clear removed it);
//   3. ANALYZE_GAME for each game to analyse (`enqueueAnalysisSql`, as a finished game enqueues it), a signed kick, and
//      a wait until the RUNNING worker has graded them: the worker writes the analyses, the five P6 input columns, the
//      bank (J1) and arms its own first builds;
//   4. the finish (state `finish`): one recompute that settles the snapshot on every analysed game (the same upsert the
//      triggers use, then the worker runs it), and the state's last touch (frozen jobs, a removed snapshot, a crashed
//      last attempt that the worker's reaper fails).
// The worker must be running (ANALYSIS_WORKER_URL + INTERNAL_API_SECRET): the e2e harness starts it; on the Neon dev
// branch it is the deployed dev worker. A reset waits at most `timeoutMs` (default 6 min) and names what it waited for.
import { Prisma, type PrismaClient } from "#generated";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { EXTRACT_VERSION, JOB_MAX_ATTEMPTS, JOB_PRIORITY, weaknessDedupeKey } from "@repo/contracts/internal/jobs";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { enqueueAnalysisSql } from "../src/jobs";
import { enqueueWeaknessSql } from "../src/weakness-jobs";
import { buildFixture, replayCached, seedPgn, type SeedFixture, type SeedMember } from "./builders";
import {
  getP06PersonaState,
  P06_STEPS,
  planGames,
  REUSE_MAX_AGE_MS,
  timeControlOf,
  type P06PersonaState,
  type P06StepName,
  type PlannedGame,
} from "./p06-persona-states";
import { checkTripwire, SeedGuardError } from "./target";
import { clearMemberGames, ensureSeedUser, SHARED_LETTER_EMAIL, writeFixtures } from "./writer";

/** Wakes the analysis worker (a signed `/internal/analysis/kick`). Resolves false when the kick was not delivered. */
export type P06Kick = () => Promise<boolean>;

export interface P06WriteOptions {
  now?: Date;
  kick: P06Kick;
  log?: (line: string) => void;
  /** The longest a reset waits for the worker (default: 6 minutes, or 30 s per game when that is longer). */
  timeoutMs?: number;
  /** Poll interval (default 750 ms). */
  pollMs?: number;
}

export interface P06PersonaReport {
  persona: string;
  userId: bigint;
  userRef: string;
  games: number;
  analysed: number;
  reused: boolean;
  snapshot: { status: string; gamesAnalysed: number; gamesInScope: number } | null;
  /** Game refs, newest first. */
  gameRefs: string[];
}

/** The synthetic opponent of every persona game (no Clerk identity, never a member: the worker builds nothing for it). */
export const P06_OPPONENT = {
  email: "p6-persona-opponent@replay-seed.invalid",
  code: "P6OPPONENT",
  googleId: "seed:p6-persona-opponent",
  name: "lichess_opponent",
  rating: 1500,
} as const;

/** ANALYZE_GAME jobs of `weak-computing`'s ungraded games are due this far ahead (the worker never claims them). */
export const FROZEN_RUN_AT_SQL = Prisma.sql`(now() AT TIME ZONE 'UTC') + interval '2 years'`;
/** The `lockedBy` of the recompute a dead worker left (weakfail). */
export const CRASHED_WORKER = "p6-persona-crashed-worker";

const DEFAULT_TIMEOUT_MS = 6 * 60_000;
/** The wait a reset allows per game to grade (a Stockfish worker on the dev box). */
const PER_GAME_MS = 30_000;
const KICK_EVERY_MS = 10_000;

interface TargetUser {
  id: bigint;
  ref: string;
}

function refuseShared(email: string): void {
  if (SHARED_LETTER_EMAIL.test(email)) {
    throw new SeedGuardError(`refusing: ${email} is a shared e2e user; personas run on pool users or S`);
  }
}

async function targetUser(db: PrismaClient, email: string): Promise<TargetUser> {
  const rows = await db.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`SELECT id, "referenceId" AS ref FROM users WHERE email = ${email}`);
  if (!rows[0]) throw new SeedGuardError(`no users row for ${email}; provision it first`);
  return { id: rows[0].id, ref: rows[0].ref };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────

const OUTCOME = { "1-0": "WHITE", "0-1": "BLACK", "1/2-1/2": "DRAW" } as const;

/** One persona game as P3's builder writes a finished online game, with the game's real clock record (or none). */
export function personaFixture(member: SeedMember, opponent: SeedMember, g: PlannedGame, s: Pick<P06PersonaState, "noClocks">): SeedFixture {
  const moves = g.source.uci.split(" ");
  const tc = timeControlOf(g.source.tc);
  const replay = replayCached(INITIAL_FEN, moves);
  const ended = replay.fens.length > 0 ? replay.fens[replay.fens.length - 1]! : INITIAL_FEN;
  const outcome = OUTCOME[g.source.res];
  const method = g.source.term === "Time forfeit" ? "TIMEOUT" : outcome === "DRAW" ? "AGREEMENT" : /#/.test(replay.san[replay.san.length - 1] ?? "") ? "CHECKMATE" : "RESIGNATION";
  const f = buildFixture({
    key: g.key,
    scope: member.ref,
    member: { ...member, rating: g.source.elo },
    memberColor: g.source.c,
    opponent: { kind: "member", member: { ...opponent, rating: g.source.oppElo } },
    mode: "ONLINE",
    startFen: INITIAL_FEN,
    moves,
    tc,
    outcome,
    method,
    completedAt: g.endedAt,
    analysis: { kind: "none" },
    tag: "p6-persona",
  });
  // The game's own clock record (the importer's per-ply rule), not the seed's synthetic spend pattern; OTB-style
  // records (`noclock`) carry none.
  const clocks = s.noClocks ? [] : g.source.clk;
  const last = (color: "w" | "b") => {
    for (let i = clocks.length - 1; i >= 0; i--) if ((i % 2 === 0 ? "w" : "b") === color) return clocks[i]!;
    return null;
  };
  f.game.moveClocksMs = clocks;
  f.game.whiteTimeMs = method === "TIMEOUT" && outcome === "BLACK" ? 0 : last("w");
  f.game.blackTimeMs = method === "TIMEOUT" && outcome === "WHITE" ? 0 : last("b");
  f.game.pgn = seedPgn({
    ref: f.game.ref,
    event: "Rated game",
    white: f.game.whiteName,
    black: f.game.blackName,
    startFen: INITIAL_FEN,
    san: replay.san,
    clocksMs: clocks,
    outcome,
    termination: g.source.term,
    timeControl: g.source.tc,
    date: g.endedAt,
  });
  if (f.game.fen !== ended) f.game.fen = ended;
  return f;
}

// ── Clear ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Removes the user's weakness snapshots and RECOMPUTE_WEAKNESS row (every reset; the games are the writer's). */
export async function clearP06State(db: PrismaClient, email: string, opts: { log?: (line: string) => void } = {}): Promise<{ snapshots: number; jobs: number }> {
  refuseShared(email);
  await checkTripwire(db, MAX_TARGET_USERS);
  const user = await targetUser(db, email);
  const [snapshots, jobs] = await db.$transaction([
    db.$executeRaw(Prisma.sql`DELETE FROM weakness_snapshots WHERE "userId" = ${user.id}`),
    db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${weaknessDedupeKey(user.id)}`),
  ]);
  opts.log?.(`[personas] p6 cleared: ${snapshots} snapshot(s), ${jobs} recompute row(s)`);
  return { snapshots, jobs };
}

// ── The worker loop ────────────────────────────────────────────────────────────────────────────────────────────

class Waiter {
  private readonly deadline: number;
  private lastKick = 0;
  private misses = 0;
  constructor(
    private readonly opts: P06WriteOptions,
    private readonly what: string,
  ) {
    this.deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }
  /** A kick is a wake-up: one that is lost (the worker busy, a timeout) is retried; three in a row stop the reset. */
  async kick(force = false): Promise<void> {
    if (!force && Date.now() - this.lastKick < KICK_EVERY_MS) return;
    this.lastKick = Date.now();
    if (await this.opts.kick()) {
      this.misses = 0;
      return;
    }
    this.misses += 1;
    if (this.misses >= 3) {
      throw new SeedGuardError(`${this.what}: the analysis worker was not reached 3 times in a row (ANALYSIS_WORKER_URL / INTERNAL_API_SECRET); a P6 persona needs it`);
    }
  }
  async tick(state: string): Promise<void> {
    if (Date.now() > this.deadline) throw new SeedGuardError(`${this.what}: timed out waiting for the worker (${state})`);
    await sleep(this.opts.pollMs ?? 750);
    await this.kick();
  }
}

/** Jobs of the user's games that are due (frozen ones excluded) and not finished, and the last failure if any. */
async function pendingWork(db: PrismaClient, userId: bigint): Promise<{ pending: number; failed: string | null }> {
  const rows = await db.$queryRaw<{ pending: number; failed: string | null }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE j.status IN ('QUEUED', 'RUNNING'))::int AS pending,
           max(j."lastError") FILTER (WHERE j.status = 'FAILED') AS failed
      FROM jobs j
     WHERE j.kind IN ('ANALYZE_GAME', 'EXTRACT_MISTAKES')
       AND j."gameId" IN (SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = ${userId})
       AND (j.kind = 'ANALYZE_GAME' OR j."userId" = ${userId})
       AND j."runAt" < (now() AT TIME ZONE 'UTC') + interval '1 year'`);
  return { pending: rows[0]?.pending ?? 0, failed: rows[0]?.failed ?? null };
}

async function waitForGames(db: PrismaClient, user: TargetUser, waiter: Waiter): Promise<void> {
  await waiter.kick(true);
  for (;;) {
    const w = await pendingWork(db, user.id);
    if (w.failed) throw new SeedGuardError(`a persona game's job failed in the worker: ${w.failed.slice(0, 200)}`);
    if (w.pending === 0) return;
    await waiter.tick(`${w.pending} analysis/extraction job(s) left`);
  }
}

async function dbNow(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<{ t: string }[]>(Prisma.sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS t`);
  return rows[0]!.t;
}

/**
 * Asks for one recompute now (the §7.4.1 upsert the triggers share, trigger `heal`, no debounce) and waits until the
 * worker finished one that started after the ask, with no analysis or extraction left. A row the worker re-armed
 * meanwhile (a trigger hit the RUNNING job: `rerun`, due after the worker's debounce) is pulled forward again.
 */
async function settleRecompute(db: PrismaClient, user: TargetUser, waiter: Waiter): Promise<void> {
  const key = weaknessDedupeKey(user.id);
  let askedAt: string | null = null;
  for (;;) {
    const w = await pendingWork(db, user.id);
    if (w.failed) throw new SeedGuardError(`a persona game's job failed in the worker: ${w.failed.slice(0, 200)}`);
    if (w.pending > 0) {
      await waiter.tick(`${w.pending} analysis/extraction job(s) left`);
      continue;
    }
    const rows = await db.$queryRaw<{ status: string; due: boolean; done: boolean; lastError: string | null }[]>(Prisma.sql`
      SELECT status::text AS status, "runAt" <= (now() AT TIME ZONE 'UTC') AS due,
             (status = 'DONE' AND ${askedAt}::timestamp IS NOT NULL AND "startedAt" >= ${askedAt}::timestamp) AS done,
             "lastError"
        FROM jobs WHERE "dedupeKey" = ${key}`);
    const row = rows[0];
    if (row?.done) return;
    if (row?.status === "FAILED" && askedAt) throw new SeedGuardError(`the persona's recompute failed in the worker: ${(row.lastError ?? "").slice(0, 200)}`);
    if (row?.status === "RUNNING" || (row?.status === "QUEUED" && row.due && askedAt)) {
      await waiter.tick(`recompute ${row.status.toLowerCase()}`);
      continue;
    }
    askedAt = await dbNow(db);
    await db.$queryRaw(
      enqueueWeaknessSql({ userId: user.id, trigger: "heal", priority: JOB_PRIORITY.USER_OPENED, runAt: new Date(Date.now() - 1_000), debounceSec: 0 }),
    );
    await waiter.kick(true);
  }
}

async function snapshotOf(db: PrismaClient, userId: bigint) {
  const rows = await db.$queryRaw<{ status: string; gamesAnalysed: number; gamesInScope: number }[]>(Prisma.sql`
    SELECT status::text AS status, "gamesAnalysed", "gamesInScope" FROM weakness_snapshots
     WHERE "userId" = ${userId} ORDER BY "weekStart" DESC LIMIT 1`);
  return rows[0] ?? null;
}

/** The recompute a dead worker left on its last attempt; the running worker's reaper fails it (`worker_stalled`). */
async function crashLastAttempt(db: PrismaClient, user: TargetUser, waiter: Waiter): Promise<void> {
  const key = weaknessDedupeKey(user.id);
  await db.$transaction([
    db.$executeRaw(Prisma.sql`DELETE FROM weakness_snapshots WHERE "userId" = ${user.id}`),
    db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts, "maxAttempts",
                        "lockedBy", "lockedAt", "heartbeatAt", "startedAt", "createdAt")
      VALUES ('RECOMPUTE_WEAKNESS', ${key}, ${user.id}, ${JOB_PRIORITY.USER_OPENED}::smallint, 0,
              (now() AT TIME ZONE 'UTC') - interval '12 minutes', '{"v":1,"trigger":"heal"}'::jsonb, 'RUNNING',
              ${JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS}::smallint, ${JOB_MAX_ATTEMPTS.RECOMPUTE_WEAKNESS}::smallint, ${CRASHED_WORKER},
              (now() AT TIME ZONE 'UTC') - interval '11 minutes', (now() AT TIME ZONE 'UTC') - interval '10 minutes',
              (now() AT TIME ZONE 'UTC') - interval '11 minutes', (now() AT TIME ZONE 'UTC') - interval '12 minutes')
      ON CONFLICT ("dedupeKey") DO UPDATE SET
        status = 'RUNNING', attempts = jobs."maxAttempts", "lockedBy" = EXCLUDED."lockedBy", "lockedAt" = EXCLUDED."lockedAt",
        "heartbeatAt" = EXCLUDED."heartbeatAt", "startedAt" = EXCLUDED."startedAt", "finishedAt" = NULL, result = NULL,
        payload = jobs.payload - 'rerun'`),
  ]);
  await waiter.kick(true);
  for (;;) {
    const s = await snapshotOf(db, user.id);
    if (s?.status === "FAILED") return;
    await waiter.tick(s ? `snapshot ${s.status}` : "the reaper's FAILED snapshot");
  }
}

// ── Write ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function storedGames(db: PrismaClient, userId: bigint) {
  return db.$queryRaw<{ ref: string; id: bigint; status: string; completedAt: Date }[]>(Prisma.sql`
    SELECT g."referenceId" AS ref, g.id, g."analysisStatus"::text AS status, g."completedAt"
      FROM games g JOIN game_players gp ON gp."gameId" = g.id WHERE gp."userId" = ${userId}`);
}

/** The user's current games are exactly the planned ones, graded as planned, and recent enough to keep. */
export function canReuse(
  planned: readonly { ref: string; analyse: boolean; endedAt: Date }[],
  stored: readonly { ref: string; status: string; completedAt: Date }[],
): boolean {
  if (planned.length === 0 || planned.length !== stored.length) return false;
  const byRef = new Map(stored.map((s) => [s.ref, s]));
  for (const p of planned) {
    const s = byRef.get(p.ref);
    if (!s || s.status !== (p.analyse ? "DONE" : "NONE")) return false;
    if (Math.abs(s.completedAt.getTime() - p.endedAt.getTime()) > REUSE_MAX_AGE_MS) return false;
  }
  return true;
}

export async function writeP06Persona(db: PrismaClient, email: string, personaName: string, opts: P06WriteOptions): Promise<P06PersonaReport> {
  refuseShared(email);
  const state = getP06PersonaState(personaName);
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => undefined);
  await checkTripwire(db, MAX_TARGET_USERS);
  const user = await targetUser(db, email);
  // The real engine grades a game in 5–20 s (the dev worker: 1 OCPU); the fake one in under a second.
  const waiter = new Waiter({ ...opts, timeoutMs: opts.timeoutMs ?? Math.max(DEFAULT_TIMEOUT_MS, state.games.reduce((n, g) => n + g.count, 0) * PER_GAME_MS) }, `persona ${state.name}`);

  await db.$executeRaw(Prisma.sql`
    UPDATE users SET "timeZone" = ${state.timeZone}, "ratingBand" = ${state.ratingBand}::"RatingBand", "ratingBandSource" = 'self',
           "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${user.id}`);
  await clearP06State(db, email, { log });

  const plan = planGames(state, now);
  const { member: opponent } = await ensureSeedUser(db, { ...P06_OPPONENT }, true);
  if (!opponent) throw new SeedGuardError("the persona opponent could not be created");
  const member: SeedMember = { id: user.id, ref: user.ref, name: (await memberName(db, user.id)).slice(0, 40), rating: null };
  const fixtures = plan.map((g) => ({ planned: g, fixture: personaFixture(member, opponent, g, state) }));
  // weak-computing's ungraded games are written after its first build settled (a recompute's J4 coverage would queue
  // them for analysis otherwise, as it does for a real member's backlog).
  const now1 = fixtures.filter((f) => f.planned.analyse || state.finish !== "computing");
  const later = fixtures.filter((f) => !f.planned.analyse && state.finish === "computing");

  const stored = await storedGames(db, user.id);
  const reused = state.reuse && canReuse(fixtures.map((f) => ({ ref: f.fixture.game.ref, analyse: f.planned.analyse, endedAt: f.planned.endedAt })), stored);
  if (reused) {
    // The games and analyses stay; P5's clear removed the bank: the worker extracts it again from the stored analyses.
    const ids = stored.map((s) => s.id);
    await db.$transaction([
      db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE kind = 'EXTRACT_MISTAKES' AND "userId" = ${user.id}`),
      db.$executeRaw(Prisma.sql`
        INSERT INTO jobs (kind, "dedupeKey", "userId", "gameId", priority, "fairSeq", payload, "runAt", "maxAttempts", "createdAt")
        SELECT 'EXTRACT_MISTAKES', 'extract:' || g.id || ':' || ${user.id}::bigint || ':v' || ${EXTRACT_VERSION}::int, ${user.id}, g.id,
               ${JOB_PRIORITY.GAME_ENDED}::smallint, 0,
               jsonb_build_object('v', 1, 'gameId', g.id::text, 'userId', ${user.id}::bigint::text),
               (now() AT TIME ZONE 'UTC'), ${JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES}::smallint, (now() AT TIME ZONE 'UTC')
          FROM games g WHERE g.id = ANY(${ids}::bigint[]) AND g."analysisStatus" = 'DONE'
        ON CONFLICT ("dedupeKey") DO NOTHING`),
    ]);
    log(`[personas] p6 ${state.name}: kept ${stored.length} analysed game(s); EXTRACT_MISTAKES queued for each (the bank)`);
  } else {
    const cleared = await clearMemberGames(db, email);
    if (now1.length > 0) await writeFixtures(db, now1.map((f) => f.fixture));
    const toAnalyse = now1.filter((f) => f.planned.analyse);
    if (toAnalyse.length > 0) {
      const ids = await gameIds(db, toAnalyse.map((f) => f.fixture.game.ref));
      await db.$transaction(
        toAnalyse.map((f) =>
          db.$queryRaw(enqueueAnalysisSql({ gameId: ids.get(f.fixture.game.ref)!, gameRef: f.fixture.game.ref, priority: JOB_PRIORITY.GAME_ENDED, reason: "live_end" })),
        ),
      );
    }
    log(`[personas] p6 ${state.name}: cleared ${cleared} game(s), wrote ${now1.length}, queued ${toAnalyse.length} analysis job(s)`);
  }

  if (fixtures.length > 0) await waitForGames(db, user, waiter);
  if (state.finish !== "none") await settleRecompute(db, user, waiter);

  if (state.finish === "computing" && later.length > 0) {
    await writeFixtures(db, later.map((f) => f.fixture));
    const ids = await gameIds(db, later.map((f) => f.fixture.game.ref));
    await db.$transaction([
      ...later.map((f) =>
        db.$queryRaw(enqueueAnalysisSql({ gameId: ids.get(f.fixture.game.ref)!, gameRef: f.fixture.game.ref, priority: JOB_PRIORITY.IMPORT_NEWEST, reason: "backfill" })),
      ),
      // As J4 coverage queues a member's backlog (its jobs carry the member, so TR-5 counts them as the build's work),
      // due two years ahead so no worker claims them until the step releases them.
      db.$executeRaw(Prisma.sql`UPDATE jobs SET "runAt" = ${FROZEN_RUN_AT_SQL}, "userId" = ${user.id}
        WHERE kind = 'ANALYZE_GAME' AND status = 'QUEUED' AND "gameId" = ANY(${[...ids.values()]}::bigint[])`),
    ]);
    log(`[personas] p6 ${state.name}: ${later.length} game(s) still to grade (jobs due in 2 years)`);
  }
  if (state.finish === "orphaned") {
    await db.$transaction([
      db.$executeRaw(Prisma.sql`DELETE FROM weakness_snapshots WHERE "userId" = ${user.id}`),
      db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${weaknessDedupeKey(user.id)}`),
    ]);
  }
  if (state.finish === "failed") await crashLastAttempt(db, user, waiter);

  const snapshot = await snapshotOf(db, user.id);
  const analysed = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM game_players gp JOIN games g ON g.id = gp."gameId"
     WHERE gp."userId" = ${user.id} AND g."analysisStatus" = 'DONE'`);
  const report: P06PersonaReport = {
    persona: state.name,
    userId: user.id,
    userRef: user.ref,
    games: fixtures.length,
    analysed: analysed[0]?.n ?? 0,
    reused,
    snapshot,
    gameRefs: fixtures.map((f) => f.fixture.game.ref),
  };
  log(
    `[personas] p6 ${state.name}: ${report.games} game(s), ${report.analysed} analysed${reused ? " (kept)" : ""}; snapshot ` +
      (snapshot ? `${snapshot.status} ${snapshot.gamesAnalysed}/${snapshot.gamesInScope}` : "none"),
  );
  return report;
}

/**
 * A persona step a spec runs after the lease (P06_STEPS). `weak-computing:ready`: the frozen analyses fall due, the
 * worker grades them and the build finishes (READY), and the worker's own `weakness:ready` reaches the member's room.
 * `weakfail:crash`: the member's recompute (a Retry's) died on its last attempt again; the reaper fails it.
 * `weak-orphaned:again`: the auto-build's profile is gone again, its job row (and request time) kept.
 */
export async function runP06Step(db: PrismaClient, email: string, step: P06StepName | "weakfail:crash" | "weak-orphaned:again", opts: P06WriteOptions): Promise<P06PersonaReport["snapshot"]> {
  refuseShared(email);
  await checkTripwire(db, MAX_TARGET_USERS);
  const user = await targetUser(db, email);
  const waiter = new Waiter(opts, `step ${step}`);
  if (step === "weakfail:crash") {
    // Waits for whatever the Retry armed to finish first: the crash replaces a finished row, never a running one.
    for (;;) {
      const r = await db.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM jobs WHERE "dedupeKey" = ${weaknessDedupeKey(user.id)}`);
      if (!r[0] || (r[0].status !== "RUNNING" && r[0].status !== "QUEUED")) break;
      await waiter.tick(`the retry's recompute ${r[0].status.toLowerCase()}`);
    }
    await crashLastAttempt(db, user, waiter);
    return snapshotOf(db, user.id);
  }
  if (step === "weak-orphaned:again") {
    // The member's profile is gone again (its snapshots removed) once the auto-build's recompute has finished; the job
    // row stays, with the request time the durable limit reads, as it would after a build whose result was lost.
    for (;;) {
      const r = await db.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM jobs WHERE "dedupeKey" = ${weaknessDedupeKey(user.id)}`);
      if (!r[0] || (r[0].status !== "RUNNING" && r[0].status !== "QUEUED")) break;
      await waiter.tick(`the auto-build's recompute ${r[0].status.toLowerCase()}`);
    }
    await db.$executeRaw(Prisma.sql`DELETE FROM weakness_snapshots WHERE "userId" = ${user.id}`);
    return null;
  }
  if (!(step in P06_STEPS)) throw new SeedGuardError(`unknown persona step ${step}`);
  await db.$executeRaw(Prisma.sql`
    UPDATE jobs SET "runAt" = (now() AT TIME ZONE 'UTC')
     WHERE kind = 'ANALYZE_GAME' AND status = 'QUEUED'
       AND "gameId" IN (SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = ${user.id})`);
  await waitForGames(db, user, waiter);
  await settleRecompute(db, user, waiter);
  return snapshotOf(db, user.id);
}

async function memberName(db: PrismaClient, userId: bigint): Promise<string> {
  const rows = await db.$queryRaw<{ name: string | null }[]>(Prisma.sql`SELECT name FROM users WHERE id = ${userId}`);
  return rows[0]?.name || "member";
}

async function gameIds(db: PrismaClient, refs: readonly string[]): Promise<Map<string, bigint>> {
  const rows = await db.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`SELECT id, "referenceId" AS ref FROM games WHERE "referenceId" = ANY(${[...refs]}::text[])`);
  return new Map(rows.map((r) => [r.ref, r.id]));
}
