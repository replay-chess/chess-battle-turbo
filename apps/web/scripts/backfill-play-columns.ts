/**
 * Backfill of the M2 play columns for legacy games (phase-02 plan 6.8; data-model B1 + B2). DEV ONLY.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill-play-columns.ts              # dry run (default): counts and samples, writes nothing
 *   npx tsx scripts/backfill-play-columns.ts --apply      # writes, then runs the verification queries
 *   npx tsx scripts/backfill-play-columns.ts --verify     # verification queries only
 *
 * Guards, all before any query:
 * - The URL comes from the shell (DIRECT_URL, else DATABASE_URL) or from .env.development.local, never .env.local
 *   (old prod). Only the host is printed.
 * - BACKFILL_ALLOWED_HOSTS: the Neon dev endpoint (packages/db/prisma/seed-guards.ts DEV_HOST_ALLOWLIST) or a local
 *   Docker Postgres. Anything else is refused; there is no override flag.
 * - The user-count tripwire (≤ 60 users).
 *
 * Batches of 500 `WHERE mode IS NULL AND id > $cursor ORDER BY id`; each game is one transaction. Idempotent: a row
 * is touched only while `mode IS NULL`, and game_players inserts use ON CONFLICT DO NOTHING. P1 did not create
 * `audit_logs` (M4), so the counts are printed (keep the output with the sign-off).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Chess } from "chess.js";
import { parse as parseEnv } from "dotenv";
import {
  DEV_ENV_FILE,
  SeedGuardError,
  assertUserTripwire,
  hostOf,
  isDevHost,
  resolveEnvVar,
} from "@repo/db/seed-guards";

// ─── Pure rules (unit-tested in backfill-play-columns.test.ts) ──────────────────────────────────────────────────

export type Mode = "BOT" | "FRIEND" | "ONLINE" | "TOURNAMENT";
export type Color = "w" | "b";
export type EndMethod =
  | "CHECKMATE"
  | "RESIGNATION"
  | "TIMEOUT"
  | "STALEMATE"
  | "THREEFOLD"
  | "FIFTY_MOVE"
  | "INSUFFICIENT_MATERIAL"
  | "AGREEMENT";
export type Outcome = "WHITE" | "BLACK" | "DRAW";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** BACKFILL_ALLOWED_HOSTS: the Neon dev endpoint or a local Docker Postgres. */
export function assertBackfillTarget(url: string | undefined | null): string {
  const host = hostOf(url);
  if (LOCAL_HOSTS.has(host) || isDevHost(host)) return host;
  throw new SeedGuardError(`refusing: ${host} is not in BACKFILL_ALLOWED_HOSTS (the Neon dev endpoint or localhost)`);
}

export interface LegacyGame {
  id: bigint;
  status: string;
  result: string | null;
  creatorId: bigint;
  opponentId: bigint | null;
  tournamentId: bigint | null;
  startingFen: string;
  initialTimeSeconds: number;
  incrementSeconds: number;
  creatorTimeRemaining: number;
  opponentTimeRemaining: number;
  gameData: unknown;
  completedAt: Date | null;
  updatedAt: Date;
  creatorName: string | null;
  opponentName: string | null;
}

interface GameDataLike {
  gameMode?: unknown;
  playerColor?: unknown;
  creatorColor?: unknown;
  difficulty?: unknown;
  moveHistory?: unknown;
  method?: unknown;
  fen?: unknown;
}

export const DIFFICULTY_ELO: Record<string, number> = { easy: 800, medium: 1400, hard: 1800, expert: 2200 };

export function modeOf(gameData: GameDataLike, tournamentId: bigint | null, opponentIsBot: boolean): Mode {
  const m = typeof gameData.gameMode === "string" ? gameData.gameMode.toLowerCase() : "";
  if (m === "ai" || opponentIsBot) return "BOT";
  if (m === "tournament" || tournamentId != null) return "TOURNAMENT";
  if (m === "quick") return "ONLINE";
  return "FRIEND";
}

