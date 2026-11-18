/**
 * The P6 volume gate (phase-06 plan §9.1 "seeded with 20 members × 2,000 games, 500 mistakes, 3,000 attempts", §12.8;
 * FIX-2, review round 2 / FIX-1 #7): `EXPLAIN (ANALYZE, BUFFERS)` of the Weakness Profile's hot statements, their own
 * builders (the web's TR-5 / TR-7 reads and the kick CAS, the worker's Q-W5 and Q-W6), with the plan's time and buffer
 * limits, on a throwaway Postgres holding the plan's volume. `explain-hot-queries.ts` stays the shape and index gate on
 * an almost empty database; this one runs the statements against real volume and times them.
 *
 *   cd apps/web
 *   DATABASE_URL=postgresql://…@127.0.0.1:…/vol npx tsx scripts/explain-weakness-volume.ts --seed   # seed, then the gate
 *   DATABASE_URL=… npx tsx scripts/explain-weakness-volume.ts                                       # the gate only
 *   … [--runs 7] [--json <file>]
 *
 * The seed. ONE template member is built by the product's pipelines (test/api/weakness-world.ts): real CC0 Lichess
 * games and the oracle games, graded and written as the worker writes them (games, game_players, game_analyses,
 * player_reviews, the analysis job); B-W1's per-game inputs; the A6 bank (J1's extraction of every key moment, the
 * mistakes and their cards); bank sessions on 20 consecutive days graded through W1 (training_attempts as the product
 * writes them); a READY snapshot from the real computeWeakness(). The template's rows are then cloned, set-based, into
 * 20 members: every unique key re-keyed (ids, referenceIds, epd hashes, item keys, client attempt ids), the games
 * re-dated over two years (so the 6-month scope holds about a quarter of each member's 2,000), 500 mistakes with their
 * BANK cards and occurrences, 3,000 attempts, 12 weekly snapshots, the weakness job row and a few queued analyses each.
 * Then ANALYZE. Local or CI Postgres only (the host guard); never Neon.
 *
 * The gate: each statement runs once to warm the cache, then `--runs` times (default 5); the median execution time
 * must be under the plan's limit, Q-W1 must read fewer than 10 shared buffers, and no plan may Seq Scan game_players,
 * mistakes, training_cards, training_attempts, jobs or weakness_snapshots. Exit 0 = pass, 1 = a limit broken (printed),
 * 2 = setup error. `--json` writes the measurements (no data, no connection string).
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ok } from "@repo/contracts/http/envelope";
import { SessionPayload, type AttemptIn } from "@repo/contracts/http/train";
import { Prisma, PrismaClient } from "@repo/db";
import { weaknessKickCasSql } from "@repo/db/weakness-jobs";
import { isWeaknessCandidate } from "@repo/chess-training/themes";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import { weaknessOwnCardsSql } from "@/lib/train/sessions.server";
import { bankThemeCountsSql, latestSnapshotSql, scopeCountsSql, weaknessJobsSql } from "@/lib/train/weakness.server";
import { examplesStatement } from "../../analysis-worker/src/weakness/examples";
import { weaknessInputsStatement } from "../../analysis-worker/src/weakness/load";
import { weaknessWorld, WORLD_NOW, type Member } from "../test/api/weakness-world";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
export const VOLUME = { members: 20, games: 2_000, mistakes: 500, attempts: 3_000, weeks: 12 } as const;
const DAY_MS = 86_400_000;
/** The tables no hot statement may Seq Scan (§9.1 "None of the above"). */
export const NO_SEQ = ["game_players", "mistakes", "training_cards", "training_attempts", "jobs", "weakness_snapshots"] as const;

/** The plan's limits (§9.1), milliseconds of execution. */
export const LIMITS_MS: Readonly<Record<string, number>> = {
  "Q-W1 latest snapshot": 0.3,
  "Q-W2 bank counts by theme": 3,
  "Q-W3 probe (game_players part)": 4,
  "Q-W3 jobs part": 0.5,
  "Q-W5 worker inputs": 10,
  "Q-W6 examples": 5,
  "Q-W7 drill own items": 3,
  "Q-W12 kick CAS": 0.5,
};
const Q_W1_MAX_SHARED_HITS = 10;
/**
 * A Seq Scan over a listed table is a failure unless the table is this small (pages): the planner rightly scans a
 * table of a few pages rather than walk an index (weakness_snapshots holds 20 × 12 rows, 7 pages, at the plan's
 * volume); at production size the same statement takes the index (explain-hot-queries.ts proves every index path
 * exists with sequential scans off).
 */
