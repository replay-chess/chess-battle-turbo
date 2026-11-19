// The database world of the P6 weakness route tests (phase-06 plan §12.2), on a throwaway Postgres after `prisma migrate
// deploy` (M6 included). Every row a member's profile is built from went through the product's own pipelines:
//   - games: real CC0 Lichess games (`@repo/chess-fixtures` cc0-pool: real moves, the real per-ply clocks, Lichess's
//     engine evals) and the oracle games (real best moves, so their errors carry themes), graded by the worker's grader
//     and written with every row the worker writes (games, game_players with accuracy, game_analyses, player_reviews,
//     the ANALYZE_GAME job) by the P3 seed writer, between members in different zones, over five months;
//   - the per-game weakness inputs: B-W1 (`runWeaknessInputs`, the same `computeSideInputs` the worker's final batch
//     and heal run);
//   - the Mistake Bank: every key error of the member's reviews added through A6 (`setMomentInBank`: the review's
//     "Add to Mistake Bank" switch, the J1 extraction of the moment and the card), then B-W2's time-pressure tag;
//   - the snapshot: the real `computeWeakness()` (TRN, the synthetic baseline the worker loads by default) over the
//     Q-W5 rows read back from Postgres, examples from Q-W6, written as Q-W10 does (upsert + the version bump when
//     `weaknessBumped`), the way the plan's persona writers produce snapshots (§6.8: never hand-written).
// The route handlers run through route() with the injected auth seam (lib/api/context.ts) and a pinned request clock.
// Never Neon: TEST_DATABASE_URL only.
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@repo/db";
import { buildWeaknessMetrics } from "@repo/db/json";
import { buildFixture, oracleEnding, oracleGames, oracleInput, type SeedFixture, type SeedMember } from "@repo/db/seed/builders";
import { writeFixtures } from "@repo/db/seed/writer";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { cc0Game, cc0TimedIndexes } from "@repo/chess-analysis/fixtures/weakness-inputs";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { loadBaseline } from "@repo/chess-training/baselines/load";
import { attachExamples, computeWeakness, failedMetrics, type WeaknessSnapshotDraft } from "@repo/chess-training/weakness/compute";
import { resolveScope, scopeSince, weekStartOf } from "@repo/chess-training/weakness/scope";
import type { WeaknessGameInput, WeaknessExampleDoc } from "@repo/chess-training/weakness/types";
import { weaknessBumped } from "@repo/chess-training/weakness/version";
import { Chess } from "chess.js";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import { isApiError } from "@/lib/api/api-error";
import { setMomentInBank } from "@/lib/train/links.server";
import { runTimePressure } from "../../scripts/backfill/backfill-mistake-timepressure";
import { runWeaknessInputs } from "../../scripts/backfill/backfill-weakness-inputs";
import { installTestDeps, jsonOf, noParams, request, viewerFixture, type Recorded } from "../helpers/route-harness";

/** Tuesday 2026-11-17 19:00 UTC: the world's "now" (the games run back about five months from it). */
export const WORLD_NOW = new Date("2026-11-17T19:00:00.000Z");
const DAY = 86_400_000;

/** The test hooks (`FLAGS_OVERRIDE` is honoured only with them on), the internal key ring and the worker origin. */
export const WEAKNESS_ENV = {
  NEXT_PUBLIC_APP_ENV: "test",
  ALLOW_TEST_HOOKS: "1",
  ANALYSIS_WORKER_URL: "http://worker.test",
  INTERNAL_API_SECRET: `webwk:${"w".repeat(64)}`,
} as const;

export const ROUTES = {
  weakness: "app/api/train/weakness/route",
  recompute: "app/api/train/weakness/recompute/route",
  seen: "app/api/train/weakness/seen/route",
  sessions: "app/api/train/sessions/route",
  attempts: "app/api/train/attempts/route",
} as const;
export type RouteName = keyof typeof ROUTES;
type Handlers = { GET?: RouteHandler; POST?: RouteHandler };