function colorOf(value: unknown): Color | null {
  if (value === "white" || value === "w") return "w";
  if (value === "black" || value === "b") return "b";
  return null;
}

/** The creator's colour (B2 rules); null when unknown (both colour columns stay NULL, meta.colorUnknown). */
export function creatorColorOf(mode: Mode, gameData: GameDataLike): Color | null {
  if (mode === "BOT") return colorOf(gameData.playerColor);
  if (mode === "ONLINE" || mode === "TOURNAMENT") return colorOf(gameData.creatorColor) ?? "w"; // creator = White by construction
  return colorOf(gameData.creatorColor);
}

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

function toMove(entry: unknown): { from: string; to: string; promotion?: string } | string | null {
  if (typeof entry === "string") {
    const u = UCI.exec(entry);
    return u ? { from: u[1]!, to: u[2]!, ...(u[3] ? { promotion: u[3] } : {}) } : entry;
  }
  if (entry && typeof entry === "object") {
    const e = entry as { from?: unknown; to?: unknown; promotion?: unknown; lan?: unknown; san?: unknown };
    if (typeof e.lan === "string" && UCI.test(e.lan)) return toMove(e.lan);
    if (typeof e.from === "string" && typeof e.to === "string") {
      return { from: e.from, to: e.to, ...(typeof e.promotion === "string" ? { promotion: e.promotion } : {}) };
    }
    if (typeof e.san === "string") return e.san;
  }
  return null;
}

export interface Replay {
  uci: string[];
  fen: string;
  truncated: boolean;
  mateFixed: boolean;
  chess: Chess;
}

/** Replays gameData.moveHistory from startingFen; stops at the first illegal entry (truncated). */
export function replayHistory(startingFen: string, gameData: GameDataLike): Replay {
  const chess = new Chess(startingFen);
  const history = Array.isArray(gameData.moveHistory) ? gameData.moveHistory : [];
  const uci: string[] = [];
  let truncated = false;
  for (const entry of history) {
    const move = toMove(entry);
    if (move === null) {
      truncated = true;
      break;
    }
    try {
      const m = chess.move(move);
      uci.push(m.from + m.to + (m.promotion ?? ""));
    } catch {
      truncated = true;
      break;
    }
  }
  // DB-03: the mating move was often lost. When the stored method is checkmate and the replay is not mate, try each
  // legal move whose resulting placement equals the stored final FEN.
  let mateFixed = false;
  if (!truncated && gameData.method === "checkmate" && !chess.isCheckmate() && typeof gameData.fen === "string") {
    const target = gameData.fen.split(" ")[0];
    for (const m of chess.moves({ verbose: true })) {
      const probe = new Chess(chess.fen());
      probe.move(m);
      if (probe.fen().split(" ")[0] === target && probe.isCheckmate()) {
        chess.move(m);
        uci.push(m.from + m.to + (m.promotion ?? ""));
        mateFixed = true;
        break;
      }
    }
  }
  return { uci, fen: chess.fen(), truncated, mateFixed, chess };
}

/** Maps gameData.method; a stored draw_agreement on a threefold or fifty-move position is relabelled (socket F-12). */
export function endMethodOf(method: unknown, replay: Replay): EndMethod | null {
  switch (method) {
    case "checkmate":
      return "CHECKMATE";
    case "resignation":
      return "RESIGNATION";
    case "timeout":
      return "TIMEOUT";
    case "stalemate":
      return "STALEMATE";
    case "insufficient_material":
      return "INSUFFICIENT_MATERIAL";
    case "draw_agreement":
      if (replay.chess.isThreefoldRepetition()) return "THREEFOLD";
      if (replay.chess.isDrawByFiftyMoves()) return "FIFTY_MOVE";
      return "AGREEMENT";
    default:
      if (replay.chess.isCheckmate()) return "CHECKMATE";
      if (replay.chess.isStalemate()) return "STALEMATE";
      return null;
  }
}