export const SMALL_TABLE_PAGES = 32;

type Sql = Prisma.Sql | { text: string; values: readonly unknown[] };

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
}

function walk(n: PlanNode, f: (n: PlanNode) => void): void {
  f(n);
  for (const c of n.Plans ?? []) walk(c, f);
}

const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

function textOf(sql: Sql): { text: string; values: unknown[] } {
  // Prisma.Sql: `.text` carries Postgres placeholders ($1 …); `.sql` the generic "?".
  if ("strings" in sql) return { text: sql.text, values: [...sql.values] };
  return { text: sql.text, values: [...sql.values] };
}

// ── the seed ────────────────────────────────────────────────────────────────────────────────────────────────────
async function columns(db: PrismaClient, table: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ c: string }[]>(Prisma.sql`SELECT column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER' ORDER BY ordinal_position`);
  return rows.map((r) => r.c);
}

/** `INSERT INTO table (every column) SELECT <override, else src."col"> FROM <from>`: one clone statement. */
async function clone(db: PrismaClient, table: string, from: string, overrides: Record<string, string>): Promise<number> {
  const cols = await columns(db, table);
  const select = cols.map((c) => overrides[c] ?? `src."${c}"`);
  return db.$executeRawUnsafe(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${select.join(", ")} FROM ${from}`);
}

/** Every timestamp column of a table shifted back by `shift` (an SQL interval expression). */
async function shifted(db: PrismaClient, table: string, shift: string): Promise<Record<string, string>> {
  const rows = await db.$queryRaw<{ c: string }[]>(Prisma.sql`SELECT column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND data_type LIKE 'timestamp%'`);
  return Object.fromEntries(rows.map((r) => [r.c, `src."${r.c}" - (${shift})`]));
}

/** The template member through the product's pipelines; returns its id and its row counts. */
async function buildTemplate(url: string): Promise<{ id: bigint; opp: bigint; teardown: () => Promise<void> }> {
  const w = weaknessWorld(url);
  await w.setup();
  const T: Member = await w.member("volume-template", { timeZone: "Asia/Kolkata", rating: 1350, ratingBand: "R1200_1600" });
  const O = await w.member("volume-opp", { timeZone: "Europe/Berlin", rating: 1380 });
  await w.playCc0(T, O, { count: 62, spacingDays: 2 });
  await w.playOracles(T, O, { count: 30, spacingDays: 4 });
  const inputs = await w.computeInputs([T]);
  if (inputs.failed > 0) throw new Error(`B-W1 left ${inputs.failed} rows`);
  const banked = await w.bank(T);
  if (banked < 20) throw new Error(`only ${banked} moments banked`);
  // 20 days of bank sessions, every item graded through W1 (a few misses), as a member trains.
  let attempts = 0;
  for (let d = 1; d <= 20; d++) {
    const now = new Date(WORLD_NOW.getTime() + d * DAY_MS);
    const s = await w.call("sessions", "POST", "/api/train/sessions", T, { body: { kind: "bank", source: "bank" }, headers: { "Idempotency-Key": w.uuid() }, now });
    if (s.res.status !== 200 && s.res.status !== 201) continue;
    const session = ok(SessionPayload).parse(await s.json()).data;
    const items = session.items.filter((i) => i.pass === 1 && i.cardRef);
    const body: AttemptIn[] = items.map((item, k) => ({
      clientAttemptId: randomUUID(),
      sessionRef: session.ref,
      itemId: item.itemId,
      cardRef: item.cardRef,
      puzzleId: null,
      kind: item.kind,
      solved: k % 4 !== 3,
      firstTry: k % 4 !== 3,
      hintsUsed: 0,
      wrongMovesUci: [],
      solutionShown: k % 4 === 3,
      timeMs: 8_000 + 1_000 * k,
      grade: k % 4 === 3 ? "again" : "good",
      suggestedGrade: k % 4 === 3 ? "again" : "good",
      cardReps: item.cardReps,
      reviewedAt: new Date(now.getTime() + 60_000 * (k + 1)).toISOString(),
    }));
    for (let i = 0; i < body.length; i += 20) {
      const r = await w.call("attempts", "POST", "/api/train/attempts", T, { body: { attempts: body.slice(i, i + 20) }, now: new Date(now.getTime() + 30 * 60_000) });
      if (r.res.status === 200) attempts += Math.min(20, body.length - i);
    }
  }
  if (attempts < 50) throw new Error(`only ${attempts} attempts written`);
  const built = await w.recompute(T);
  if (built.draft.status !== "READY") throw new Error(`the template's profile is ${built.draft.status}`);
  console.log(`template: ${banked} bank cards, ${attempts} attempts graded through W1, profile ${built.draft.status}`);
  // The template's rows stay (the clones' source); the world's own teardown would delete them.
  return { id: T.id, opp: O.id, teardown: async () => undefined };
}

async function seed(db: PrismaClient, url: string): Promise<void> {
  const t0 = Date.now();
  const { id: T } = await buildTemplate(url);
  const tg = Number((await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM game_players WHERE "userId" = ${T}`))[0]!.n);
  const tm = Number((await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE "userId" = ${T}`))[0]!.n);
  const ta = Number((await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${T}`))[0]!.n);
  const K = Math.ceil(VOLUME.games / tg);
  const KM = Math.ceil(VOLUME.mistakes / tm);
  const KA = Math.ceil(VOLUME.attempts / ta);
  if (KM > K) throw new Error(`mistake copies (${KM}) need as many game copies (${K}) for distinct occurrences`);
  console.log(`template rows: ${tg} game sides, ${tm} mistakes, ${ta} attempts → ${K}× games, ${KM}× mistakes, ${KA}× attempts per member`);
  const span = 730 / K; // days between the game copies: two years in all
  for (let m = 1; m <= VOLUME.members; m++) {
    await db.$transaction(
      async (tx) => {
        const c = tx as unknown as PrismaClient;
        const tag = `v${m}`;
        // The member: the template's users row re-keyed (and its training profile).
        const [u] = await c.$queryRawUnsafe<{ id: bigint }[]>(
          `INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "ratingBand", "subscriptionStatus", "updatedAt")
           SELECT left(md5(src."referenceId" || '${tag}'), 25), left(md5(src.code || '${tag}'), 12), md5(src."googleId" || '${tag}'),
                  '${tag}-' || src.email, src.name, src."timeZone", src."ratingBand", 'active', now()
             FROM users src WHERE src.id = ${T} RETURNING id`,
        );
        const M = u!.id;
        await clone(c, "training_profiles", `training_profiles src WHERE src."userId" = ${T}`, { userId: `${M}` });
        // Games: K copies of each template game, re-dated, re-keyed; the member's side only.
        await c.$executeRawUnsafe(`CREATE TEMP TABLE gmap ON COMMIT DROP AS
          SELECT gp."gameId" AS old, k, nextval(pg_get_serial_sequence('games', 'id')) AS new
            FROM game_players gp CROSS JOIN generate_series(0, ${K - 1}) k WHERE gp."userId" = ${T}`);
        const gShift = `make_interval(days => (map.k * ${span})::int)`;
        await clone(c, "games", `games src JOIN gmap map ON map.old = src.id`, {
          ...(await shifted(c, "games", gShift)),
          id: "map.new",
          referenceId: `left(md5(src."referenceId" || map.k || '${tag}'), length(src."referenceId"))`,
          externalId: "NULL",
          creatorId: `CASE WHEN src."creatorId" = ${T} THEN ${M} ELSE src."creatorId" END`,
          opponentId: `CASE WHEN src."opponentId" = ${T} THEN ${M} ELSE src."opponentId" END`,
          winnerId: `CASE WHEN src."winnerId" = ${T} THEN ${M} ELSE src."winnerId" END`,
          whitePlayerId: `CASE WHEN src."whitePlayerId" = ${T} THEN ${M} ELSE src."whitePlayerId" END`,
          blackPlayerId: `CASE WHEN src."blackPlayerId" = ${T} THEN ${M} ELSE src."blackPlayerId" END`,
          rematchOfId: "NULL",
        });
        await clone(c, "game_players", `game_players src JOIN gmap map ON map.old = src."gameId" WHERE src."userId" = ${T}`, {
          ...(await shifted(c, "game_players", gShift)),
          gameId: "map.new",
          userId: `${M}`,
          linkedAccountId: "NULL",
          purgeLinkId: "NULL",
        });
        await clone(c, "game_analyses", `game_analyses src JOIN gmap map ON map.old = src."gameId"`, { ...(await shifted(c, "game_analyses", gShift)), gameId: "map.new" });
        // Mistakes, their BANK cards and occurrences: KM copies, the copy k pointing at game copy k.
        await c.$executeRawUnsafe(`CREATE TEMP TABLE mmap ON COMMIT DROP AS
          SELECT src.id AS old, k, nextval(pg_get_serial_sequence('mistakes', 'id')) AS new
            FROM mistakes src CROSS JOIN generate_series(0, ${KM - 1}) k WHERE src."userId" = ${T}`);
        const mShift = `make_interval(days => (map.k * ${span})::int)`;
        await clone(c, "mistakes", `mistakes src JOIN mmap map ON map.old = src.id`, {
          ...(await shifted(c, "mistakes", mShift)),
          id: "map.new",
          userId: `${M}`,
          referenceId: `left(md5(src."referenceId" || map.k || '${tag}'), length(src."referenceId"))`,
          epdHash: `src."epdHash" # (map.k::bigint << 48)`,
          lastGameId: `COALESCE((SELECT g.new FROM gmap g WHERE g.old = src."lastGameId" AND g.k = map.k), src."lastGameId")`,
        });
        await clone(c, "mistake_occurrences", `mistake_occurrences src JOIN mmap map ON map.old = src."mistakeId" JOIN gmap g ON g.old = src."gameId" AND g.k = map.k`, {
          ...(await shifted(c, "mistake_occurrences", mShift)),
          mistakeId: "map.new",
          gameId: "g.new",
        });
        await c.$executeRawUnsafe(`CREATE TEMP TABLE cmap ON COMMIT DROP AS
          SELECT src.id AS old, map.k, map.new AS mistake, nextval(pg_get_serial_sequence('training_cards', 'id')) AS new
            FROM training_cards src JOIN mmap map ON map.old = src."mistakeId" WHERE src."userId" = ${T}`);
        await clone(c, "training_cards", `training_cards src JOIN cmap map ON map.old = src.id`, {
          ...(await shifted(c, "training_cards", `make_interval(days => (map.k * 3)::int)`)),
          id: "map.new",
          userId: `${M}`,
          mistakeId: "map.mistake",
          itemKey: `left(src."itemKey", 24) || '.' || map.k || '${tag}'`,
        });
        // Attempts: KA copies, a day apart per copy, on the cloned cards.
        await clone(c, "training_attempts", `training_attempts src CROSS JOIN generate_series(0, ${KA - 1}) ka WHERE src."userId" = ${T}`, {
          ...(await shifted(c, "training_attempts", `make_interval(days => ka)`)),
          id: `nextval(pg_get_serial_sequence('training_attempts', 'id'))`,
          clientAttemptId: `md5(src."clientAttemptId"::text || ka || '${tag}')::uuid`,
          userId: `${M}`,
          cardId: `COALESCE((SELECT cm.new FROM cmap cm WHERE cm.old = src."cardId" AND cm.k = (ka % ${KM})), src."cardId")`,
          sessionId: "NULL",
        });
        // 12 weekly snapshots (the template's READY document), the weakness job row, a few queued analyses.
        await clone(c, "weakness_snapshots", `weakness_snapshots src CROSS JOIN generate_series(0, ${VOLUME.weeks - 1}) w WHERE src."userId" = ${T}`, {
          userId: `${M}`,
          weekStart: `src."weekStart" - (w * 7)`,
          computedAt: `src."computedAt" - make_interval(days => w * 7)`,
        });
        await c.$executeRawUnsafe(`INSERT INTO jobs (kind, "dedupeKey", "userId", priority, "runAt", payload, status, attempts, "maxAttempts", "finishedAt", "createdAt")
          VALUES ('RECOMPUTE_WEAKNESS', 'weakness:' || ${M}, ${M}, 50, now() - interval '1 day', '{"v":1,"trigger":"analysis"}', 'DONE', 1, 3, now() - interval '1 day', now() - interval '1 day')`);
        await c.$executeRawUnsafe(`INSERT INTO jobs (kind, "dedupeKey", "userId", "gameId", priority, "runAt", payload, status, attempts, "maxAttempts", "createdAt")
          SELECT 'ANALYZE_GAME', 'analyze:' || g.new, ${M}, g.new, 20, now(), jsonb_build_object('v', 1, 'gameId', g.new::text, 'gameRef', 'x', 'reason', 'regrade'), 'QUEUED', 0, 3, now()
            FROM gmap g WHERE g.k = ${K - 1} LIMIT 5`);
      },
      { timeout: 600_000, maxWait: 60_000 },
    );
    process.stdout.write(`member ${m}/${VOLUME.members} cloned\r`);
  }
  for (const t of ["users", "games", "game_players", "game_analyses", "mistakes", "mistake_occurrences", "training_cards", "training_attempts", "weakness_snapshots", "jobs", "training_profiles"]) {
    await db.$executeRawUnsafe(`ANALYZE ${t}`);
  }
  console.log(`\nseeded in ${Math.round((Date.now() - t0) / 1000)} s`);
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────────────────────────
interface Measured {
  name: string;
  limitMs: number;
  medianMs: number;
  runsMs: number[];
  sharedHit: number;
  seqScans: string[];
  pass: boolean;
}