export type Member = SeedMember & { email: string; timeZone: string };

export type CallInit = {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  now?: Date;
  viewer?: Viewer | null;
  signedOut?: boolean;
  env?: Record<string, string | undefined>;
  /** The real fixed-window limiter (rate_limit_buckets). */
  realRateLimit?: boolean;
};

type Outcome = "WHITE" | "BLACK" | "DRAW";
const METHOD: Record<string, "CHECKMATE" | "RESIGNATION" | "TIMEOUT" | "AGREEMENT" | "STALEMATE" | "ABANDONED"> = {
  mate: "CHECKMATE",
  resign: "RESIGNATION",
  outoftime: "TIMEOUT",
  timeout: "ABANDONED",
  draw: "AGREEMENT",
  stalemate: "STALEMATE",
};
const ORACLE_TC: Record<string, number> = { bullet: 60, blitz: 300, rapid: 600, classical: 1800 };
const outcomeOf = (winner: string | null | undefined): Outcome => (winner === "white" ? "WHITE" : winner === "black" ? "BLACK" : "DRAW");
const resultOf = (o: Outcome, side: "w" | "b") => (o === "DRAW" ? "draw" : (o === "WHITE") === (side === "w") ? "win" : "loss");

/** One Q-W5 row (the worker's input read, §7.4.2 step 3) as the engine takes it. */
function inputOf(r: Record<string, unknown>): WeaknessGameInput {
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number) : []);
  return {
    gameId: String(r.gameId),
    color: r.color as "w" | "b",
    endedAt: r.endedAt instanceof Date ? r.endedAt : r.endedAt ? new Date(`${String(r.endedAt)}Z`) : null,
    timeClass: (r.timeClass as WeaknessGameInput["timeClass"]) ?? null,
    mode: r.mode as WeaknessGameInput["mode"],
    result: (r.result as WeaknessGameInput["result"]) ?? null,
    ratingBefore: r.ratingBefore === null ? null : Number(r.ratingBefore),
    rated: r.rated === true,
    source: r.source as WeaknessGameInput["source"],
    oppTitle: (r.oppTitle as string | null) ?? null,
    ecoCode: (r.ecoCode as string | null) ?? null,
    accuracy: r.accuracy === null ? null : Number(r.accuracy),
    phaseAccuracy: nums(r.phaseAccuracy),
    stats: nums(r.stats),
    errorLog: nums(r.errorLog),
    errorThemeN: nums(r.errorThemeN),
    errorThemes: Array.isArray(r.errorThemes) ? r.errorThemes.map(String) : [],
    weaknessInputsV: Number(r.weaknessInputsV ?? 0),
    evalSource: (r.evalSource as WeaknessGameInput["evalSource"]) ?? null,
  };
}

/** The board an example shows: the stored FEN after the setup move (the member to move). */
function exampleFen(fen: string, setupUci: string | null): string | null {
  if (!setupUci) return fen;
  try {
    const c = new Chess(fen);
    c.move({ from: setupUci.slice(0, 2), to: setupUci.slice(2, 4), ...(setupUci.length > 4 ? { promotion: setupUci[4] } : {}) });
    return c.fen();
  } catch {
    return null;
  }
}