/** Winner from the legacy result and the creator's colour. */
export function outcomeOf(result: string | null, creatorColor: Color | null): Outcome | null {
  if (result === "DRAW") return "DRAW";
  if (!creatorColor) return null;
  const opp: Color = creatorColor === "w" ? "b" : "w";
  const winner =
    result === "CREATOR_WON" || result === "OPPONENT_TIMEOUT" ? creatorColor : result === "OPPONENT_WON" || result === "CREATOR_TIMEOUT" ? opp : null;
  return winner === "w" ? "WHITE" : winner === "b" ? "BLACK" : null;
}

export function timeClassOf(initial: number, inc: number): "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" {
  const est = initial + 40 * inc;
  return est < 180 ? "BULLET" : est < 480 ? "BLITZ" : est < 1500 ? "RAPID" : "CLASSICAL";
}

export function startPlyOf(fen: string): number {
  const f = fen.trim().split(/\s+/);
  const n = Number.parseInt(f[5] ?? "1", 10);
  return 2 * ((Number.isFinite(n) && n >= 1 ? n : 1) - 1) + (f[1] === "b" ? 1 : 0);
}

export interface PlayerPlan {
  userId: bigint;
  color: Color;
  result: "WIN" | "LOSS" | "DRAW" | null;
  opponentUserId: bigint | null;
  opponentName: string;
  opponentRating: number | null;
}

export interface BackfillPlan {
  id: bigint;
  mode: Mode;
  timeClass: string;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  botElo: number | null;
  startPly: number;
  moves: string;
  plyCount: number;
  fen: string;
  whiteTimeMs: number;
  blackTimeMs: number;
  phase: "WAITING" | "PLAYING" | "ENDED";
  endMethod: EndMethod | null;
  outcome: Outcome | null;
  whiteName: string | null;
  blackName: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  meta: Record<string, unknown>;
  players: PlayerPlan[];
  flags: { truncated: boolean; mateFixed: boolean; colorUnknown: boolean };
}

export function planBackfill(g: LegacyGame, botUserIds: ReadonlySet<bigint>): BackfillPlan {
  const gd = (g.gameData && typeof g.gameData === "object" ? g.gameData : {}) as GameDataLike;
  const opponentIsBot = g.opponentId != null && botUserIds.has(g.opponentId);
  const mode = modeOf(gd, g.tournamentId, opponentIsBot);
  const creatorColor = creatorColorOf(mode, gd);
  const botElo = mode === "BOT" ? (DIFFICULTY_ELO[String(gd.difficulty)] ?? 1400) : null;
  const opponentMember = mode === "BOT" ? null : g.opponentId;
  let whitePlayerId: bigint | null = null;
  let blackPlayerId: bigint | null = null;
  if (creatorColor === "w") {
    whitePlayerId = g.creatorId;
    blackPlayerId = opponentMember;
  } else if (creatorColor === "b") {
    blackPlayerId = g.creatorId;
    whitePlayerId = opponentMember;
  }
  const replay = replayHistory(g.startingFen, gd);
  const finished = g.status === "COMPLETED";
  const endMethod = finished ? endMethodOf(gd.method, replay) : null;
  const outcome = finished ? outcomeOf(g.result, creatorColor) : null;
  const engine = botElo != null ? `Engine ${botElo}` : null;
  const clip = (s: string | null) => (s ? s.slice(0, 40) : null);
  const nameOf = (id: bigint | null, side: Color) =>
    id === g.creatorId ? clip(g.creatorName) : id != null ? clip(g.opponentName) : creatorColor && side !== creatorColor ? engine : null;
  const whiteName = nameOf(whitePlayerId, "w");
  const blackName = nameOf(blackPlayerId, "b");
  const creatorIsWhite = creatorColor !== "b";

  const players: PlayerPlan[] = [];
  if (finished && creatorColor) {
    for (const [userId, color] of [
      [whitePlayerId, "w"],
      [blackPlayerId, "b"],
    ] as const) {
      if (userId == null) continue;
      const oppId = color === "w" ? blackPlayerId : whitePlayerId;
      const result =
        outcome === "DRAW" ? "DRAW" : outcome == null ? null : (outcome === "WHITE") === (color === "w") ? "WIN" : "LOSS";
      players.push({
        userId,
        color,
        result,
        opponentUserId: oppId,
        opponentName: (color === "w" ? blackName : whiteName) ?? "",
        opponentRating: mode === "BOT" ? botElo : null,
      });
    }
  }

  const meta: Record<string, unknown> = { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null };
  if (!creatorColor) meta.colorUnknown = true;
  if (replay.truncated) meta.backfillTruncated = true;
  if (replay.mateFixed) meta.backfillMateFixed = true;

  return {
    id: g.id,
    mode,
    timeClass: timeClassOf(g.initialTimeSeconds, g.incrementSeconds),
    whitePlayerId,
    blackPlayerId,
    botElo,
    startPly: startPlyOf(g.startingFen),
    moves: replay.uci.join(" "),
    plyCount: replay.uci.length,
    fen: replay.fen,
    whiteTimeMs: (creatorIsWhite ? g.creatorTimeRemaining : g.opponentTimeRemaining) * 1000,
    blackTimeMs: (creatorIsWhite ? g.opponentTimeRemaining : g.creatorTimeRemaining) * 1000,
    phase: finished || g.status === "CANCELLED" || g.status === "EXPIRED" ? "ENDED" : g.status === "IN_PROGRESS" ? "PLAYING" : "WAITING",
    endMethod,
    outcome,
    whiteName,
    blackName,
    whiteRating: whitePlayerId == null && mode === "BOT" ? botElo : null,
    blackRating: blackPlayerId == null && mode === "BOT" ? botElo : null,
    meta,
    players,
    flags: { truncated: replay.truncated, mateFixed: replay.mateFixed, colorUnknown: !creatorColor },
  };
}

