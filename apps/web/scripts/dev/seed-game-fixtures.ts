/**
 * Dev and e2e game fixtures (phase-02 plan 6.8, 12.6, 12.7). Creates games between two given members in the states
 * the specs need, through the same writers the app uses (@repo/db/games createLiveGame, @repo/db/live).
 *
 *   cd apps/web
 *   npx tsx scripts/dev/seed-game-fixtures.ts --list
 *   npx tsx scripts/dev/seed-game-fixtures.ts --white <email|userRef> --black <email|userRef> --fixture G-PROMO [--dry-run]
 *   npx tsx scripts/dev/seed-game-fixtures.ts --white … --black … --fixture all
 *   npx tsx scripts/dev/seed-game-fixtures.ts --white … --black … --fixture stress      # the stress=1 game
 *
 * Also imported by the e2e fixture (WEB/e2e/fixtures/games.ts, WP-I): `seedGameFixture(db, name, users)`.
 *
 * Guards (packages/db/prisma/seed-guards.ts), before any write: the URL comes from the shell (DIRECT_URL, else
 * DATABASE_URL) or .env.development.local, never .env.local (old prod); the host must be the Neon dev endpoint or a
 * local Postgres; the user-count tripwire. Fixtures only ADD games (e2e specs never assert absolute counts).
 *
 * Live fixtures start IN_PROGRESS in phase WAITING (both players set, the socket starts the game when both attach)
 * with studySeconds = 0 unless stated (G-STUDY: 30).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Chess } from "chess.js";
import { parse as parseEnv } from "dotenv";
import { INITIAL_FEN, createLiveGame, type CreateLiveGameInput } from "@repo/db/games";
import { checkpointGame, finishGame, type SqlClient } from "@repo/db/live";
import { DEV_ENV_FILE, SeedGuardError, assertUserTripwire, hostOf, isDevHost, resolveEnvVar } from "@repo/db/seed-guards";

export interface FixtureUser {
  id: bigint;
  ref: string;
  name: string;
  rating: number | null;
}

export interface FixtureUsers {
  white: FixtureUser;
  black: FixtureUser;
}

export interface SeededFixture {
  name: FixtureName;
  ref: string;
  id: bigint;
  /** What the fixture exercises (design states, owner tests). */
  exercises: string;
}

/** The SqlClient the fixtures need plus a raw-unsafe-free lookup (any PrismaClient fits). */
export type FixtureDb = SqlClient;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Dev endpoint or a local Postgres (CI, e2e). */
export function assertFixtureTarget(url: string | undefined | null): string {
  const host = hostOf(url);
  if (LOCAL_HOSTS.has(host) || isDevHost(host)) return host;
  throw new SeedGuardError(`refusing: ${host} is neither the Neon dev endpoint nor a local Postgres`);
}

// ─── Deterministic move generation (mulberry32, seed in the fixture) ─────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A legal, never-ending walk of `plies` moves from `fen`: prefers quiet moves (keeps material, so no insufficient
 * material), never plays a move that ends the game or repeats a position three times. Returns UCI moves.
 */
export function randomWalk(fen: string, plies: number, seed: number): { uci: string[]; fen: string } {
  const chess = new Chess(fen);
  const rand = mulberry32(seed);
  const uci: string[] = [];
  for (let i = 0; i < plies; i++) {
    const moves = chess.moves({ verbose: true });
    const quiet = moves.filter((m) => !m.captured && !m.promotion);
    const pool = [...(quiet.length > 0 ? quiet : moves)];
    let played = false;
    while (pool.length > 0) {
      const pick = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
      chess.move(pick);
      if (!chess.isGameOver()) {
        uci.push(pick.from + pick.to + (pick.promotion ?? ""));
        played = true;
        break;
      }
      chess.undo();
    }
    if (!played) throw new Error(`randomWalk: no non-terminal move at ply ${i} (seed ${seed})`);
  }
  return { uci, fen: chess.fen() };
}