export function weaknessWorld(url: string) {
  let db!: PrismaClient;
  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const users: bigint[] = [];
  const H = {} as Record<RouteName, Handlers>;
  const kicks: unknown[] = [];
  let restoreKick: (() => void) | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  async function setup() {
    process.env.DATABASE_URL = url;
    for (const [k, v] of Object.entries(WEAKNESS_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    savedEnv.FLAGS_OVERRIDE = process.env.FLAGS_OVERRIDE;
    flags(true);
    db = new PrismaClient({ datasourceUrl: url });
    for (const [name, file] of Object.entries(ROUTES)) H[name as RouteName] = (await import(`@/${file}`)) as Handlers;
    const { setKickTransport } = await import("@/lib/services/analysis/kick");
    restoreKick = setKickTransport(async (_u, init) => {
      kicks.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ draining: false, nextRunAt: null }), { status: 202 });
    });
  }

  async function teardown() {
    restoreKick?.();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!db) return;
    if (users.length) {
      const ids = users.map(String);
      await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "userId" = ANY(${ids}::bigint[])`);
      await db.$executeRaw(Prisma.sql`DELETE FROM training_sessions WHERE "userId" = ANY(${ids}::bigint[])`);
      await db.$executeRaw(Prisma.sql`DELETE FROM games WHERE "creatorId" = ANY(${ids}::bigint[])`);
      await db.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ANY(${ids}::bigint[])`);
    }
    await db.$disconnect();
  }

  /** The `weakness` (and `train`) flags through FLAGS_OVERRIDE, honoured with test hooks on, as in e2e. */
  function flags(weakness: boolean) {
    process.env.FLAGS_OVERRIDE = `train:on,weakness:${weakness ? "on" : "off"}`;
  }

  /** A users row (`@test.invalid`, so the seed tripwire ignores it). */
  async function member(label: string, o: { timeZone?: string; rating?: number | null; ratingBand?: string | null } = {}): Promise<Member> {
    const n = users.length + 1;
    const ref = `cp6w${run}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(21, "0");
    const tz = o.timeZone ?? "UTC";
    const email = `p6w-${label}-${run}-${n}@test.invalid`;
    const [r] = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "ratingBand", "updatedAt")
      VALUES (${ref}, ${`p6w${run}${n}`.slice(0, 20)}, ${`g-p6w-${run}-${n}`}, ${email}, ${`${label}_${n}`.slice(0, 40)}, ${tz},
              ${o.ratingBand ?? null}::"RatingBand", now())
      RETURNING id`);
    await db.$executeRaw(Prisma.sql`INSERT INTO user_stats ("referenceId", "userId", "updatedAt") VALUES (${`s${ref}`.slice(0, 30)}, ${r!.id}, now())`);
    users.push(r!.id);
    // `rating: null` (FIX-4): a member whose games carry no rating (with no onboarding band: no rating band at all).
    return { id: r!.id, ref, name: `${label}_${n}`.slice(0, 40), rating: o.rating === undefined ? 1350 : o.rating, email, timeZone: tz };
  }

  /**
   * Real CC0 games between `m` and `opp` (CC0 timed games `from`…`from+count-1`, optionally only some time classes),
   * the newest `newestDaysAgo` days before WORLD_NOW, `spacingDays` apart. Returns the game refs.
   */
  async function playCc0(m: Member, opp: Member, o: { count: number; from?: number; spacingDays?: number; newestDaysAgo?: number; timeClasses?: readonly string[]; analysed?: boolean }): Promise<string[]> {
    const fixtures: SeedFixture[] = [];
    const pool = cc0TimedIndexes().filter((i) => !o.timeClasses || o.timeClasses.includes(cc0Game(i).timeClass ?? ""));
    const picked = pool.slice(o.from ?? 0, (o.from ?? 0) + o.count);
    if (picked.length < o.count) throw new Error(`only ${picked.length} CC0 games match`);
    for (const [k, i] of picked.entries()) {
      const g = cc0Game(i);
      const color = k % 2 === 0 ? "w" : "b";
      const outcome = outcomeOf(g.winner);
      const f = buildFixture({
        key: `p6w-cc0-${run}-${m.ref}-${i}`,
        scope: run,
        member: m,
        memberColor: color,
        opponent: { kind: "member", member: opp },
        mode: "ONLINE",
        startFen: INITIAL_FEN,
        moves: g.input.moves,
        tc: { initialSeconds: g.initialTimeSeconds, incrementSeconds: g.incrementSeconds },
        outcome,
        method: METHOD[g.status] ?? "RESIGNATION",
        completedAt: new Date(WORLD_NOW.getTime() - ((o.newestDaysAgo ?? 1) + k * (o.spacingDays ?? 2.3)) * DAY),
        analysis:
          o.analysed === false
            ? { kind: "none" }
            : {
                kind: "done",
                input: { ...g.input, members: [{ side: "w", result: resultOf(outcome, "w") }, { side: "b", result: resultOf(outcome, "b") }] },
                provenance: "lichess-oracle",
                reason: "live_end",
                priority: JOB_PRIORITY.GAME_ENDED,
              },
        tag: "p6-weakness-api",
      });
      // The export's real clock record (the import mapper's rule), not the seed's synthetic one.
      f.game.moveClocksMs = g.moveClocksMs;
      fixtures.push(f);
    }
    await writeFixtures(db, fixtures);
    return fixtures.map((f) => f.game.ref);
  }

  /** The oracle games (real best moves: their errors carry themes), `m` against `opp`. */
  async function playOracles(m: Member, opp: Member, o: { count: number; newestDaysAgo?: number; spacingDays?: number }): Promise<void> {
    const games = oracleGames();
    const fixtures: SeedFixture[] = [];
    for (let k = 0; k < Math.min(o.count, games.length); k++) {
      const { game, input } = oracleInput(k, []);
      const { outcome, method } = oracleEnding(game);
      const color = k % 2 === 0 ? "b" : "w";
      fixtures.push(
        buildFixture({
          key: `p6w-oracle-${run}-${m.ref}-${game.id}`,
          scope: run,
          member: m,
          memberColor: color,
          opponent: { kind: "member", member: opp },
          mode: "FRIEND",
          startFen: INITIAL_FEN,
          moves: input.moves,
          tc: { initialSeconds: ORACLE_TC[game.speed] ?? 600, incrementSeconds: 0 },
          outcome,
          method,
          completedAt: new Date(WORLD_NOW.getTime() - ((o.newestDaysAgo ?? 0.5) + k * (o.spacingDays ?? 6)) * DAY),
          analysis: {
            kind: "done",
            input: { ...input, members: [{ side: "w", result: resultOf(outcome as Outcome, "w") }, { side: "b", result: resultOf(outcome as Outcome, "b") }] },
            provenance: "lichess-oracle",
            reason: "live_end",
            priority: JOB_PRIORITY.GAME_ENDED,
          },
          tag: "p6-weakness-api",
        }),
      );
    }
    await writeFixtures(db, fixtures);
  }

  /** B-W1 for these members (the worker's final batch and heal run the same `computeSideInputs`). */
  async function computeInputs(ms: readonly Member[]) {
    // No engine regrades here (FIX-2: B-W1 arms one per side tagged from stored data alone): no worker runs in these
    // route tests, and a revived analysis job would read as analysis work in progress. p06-backfills.int.test covers it.
    return runWeaknessInputs(db, { userIds: ms.map((m) => m.id), regrade: false });
  }

  /**
   * Every key error of `m`'s reviews into the Mistake Bank through A6 (the member's "Add to Mistake Bank": the moment's
   * mistake from the J1 extraction, then its BANK card), then B-W2's time-pressure tag. Returns the cards created. A
   * moment the extraction cannot bank answers 409 `not_bankable` in the product too, and is skipped.
   */
  async function bank(m: Member, now: Date = WORLD_NOW): Promise<number> {
    const moments = await db.$queryRaw<{ ref: string; ply: number }[]>(Prisma.sql`
      SELECT g."referenceId" AS ref, (mo->>'ply')::int AS ply
        FROM game_players gp
        JOIN games g ON g.id = gp."gameId"
        JOIN player_reviews pr ON pr."gameId" = gp."gameId" AND pr.color = gp.color
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.content->'moments', '[]'::jsonb)) mo
       WHERE gp."userId" = ${m.id}
       ORDER BY gp."endedAt", 2`);
    const viewer = viewerOf(m);
    let cards = 0;
    for (const x of moments) {
      try {
        const out = await setMomentInBank(viewer, x.ref, x.ply, true, now);
        if (out !== "admin_noop" && out.card) cards++;
      } catch (err) {
        if (!isApiError(err) || (err.code !== "conflict" && err.code !== "not_found")) throw err;
      }
    }
    await runTimePressure(db, { userIds: [m.id], apply: true });
    return cards;
  }

  /** Q-W5 (§7.4.2 step 3): the member's candidate sides in the scope window, newest first, ≤ 300. */
  async function inputs(m: Member, now: Date): Promise<WeaknessGameInput[]> {
    const p = (await db.$queryRaw<{ tc: string[]; months: number }[]>(Prisma.sql`
      SELECT "weaknessTimeClasses"::text[] AS tc, "weaknessMonths" AS months FROM training_profiles WHERE "userId" = ${m.id}`))[0];
    const scope = resolveScope(p ? { weaknessTimeClasses: p.tc, weaknessMonths: Number(p.months) } : null);
    const since = scopeSince(now, m.timeZone, scope.months);
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT gp."gameId", gp.color, gp."endedAt", gp."timeClass"::text AS "timeClass", gp.mode::text AS mode,
             gp.result::text AS result, gp."ratingBefore", gp.rated, gp.source::text AS source, gp."ecoCode", gp.accuracy,
             gp."phaseAccuracy", gp.stats, gp."errorThemes", gp."errorLog", gp."errorThemeN", gp."weaknessInputsV",
             CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END AS "oppTitle", ga."evalSource"::text AS "evalSource"
        FROM game_players gp JOIN games g ON g.id = gp."gameId" LEFT JOIN game_analyses ga ON ga."gameId" = gp."gameId"
       WHERE gp."userId" = ${m.id} AND gp."endedAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
         AND gp."timeClass"::text = ANY(${[...scope.timeClasses]}::text[])
         AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
       ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 300`);
    return rows.map(inputOf);
  }

  /**
   * One recompute's write, as the worker's RECOMPUTE_WEAKNESS does it (§7.4.2 steps 3–9): the real computeWeakness() on
   * the Q-W5 rows, Q-W6's example positions, then Q-W10 (the snapshot upsert for the local week and, when the version
   * rule bumps, `weaknessVersion + 1`). Returns the draft and the version afterwards.
   */
  async function recompute(m: Member, now: Date = WORLD_NOW): Promise<{ draft: WeaknessSnapshotDraft; version: number; bumped: boolean }> {
    const rows = await inputs(m, now);
    const prof = (await db.$queryRaw<{ tc: string[]; months: number }[]>(Prisma.sql`
      SELECT "weaknessTimeClasses"::text[] AS tc, "weaknessMonths" AS months FROM training_profiles WHERE "userId" = ${m.id}`))[0];
    const band = (await db.$queryRaw<{ band: string | null }[]>(Prisma.sql`SELECT "ratingBand"::text AS band FROM users WHERE id = ${m.id}`))[0]?.band ?? null;
    let draft = computeWeakness(rows, loadBaseline(), {
      now,
      timeZone: m.timeZone,
      profile: prof ? { weaknessTimeClasses: prof.tc, weaknessMonths: Number(prof.months) } : null,
      ratingBand: band as Parameters<typeof computeWeakness>[2]["ratingBand"],
    });
    const patterns = draft.metrics.rows.map((r) => r.pattern);
    if (patterns.length) {
      const ex = await db.$queryRaw<{ pattern: string; ref: string; fen: string; setupUci: string | null; color: "w" | "b" }[]>(Prisma.sql`
        SELECT DISTINCT ON (t) t AS pattern, m."referenceId" AS ref, m.fen, m."setupUci", m.color
          FROM mistakes m CROSS JOIN LATERAL unnest(m.themes) t
         WHERE m."userId" = ${m.id} AND m."hiddenAt" IS NULL AND t = ANY(${patterns}::text[])
         ORDER BY t, m."isPuzzle" DESC, m."lastPlayedAt" DESC, m.id DESC`);
      const map = new Map<string, WeaknessExampleDoc>();
      for (const e of ex) {
        const fen = exampleFen(e.fen, e.setupUci);
        if (fen) map.set(e.pattern, { fen, orient: e.color, mistakeRef: e.ref });
      }
      draft = { ...draft, metrics: attachExamples(draft.metrics, map) };
    }
    const prev = (await db.$queryRaw<{ status: string; topKeys: string[] | null }[]>(Prisma.sql`
      SELECT status::text AS status, ARRAY(SELECT jsonb_array_elements_text(metrics->'topKeys')) AS "topKeys"
        FROM weakness_snapshots WHERE "userId" = ${m.id} AND status = 'READY' ORDER BY "weekStart" DESC LIMIT 1`))[0];
    const bumped = weaknessBumped({ status: draft.status, hadReady: !!prev, prevTop: prev?.topKeys ?? null, topKeys: draft.metrics.topKeys });
    await writeSnapshot(m, now, draft.status, draft);
    if (bumped) {
      await db.$executeRaw(Prisma.sql`INSERT INTO training_profiles ("userId", "weaknessVersion", "updatedAt") VALUES (${m.id}, 1, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("userId") DO UPDATE SET "weaknessVersion" = training_profiles."weaknessVersion" + 1, "updatedAt" = EXCLUDED."updatedAt"`);
    }
    const v = (await db.$queryRaw<{ v: number }[]>(Prisma.sql`SELECT "weaknessVersion" AS v FROM training_profiles WHERE "userId" = ${m.id}`))[0];
    return { draft, version: Number(v?.v ?? 0), bumped };
  }

  async function writeSnapshot(m: Member, now: Date, status: "READY" | "INSUFFICIENT" | "FAILED", d: Omit<WeaknessSnapshotDraft, "status">) {
    const metrics = buildWeaknessMetrics(d.metrics);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO weakness_snapshots ("userId", "weekStart", "algoVersion", status, "timeClasses", since, "gamesInScope", "gamesAnalysed",
                                      "ratingBandMin", "ratingBandMax", metrics, headline, "computedAt")
      VALUES (${m.id}, ${weekStartOf(now, m.timeZone)}::date, 1, ${status}::"WeaknessStatus", ${d.timeClasses as string[]}::"TimeClass"[],
              (${d.since.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${d.gamesInScope}::smallint, ${d.gamesAnalysed}::smallint,
              ${d.ratingBandMin}::smallint, ${d.ratingBandMax}::smallint, ${JSON.stringify(metrics)}::jsonb, ${d.headline},
              (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("userId", "weekStart") DO UPDATE SET "algoVersion" = EXCLUDED."algoVersion", status = EXCLUDED.status,
        "timeClasses" = EXCLUDED."timeClasses", since = EXCLUDED.since, "gamesInScope" = EXCLUDED."gamesInScope",
        "gamesAnalysed" = EXCLUDED."gamesAnalysed", "ratingBandMin" = EXCLUDED."ratingBandMin", "ratingBandMax" = EXCLUDED."ratingBandMax",
        metrics = EXCLUDED.metrics, headline = EXCLUDED.headline, "computedAt" = EXCLUDED."computedAt"`);
  }

  /**
   * The final failed attempt (§7.4.2 "Retries and failure"): the job row FAILED after its 3 attempts and a FAILED
   * snapshot from `failedMetrics` (no READY row exists for this member).
   */
  async function failRecompute(m: Member, now: Date, code = "compute_error") {
    const rows = await inputs(m, now);
    const scope = resolveScope(null);
    const since = scopeSince(now, m.timeZone, scope.months);
    const analysed = rows.filter((r) => r.accuracy !== null).length;
    const metrics = failedMetrics({ code, at: now, scope, since, inScope: rows.length, analysed, baseline: loadBaseline() });
    await writeSnapshot(m, now, "FAILED", {
      timeClasses: [...scope.timeClasses],
      since,
      gamesInScope: rows.length,
      gamesAnalysed: analysed,
      ratingBandMin: null,
      ratingBandMax: null,
      metrics,
      headline: null,
    });
    await db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "fairSeq", "runAt", payload, status, attempts, "maxAttempts", "lastError", "finishedAt", "createdAt")
      VALUES ('RECOMPUTE_WEAKNESS', ${`weakness:${m.id}`}, ${m.id}, ${JOB_PRIORITY.WEAKNESS}::smallint, 0,
              (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${JSON.stringify({ v: 1, trigger: "analysis" })}::jsonb, 'FAILED', 3, 3,
              ${`${code}: the worker gave up`}, (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'FAILED', attempts = 3, "lastError" = EXCLUDED."lastError", "finishedAt" = EXCLUDED."finishedAt"`);
  }

  function viewerOf(m: Member, overrides: Parameters<typeof viewerFixture>[0] = {}): Viewer {
    const v = viewerFixture({ id: m.id, ref: m.ref, ...overrides, user: { ref: m.ref, name: m.name, timeZone: m.timeZone, ...overrides.user } });
    return { ...v, accounts: v.accounts ?? [] };
  }

  async function call(name: RouteName, method: keyof Handlers, path: string, m: Member | null, init: CallInit = {}) {
    const realLimiter = init.realRateLimit ? (await import("@/lib/rate-limit-db")).checkRateLimit : undefined;
    const t = installTestDeps({
      userId: init.signedOut || !m ? null : `user_${m.ref}`,
      viewer: init.signedOut || !m ? null : init.viewer === undefined ? viewerOf(m) : init.viewer,
      env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV, ...init.env },
      clock: (init.now ?? WORLD_NOW).getTime(),
      ...(realLimiter ? { overrides: { checkRateLimit: realLimiter } } : {}),
    });
    try {
      const handler = H[name][method];
      if (!handler) throw new Error(`${name} has no ${method}`);
      const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
      const res = await handler(request(path, { method, headers: { "content-type": "application/json", ...init.headers }, body }), noParams({}));
      return { res, recorded: t.recorded, json: async () => (res.status === 204 || res.status === 304 ? null : jsonOf(res)) };
    } finally {
      t.restore();
    }
  }

  /** Runs the request's `after()` tasks the way Next does: after the response, with the same route deps. */
  async function runAfter(recorded: Recorded, now: Date = WORLD_NOW) {
    const tasks = recorded.afterTasks.splice(0);
    const t = installTestDeps({ clock: now.getTime(), env: { ...WEAKNESS_ENV } });
    try {
      for (const task of tasks) await task();
    } finally {
      t.restore();
    }
  }

  return {
    setup,
    teardown,
    flags,
    member,
    playCc0,
    playOracles,
    computeInputs,
    bank,
    inputs,
    recompute,
    failRecompute,
    viewerOf,
    call,
    runAfter,
    kicks,
    uuid: () => randomUUID(),
    get db() {
      return db;
    },
  };
}

export type WeaknessWorld = ReturnType<typeof weaknessWorld>;

/** A lapsed member's viewer (402 `subscription_required`, `details.reason`). */
export function lapsed(world: WeaknessWorld, m: Member): Viewer {
  return world.viewerOf(m, { entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } });
}

export async function count(db: PrismaClient, sql: Prisma.Sql): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint | number }[]>(sql);
  return Number(rows[0]?.n ?? 0);
}