// ─── I/O ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Db = import("@repo/db").PrismaClient;

function resolveTargetUrl(): { url: string; origin: string } {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnv(readFileSync(path.join(webDir, DEV_ENV_FILE)));
  } catch {
    // CI has no env file; the shell must provide the URL.
  }
  const r = resolveEnvVar(
    "DIRECT_URL",
    process.env.DIRECT_URL || process.env.DATABASE_URL,
    fileValues.DIRECT_URL || fileValues.DATABASE_URL,
  );
  return { url: r.value, origin: r.origin };
}

const BATCH = 500;

async function loadBatch(db: Db, Prisma: typeof import("@repo/db").Prisma, cursor: bigint): Promise<LegacyGame[]> {
  return db.$queryRaw<LegacyGame[]>(Prisma.sql`
    SELECT g.id, g.status::text AS status, g.result::text AS result, g."creatorId", g."opponentId", g."tournamentId",
           g."startingFen", g."initialTimeSeconds", g."incrementSeconds", g."creatorTimeRemaining",
           g."opponentTimeRemaining", g."gameData", g."completedAt", g."updatedAt",
           cu.name AS "creatorName", ou.name AS "opponentName"
      FROM games g JOIN users cu ON cu.id = g."creatorId" LEFT JOIN users ou ON ou.id = g."opponentId"
     WHERE g.mode IS NULL AND g.id > ${cursor}
     ORDER BY g.id LIMIT ${BATCH}`);
}