/** Replays UCI moves from `fen`; returns the final FEN and SANs (throws on an illegal move). */
export function replayUci(fen: string, uci: readonly string[]): { fen: string; san: string[]; chess: Chess } {
  const chess = new Chess(fen);
  const san = uci.map((m) => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) }).san);
  return { fen: chess.fen(), san, chess };
}

function clk(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/**
 * Fixture PGN in the plan 8.12 shape (game-core `pgn.ts` is the production builder; this one only feeds fixtures):
 * headers, SetUp/FEN for non-initial starts, `{[%clk h:mm:ss.t]}` after each move.
 */
export function fixturePgn(opts: {
  ref: string;
  event: string;
  white: string;
  black: string;
  startFen: string;
  uci: readonly string[];
  clocksMs: readonly number[];
  result: "1-0" | "0-1" | "1/2-1/2";
  termination: string;
  timeControl: string;
  date: Date;
}): string {
  const { san } = replayUci(opts.startFen, opts.uci);
  const d = opts.date;
  const headers: [string, string][] = [
    ["Event", opts.event],
    ["Site", `https://playchess.tech/game/${opts.ref}`],
    ["Date", `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`],
    ["White", opts.white],
    ["Black", opts.black],
    ["Result", opts.result],
    ["TimeControl", opts.timeControl],
    ["Termination", opts.termination],
  ];
  if (opts.startFen.split(" ").slice(0, 4).join(" ") !== INITIAL_FEN.split(" ").slice(0, 4).join(" ")) {
    headers.push(["SetUp", "1"], ["FEN", opts.startFen]);
  }
  const f = opts.startFen.split(" ");
  let moveNo = Number.parseInt(f[5] ?? "1", 10) || 1;
  let black = f[1] === "b";
  const parts: string[] = [];
  san.forEach((s, i) => {
    if (!black) parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(s);
    if (opts.clocksMs[i] != null) parts.push(`{[%clk ${clk(opts.clocksMs[i]!)}]}`);
    if (black) moveNo++;
    black = !black;
  });
  parts.push(opts.result);
  return `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join("\n")}\n\n${parts.join(" ")}\n`;
}

/** Mover's remaining ms after each ply: a steady spend per move plus the increment. */
export function syntheticClocks(plies: number, initialMs: number, incMs: number, spendMs = 4_000): number[] {
  const left = { w: initialMs, b: initialMs };
  return Array.from({ length: plies }, (_, i) => {
    const side = i % 2 === 0 ? "w" : "b";
    left[side] = Math.max(1_000, left[side] - spendMs + incMs);
    return left[side];
  });
}

// ─── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────

export const OPERA_UCI =
  "e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 b5d7 f6d7 b3b8 d7b8 d1d8".split(
    " ",
  );

interface LiveSpec {
  kind: "live";
  fen: string | "legend";
  tc: [number, number];
  studySeconds?: number;
  header?: string;
  exercises: string;
}

export const FIXTURES = {
  "G-PROMO": { kind: "live", fen: "8/1P5k/8/8/8/8/6K1/8 w - - 0 41", tc: [300, 3], header: "Endgame · move 41", exercises: "promotion (T6)" },
  "G-LOWTIME": { kind: "live", fen: INITIAL_FEN, tc: [15, 0], exercises: "low_time, over_timeout_* (T7)" },
  "G-INSUFF": { kind: "live", fen: "8/8/8/4k3/8/8/4P3/4K3 w - - 0 81", tc: [20, 0], header: "Endgame · move 81", exercises: "over_timeout_insufficient" },
  "G-THREEFOLD": { kind: "live", fen: INITIAL_FEN, tc: [300, 0], exercises: "over_threefold; first-move abort" },
  "G-FIFTY": { kind: "live", fen: "8/8/4k3/8/8/4K3/8/R6r w - - 98 120", tc: [300, 0], header: "Endgame · move 120", exercises: "over_fifty" },
  "G-STALEMATE": { kind: "live", fen: "7k/4Q3/6K1/8/8/8/8/8 w - - 0 59", tc: [300, 0], header: "Endgame · move 59", exercises: "over_stalemate (59.Qf7); 59.Qf8# mates" },
  "G-STUDY": { kind: "live", fen: "legend", tc: [300, 3], studySeconds: 30, exercises: "study, abort, rematch flow" },
  "G-ENDED": { kind: "ended", exercises: "already_ended (completed checkmate with a PGN)" },
  "G-BOT-MID": { kind: "bot", exercises: "bot resume on another device (T15): 20 plies, server checkpoint, no journal" },
  stress: { kind: "stress", exercises: "stress=1: 120 plies, 20-character names, 3-digit move numbers, the longest opening header" },
} as const satisfies Record<string, LiveSpec | { kind: "ended" | "bot" | "stress"; exercises: string }>;

export type FixtureName = keyof typeof FIXTURES;
export const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

const in24h = () => new Date(Date.now() + 24 * 3600_000);
const side = (u: FixtureUser, name?: string) => ({ userId: u.id, name: name ?? u.name, rating: u.rating });

async function featuredLegendPosition(db: FixtureDb) {
  const { Prisma } = await import("@repo/db");
  const rows = await db.$queryRaw<
    { id: bigint; fen: string; white: string | null; black: string | null; event: string | null; year: number | null; moveNumber: number | null; sideToMove: string }[]
  >(Prisma.sql`
    SELECT id, fen, "whitePlayerName" AS white, "blackPlayerName" AS black, "tournamentName" AS event,
           EXTRACT(YEAR FROM "eventDate")::int AS year, "moveNumber", "sideToMove"
      FROM chess_positions WHERE "isActive" AND (featured OR "whitePlayerId" IS NOT NULL OR "blackPlayerId" IS NOT NULL)
     ORDER BY featured DESC, id LIMIT 1`);
  return rows[0] ?? null;
}

async function longestOpeningHeader(db: FixtureDb): Promise<string> {
  const { Prisma } = await import("@repo/db");
  const rows = await db.$queryRaw<{ eco: string; name: string }[]>(Prisma.sql`
    SELECT eco, name FROM openings WHERE "isActive" ORDER BY length(eco || ' · ' || name) DESC, id LIMIT 1`);
  const o = rows[0];
  return (o ? `${o.eco} · ${o.name}` : "C41 · Philidor Defense: Lion Variation, Lion's Claw Line with 5.g4").slice(0, 80);
}

/** Creates one fixture game. `db` is any PrismaClient (or a transaction client). */
export async function seedGameFixture(db: FixtureDb, name: FixtureName, users: FixtureUsers, now = new Date()): Promise<SeededFixture> {
  const spec = FIXTURES[name];
  const base = { creatorId: users.white.id, white: side(users.white), black: side(users.black), expiresAt: in24h(), now };

  if (spec.kind === "live") {
    let fen: string = spec.fen;
    let chessPositionId: bigint | null = null;
    const header = "header" in spec ? spec.header : null;
    let meta: CreateLiveGameInput["meta"] = header
      ? { v: 1, header, prefixSan: [], prefixStartMoveNo: 1, position: null }
      : null;
    if (spec.fen === "legend") {
      const p = await featuredLegendPosition(db);
      if (!p) throw new SeedGuardError("G-STUDY needs an active legend position: run `pnpm --filter @repo/db seed:content`");
      fen = p.fen;
      chessPositionId = p.id;
      const title = p.white && p.black ? `${p.white} vs ${p.black}${p.year ? ` ${p.year}` : ""}` : "Legend position";
      meta = {
        v: 1,
        header: title.slice(0, 80),
        prefixSan: [],
        prefixStartMoveNo: p.moveNumber ?? 1,
        position: { name: title.slice(0, 80), event: p.event?.slice(0, 80) ?? null, year: p.year, afterLabel: null, legendSide: p.sideToMove === "black" ? "b" : "w" },
      };
    }
    const g = await createLiveGame(db, {
      ...base,
      mode: "FRIEND",
      startingFen: fen,
      initialTimeSeconds: spec.tc[0],
      incrementSeconds: spec.tc[1],
      studySeconds: "studySeconds" in spec ? spec.studySeconds : 0,
      chessPositionId,
      meta,
      gameData: { gameMode: "friend", creatorColor: "white", fixture: name },
    });
    return { name, ref: g.ref, id: g.id, exercises: spec.exercises };
  }

  if (spec.kind === "ended") {
    const g = await createLiveGame(db, {
      ...base,
      mode: "FRIEND",
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 300,
      incrementSeconds: 3,
      meta: { v: 1, header: "C41 · Philidor Defense", prefixSan: [], prefixStartMoveNo: 1, position: null },
      gameData: { gameMode: "friend", creatorColor: "white", fixture: name },
    });
    const clocks = syntheticClocks(OPERA_UCI.length, 300_000, 3_000);
    const { fen } = replayUci(INITIAL_FEN, OPERA_UCI);
    const pgn = fixturePgn({
      ref: g.ref, event: "Replay Chess · Friend game", white: users.white.name, black: users.black.name, startFen: INITIAL_FEN,
      uci: OPERA_UCI, clocksMs: clocks, result: "1-0", termination: "Normal", timeControl: "300+3", date: now,
    });
    const r = await finishGame(db, {
      gameId: g.id, moves: OPERA_UCI.join(" "), clocksMs: clocks, plyCount: OPERA_UCI.length, fen,
      whiteTimeMs: clocks[clocks.length - 1]!, blackTimeMs: clocks[clocks.length - 2]!, method: "checkmate", winner: "w",
      pgn, endedAt: now,
    });
    if (!r.finished) throw new Error("G-ENDED: finish did not apply");
    return { name, ref: g.ref, id: g.id, exercises: spec.exercises };
  }

  if (spec.kind === "bot") {
    const { Prisma } = await import("@repo/db");
    const bot = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE code = 'CHESS_BOT_001' LIMIT 1`);
    const g = await createLiveGame(db, {
      mode: "BOT",
      creatorId: users.white.id,
      white: side(users.white),
      black: null,
      bot: { elo: 1200, userId: bot[0]?.id ?? null },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 600,
      incrementSeconds: 0,
      expiresAt: in24h(),
      now,
      meta: { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null },
      gameData: { gameMode: "AI", playerColor: "white", fixture: name },
    });
    const walk = randomWalk(INITIAL_FEN, 20, 20_2611);
    const clocks = syntheticClocks(20, 600_000, 0, 9_000);
    // The bot checkpoint shape (plan 6.6.7): moves, clocks, fen and meta.rev; no client journal exists.
    await db.$executeRaw(Prisma.sql`
      UPDATE games SET moves = ${walk.uci.join(" ")}, "moveClocksMs" = ${clocks}::int[], "plyCount" = 20, fen = ${walk.fen},
             "whiteTimeMs" = ${clocks[18]!}, "blackTimeMs" = ${clocks[19]!},
             meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{rev}', '20'::jsonb), "lastMoveAt" = ${now}::timestamp(3), "updatedAt" = now()
       WHERE id = ${g.id} AND status = 'IN_PROGRESS' AND mode = 'BOT'`);
    return { name, ref: g.ref, id: g.id, exercises: spec.exercises };
  }

  // stress=1 (testing X9): 120 plies, 20-character names, a 3-digit move number, the longest opening header.
  const header = await longestOpeningHeader(db);
  const opening = randomWalk(INITIAL_FEN, 30, 1_202_611);
  const f = opening.fen.split(" ");
  f[5] = "45"; // later moves reach 104…105: three-digit move numbers in the strip and the list
  const startFen = f.join(" ");
  const walk = randomWalk(startFen, 120, 120_2611);
  const clocks = syntheticClocks(120, 900_000, 10_000, 6_000);
  const g = await createLiveGame(db, {
    ...base,
    white: side(users.white, "Maximilian_Oberhaus2"),
    black: side(users.black, "Alexandra_Kowalczyk9"),
    mode: "FRIEND",
    startingFen: startFen,
    initialTimeSeconds: 900,
    incrementSeconds: 10,
    studySeconds: 0,
    meta: { v: 1, header, prefixSan: [], prefixStartMoveNo: 1, position: null },
    gameData: { gameMode: "friend", creatorColor: "white", fixture: name },
  });
  await checkpointGame(db, {
    gameId: g.id, moves: walk.uci.join(" "), clocksMs: clocks, plyCount: 120, fen: walk.fen,
    whiteTimeMs: clocks[118]!, blackTimeMs: clocks[119]!, clockRunning: "w", phase: "playing", phaseEndsAt: null, lastMoveAt: now,
  });
  return { name, ref: g.ref, id: g.id, exercises: spec.exercises };
}

/** Looks a member up by email or users.referenceId (rating: the Chess.com blitz rating when linked). */
export async function resolveFixtureUser(db: FixtureDb, emailOrRef: string): Promise<FixtureUser> {
  const { Prisma } = await import("@repo/db");
  const rows = await db.$queryRaw<FixtureUser[]>(Prisma.sql`
    SELECT u.id, u."referenceId" AS ref, u.name, c."blitzRating" AS rating
      FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id
     WHERE u.email = ${emailOrRef} OR u."referenceId" = ${emailOrRef} LIMIT 1`);
  const u = rows[0];
  if (!u) throw new SeedGuardError(`no user ${emailOrRef} (provision it first: npx tsx e2e/scripts/provision-test-users.ts)`);
  return u;
}

// ─── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────

function resolveTargetUrl(): { url: string; origin: string } {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // CI has no env file; the shell must provide the URL.
  }
  const r = resolveEnvVar("DIRECT_URL", process.env.DIRECT_URL || process.env.DATABASE_URL, fileValues.DIRECT_URL || fileValues.DATABASE_URL);
  return { url: r.value, origin: r.origin };
}

function parseArgs(argv: string[]) {
  const out: { white?: string; black?: string; fixture?: string; dryRun: boolean; list: boolean } = { dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--white") out.white = argv[++i];
    else if (a === "--black") out.black = argv[++i];
    else if (a === "--fixture") out.fixture = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list") out.list = true;
    else throw new SeedGuardError(`unknown argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const n of FIXTURE_NAMES) console.log(`${n.padEnd(12)} ${FIXTURES[n].exercises}`);
    return;
  }
  if (!args.white || !args.black || !args.fixture) {
    throw new SeedGuardError("usage: seed-game-fixtures.ts --white <email|ref> --black <email|ref> --fixture <name|all> [--dry-run] | --list");
  }
  const names: FixtureName[] =
    args.fixture === "all" ? FIXTURE_NAMES : FIXTURE_NAMES.includes(args.fixture as FixtureName) ? [args.fixture as FixtureName] : [];
  if (names.length === 0) throw new SeedGuardError(`unknown fixture ${args.fixture} (try --list)`);
  const { url, origin } = resolveTargetUrl();
  const host = assertFixtureTarget(url);
  console.log(`[fixtures] target host ${host} (from ${origin}); ${names.join(", ")}`);
  const { PrismaClient, Prisma } = await import("@repo/db");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const [users] = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM users`);
    assertUserTripwire(users?.count ?? -1);
    const white = await resolveFixtureUser(db, args.white);
    const black = await resolveFixtureUser(db, args.black);
    if (white.id === black.id) throw new SeedGuardError("--white and --black must be different members");
    if (args.dryRun) {
      console.log(`[fixtures] dry run: would create ${names.length} game(s) for ${white.ref} (White) and ${black.ref} (Black)`);
      return;
    }
    for (const n of names) {
      const r = await seedGameFixture(db, n, { white, black });
      console.log(`[fixtures] ${n.padEnd(12)} /game/${r.ref}   ${r.exercises}`);
    }
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof SeedGuardError ? `[fixtures] ${err.message}` : err);
    process.exit(1);
  });
}