async function explain(db: PrismaClient, sql: Sql, write: boolean): Promise<{ ms: number; plan: PlanNode; hit: number }> {
  const { text, values } = textOf(sql);
  const run = async (c: PrismaClient) => {
    const rows = await c.$queryRawUnsafe<{ "QUERY PLAN": unknown }[]>(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${text}`, ...values);
    const doc = rows[0]!["QUERY PLAN"] as Array<{ Plan: PlanNode; "Execution Time": number }>;
    return doc[0]!;
  };
  let out!: { Plan: PlanNode; "Execution Time": number };
  if (write) {
    // A write is measured inside a transaction that is rolled back (the kick CAS changes a job row).
    await db
      .$transaction(async (tx) => {
        out = await run(tx as unknown as PrismaClient);
        throw new Error("rollback");
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== "rollback") throw e;
      });
  } else out = await run(db);
  let hit = 0;
  walk(out.Plan, (n) => {
    if (n === out.Plan) hit = (n["Shared Hit Blocks"] ?? 0) + (n["Shared Read Blocks"] ?? 0);
  });
  return { ms: out["Execution Time"], plan: out.Plan, hit };
}

async function gate(db: PrismaClient, runs: number): Promise<Measured[]> {
  const [member] = await db.$queryRaw<{ id: bigint; tz: string }[]>(Prisma.sql`
    SELECT u.id, u."timeZone" AS tz FROM users u WHERE u.email LIKE 'v1-%' ORDER BY u.id LIMIT 1`);
  if (!member) throw new Error("no seeded member (run with --seed first)");
  const M = member.id;
  const now = new Date();
  const scope = resolveScope(null);
  const since = scopeSince(now, member.tz, scope.months);
  const counts = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM game_players WHERE "userId" = ${M}`);
  const inScope = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM game_players WHERE "userId" = ${M} AND "endedAt" >= ${since}`);
  const mistakes = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM mistakes WHERE "userId" = ${M}`);
  const attempts = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${M}`);
  const members = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM users WHERE email LIKE 'v%-%'`);
  console.log(
    `member ${M}: ${counts[0]!.n} games (${inScope[0]!.n} in the 6-month scope), ${mistakes[0]!.n} mistakes, ${attempts[0]!.n} attempts; ${members[0]!.n} seeded members`,
  );
  // The patterns the statements are asked about are the member's own top weaknesses (the snapshot's topKeys), as the
  // worker's Q-W6 and a drill's Q-W7 are; never a meta tag every mistake carries.
  const [snap] = await db.$queryRaw<{ top: string[] | null }[]>(Prisma.sql`
    SELECT ARRAY(SELECT jsonb_array_elements_text(metrics->'topKeys')) AS top FROM weakness_snapshots WHERE "userId" = ${M} ORDER BY "weekStart" DESC LIMIT 1`);
  const patterns = (snap?.top ?? []).filter((t) => isWeaknessCandidate(t));
  if (patterns.length === 0) throw new Error("the seeded snapshot has no top patterns");
  const statements: { name: string; sql: Sql; write?: boolean }[] = [
    { name: "Q-W1 latest snapshot", sql: latestSnapshotSql(M) },
    { name: "Q-W2 bank counts by theme", sql: bankThemeCountsSql(M, now) },
    { name: "Q-W3 probe (game_players part)", sql: scopeCountsSql(M, since, scope.timeClasses, scope.maxGames) },
    { name: "Q-W3 jobs part", sql: weaknessJobsSql(M) },
    { name: "Q-W5 worker inputs", sql: weaknessInputsStatement(String(M), since, scope.timeClasses) },
    { name: "Q-W6 examples", sql: examplesStatement(String(M), patterns) },
    { name: "Q-W7 drill own items", sql: weaknessOwnCardsSql(M, now, patterns[0]!) },
    { name: "Q-W12 kick CAS", sql: weaknessKickCasSql(M, now), write: true },
  ];
  const out: Measured[] = [];
  for (const s of statements) {
    await explain(db, s.sql, s.write === true);
    const runsMs: number[] = [];
    let plan!: PlanNode;
    let hit = 0;
    for (let i = 0; i < runs; i++) {
      const r = await explain(db, s.sql, s.write === true);
      runsMs.push(r.ms);
      plan = r.plan;
      hit = r.hit;
    }
    const seqScans: string[] = [];
    const scanned: string[] = [];
    walk(plan, (n) => {
      if (n["Node Type"] === "Seq Scan" && n["Relation Name"] && (NO_SEQ as readonly string[]).includes(n["Relation Name"])) scanned.push(n["Relation Name"]);
    });
    for (const t of scanned) {
      const [r] = await db.$queryRaw<{ pages: number }[]>(Prisma.sql`SELECT relpages AS pages FROM pg_class WHERE relname = ${t} AND relkind = 'r'`);
      if ((r?.pages ?? 0) > SMALL_TABLE_PAGES) seqScans.push(t);
      else console.log(`     (${s.name}: Seq Scan on ${t}, ${r?.pages ?? 0} pages: smaller than an index walk)`);
    }
    const limitMs = LIMITS_MS[s.name]!;
    const medianMs = median(runsMs);
    const pass = medianMs < limitMs && seqScans.length === 0 && (s.name !== "Q-W1 latest snapshot" || hit < Q_W1_MAX_SHARED_HITS);
    out.push({ name: s.name, limitMs, medianMs, runsMs, sharedHit: hit, seqScans, pass });
    console.log(
      `${pass ? "ok  " : "FAIL"} ${s.name.padEnd(32)} median ${medianMs.toFixed(3)} ms < ${limitMs} ms · buffers ${hit}${seqScans.length ? ` · Seq Scan ${seqScans.join(", ")}` : ""}`,
    );
  }
  return out;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (a throwaway local Postgres after migrate deploy)");
    return 2;
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`refusing to run against ${host}: a local or CI Postgres only`);
    return 2;
  }
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf("--runs") + 1] ?? 5) || 5;
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    if (args.includes("--seed")) await seed(db, url);
    const results = await gate(db, args.includes("--runs") ? runs : 5);
    const jsonAt = args.indexOf("--json");
    if (jsonAt >= 0 && args[jsonAt + 1]) writeFileSync(args[jsonAt + 1]!, `${JSON.stringify({ volume: VOLUME, results }, null, 1)}\n`);
    return results.every((r) => r.pass) ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}