async function applyPlan(tx: Db, Prisma: typeof import("@repo/db").Prisma, p: BackfillPlan, g: LegacyGame) {
  const n = await tx.$executeRaw(Prisma.sql`
    UPDATE games SET mode = ${p.mode}::"GameMode", "timeClass" = ${p.timeClass}::"TimeClass",
           "whitePlayerId" = ${p.whitePlayerId}::bigint, "blackPlayerId" = ${p.blackPlayerId}::bigint,
           "botElo" = ${p.botElo}::smallint, "startPly" = ${p.startPly}, "studySeconds" = 0,
           moves = ${p.moves}, "plyCount" = ${p.plyCount}, fen = ${p.fen},
           "whiteTimeMs" = ${p.whiteTimeMs}::int, "blackTimeMs" = ${p.blackTimeMs}::int,
           phase = ${p.phase}::"LivePhase", "endMethod" = ${p.endMethod}::"GameEndMethod", outcome = ${p.outcome}::"GameWinner",
           "whiteName" = COALESCE("whiteName", ${p.whiteName}::varchar(40)),
           "blackName" = COALESCE("blackName", ${p.blackName}::varchar(40)),
           "whiteRating" = COALESCE("whiteRating", ${p.whiteRating}::smallint),
           "blackRating" = COALESCE("blackRating", ${p.blackRating}::smallint),
           meta = ${JSON.stringify(p.meta)}::jsonb || COALESCE(meta, '{}'::jsonb)
     WHERE id = ${p.id} AND mode IS NULL`);
  if (n !== 1) return 0;
  let inserted = 0;
  for (const pl of p.players) {
    inserted += await tx.$executeRaw(Prisma.sql`
      INSERT INTO game_players ("gameId", "userId", color, mode, "timeClass", rated, result, "endedAt",
                                "opponentUserId", "opponentName", "opponentRating", "tournamentId", source,
                                "createdAt", "updatedAt")
      VALUES (${p.id}, ${pl.userId}, ${pl.color}, ${p.mode}::"GameMode", ${p.timeClass}::"TimeClass", false,
              ${pl.result}::"PlayerResult", ${g.completedAt ?? g.updatedAt}::timestamp(3), ${pl.opponentUserId}::bigint,
              ${pl.opponentName.slice(0, 40)}, ${pl.opponentRating}::smallint, ${g.tournamentId}::bigint, 'REPLAY', now(), now())
      ON CONFLICT DO NOTHING`);
  }
  return inserted;
}

export interface VerifyReport {
  replayFailures: number;
  plyCountMismatches: number;
  checkmateNotMate: number;
  playersExpected: number;
  playersActual: number;
  remainingNullMode: number;
}

export async function verifyBackfill(db: Db, Prisma: typeof import("@repo/db").Prisma): Promise<VerifyReport> {
  const rows = await db.$queryRaw<
    { id: bigint; startingFen: string; moves: string; plyCount: number; endMethod: string | null }[]
  >(Prisma.sql`SELECT id, "startingFen", moves, "plyCount", "endMethod"::text AS "endMethod" FROM games WHERE mode IS NOT NULL`);
  const report: VerifyReport = {
    replayFailures: 0,
    plyCountMismatches: 0,
    checkmateNotMate: 0,
    playersExpected: 0,
    playersActual: 0,
    remainingNullMode: 0,
  };
  for (const r of rows) {
    const tokens = r.moves.trim() === "" ? [] : r.moves.trim().split(/\s+/);
    if (tokens.length !== r.plyCount) report.plyCountMismatches++;
    const chess = new Chess(r.startingFen);
    try {
      for (const t of tokens) chess.move({ from: t.slice(0, 2), to: t.slice(2, 4), ...(t[4] ? { promotion: t[4] } : {}) });
      if (r.endMethod === "CHECKMATE" && !chess.isCheckmate()) report.checkmateNotMate++;
    } catch {
      report.replayFailures++;
    }
  }
  const [counts] = await db.$queryRaw<{ expected: number; actual: number; nulls: number }[]>(Prisma.sql`
    SELECT (SELECT (count("whitePlayerId") + count("blackPlayerId"))::int FROM games
             WHERE status = 'COMPLETED' AND mode IS NOT NULL AND NOT (COALESCE(meta, '{}'::jsonb) ? 'colorUnknown')) AS expected,
           (SELECT count(*)::int FROM game_players p JOIN games g ON g.id = p."gameId" WHERE g.status = 'COMPLETED') AS actual,
           (SELECT count(*)::int FROM games WHERE mode IS NULL) AS nulls`);
  report.playersExpected = counts?.expected ?? -1;
  report.playersActual = counts?.actual ?? -1;
  report.remainingNullMode = counts?.nulls ?? -1;
  return report;
}

export async function runBackfill(opts: { apply: boolean; verifyOnly?: boolean; databaseUrl?: string; log?: (s: string) => void }) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const { url, origin } = opts.databaseUrl ? { url: opts.databaseUrl, origin: "argument" } : resolveTargetUrl();
  const host = assertBackfillTarget(url);
  log(`[backfill] target host ${host} (from ${origin}); mode ${opts.verifyOnly ? "verify" : opts.apply ? "APPLY" : "dry run"}`);
  const { PrismaClient, Prisma } = await import("@repo/db");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const [users] = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS count FROM users`);
    assertUserTripwire(users?.count ?? -1);
    if (!opts.verifyOnly) {
      const bots = await db.$queryRaw<{ id: bigint }[]>(
        Prisma.sql`SELECT id FROM users WHERE code LIKE 'CHESS_BOT%' OR email LIKE 'bot@%'`,
      );
      const botIds = new Set(bots.map((b) => b.id));
      const totals = { rows: 0, players: 0, truncated: 0, mateFixed: 0, colorUnknown: 0, byMode: {} as Record<string, number> };
      let cursor = 0n;
      for (;;) {
        const batch = await loadBatch(db, Prisma, cursor);
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1]!.id;
        const plans = batch.map((g) => ({ g, p: planBackfill(g, botIds) }));
        for (const { p } of plans) {
          totals.rows++;
          totals.byMode[p.mode] = (totals.byMode[p.mode] ?? 0) + 1;
          if (p.flags.truncated) totals.truncated++;
          if (p.flags.mateFixed) totals.mateFixed++;
          if (p.flags.colorUnknown) totals.colorUnknown++;
          totals.players += p.players.length;
        }
        if (opts.apply) {
          // One short transaction per game (its UPDATE and its game_players rows commit together). A transaction per
          // batch of 500 needs ~3 round trips per row and outlives Prisma's 5 s interactive-transaction timeout on a
          // remote Neon host (P2028, seen on the dev branch); it would also hold row locks on games for minutes.
          for (const { g, p } of plans) {
            await db.$transaction(async (tx) => {
              await applyPlan(tx as unknown as Db, Prisma, p, g);
            });
          }
        } else if (totals.rows === batch.length) {
          const s = plans[0]?.p;
          if (s) log(`[backfill] sample: id ${s.id} → ${s.mode} ${s.timeClass} plies ${s.plyCount} end ${s.endMethod} ${s.outcome}`);
        }
      }
      log(`[backfill] ${opts.apply ? "applied" : "would apply"}: ${JSON.stringify(totals)}`);
    }
    if (opts.apply || opts.verifyOnly) {
      const v = await verifyBackfill(db, Prisma);
      log(`[backfill] verification: ${JSON.stringify(v)}`);
      // Right after an apply every legacy row must have a mode; a plain --verify tolerates rows that legacy writers
      // created since (until they write the M2 columns themselves).
      const failures =
        v.replayFailures +
        v.plyCountMismatches +
        v.checkmateNotMate +
        (v.playersExpected === v.playersActual ? 0 : 1) +
        (opts.apply && v.remainingNullMode !== 0 ? 1 : 0);
      log(failures === 0 ? "[backfill] verification OK: 0 failures" : `[backfill] verification FAILED (${failures})`);
      return { verification: v, failures };
    }
    return { verification: null, failures: 0 };
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  for (const a of argv) {
    if (!["--apply", "--dry-run", "--verify"].includes(a)) throw new SeedGuardError(`unknown argument ${a}`);
  }
  const r = await runBackfill({ apply: argv.includes("--apply"), verifyOnly: argv.includes("--verify") });
  if (r.failures > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof SeedGuardError ? `[backfill] ${err.message}` : err);
    process.exit(1);
  });
}
