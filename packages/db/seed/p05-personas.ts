// Phase 5 persona writer (phase-05 plan 6.7; testing X4): puts one P5 state (./p05-persona-states.ts) on a pool user
// or S, exactly. Called by apps/web/scripts/dev/personas.ts (every reset: `clearP05State`, then `writeP05Persona` for a
// P5 persona) and by apps/web/e2e/scripts/seed-training.ts (the dev seed). Shared e2e letters A–R are refused, the
// user-count tripwire applies, and the persona tool has already checked the target host (dev endpoint or local).
//
// A reset:
//   1. writes the state's analysed games with P3's seed builders (the design GAME and the first N CC0 oracle archive
//      games, deterministic refs per member) and clears their walkthrough progress;
//   2. in one transaction: removes every P5 row of the user (bank, cards, attempts, sessions, days, mastery, profile,
//      their reports), sets the user's time zone, marks the written games extracted (`bankVersion` = EXTRACT_VERSION,
//      so the backfill never adds to an exact state), then writes the mistakes (the games' key moments, deduped per
//      position), their occurrences, the cards with their schedules, the profile, the trained days and their
//      attempts, theme mastery and, for `dev-perfect`, one completed session.
// Every business timestamp comes from `now` and every id that leaves the database (refs, card keys, attempt ids) is
// derived from the member and the position, so the same persona applied twice yields the same rows (only the serial
// ids differ). The domain rules come in as `TrainingDeps` (no second copy of epdHash, the key codec or the clock).
import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import type { PrismaClient } from "#generated";
import { Prisma } from "#generated";
import { decodeEval, decodeMove, judgementEnum, type Color } from "@repo/chess-analysis/codec";
import { EXTRACT_VERSION } from "@repo/contracts/internal/jobs";
import { buildSessionItems } from "../src/json/training";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { seededRef, type SeedFixture } from "./builders";
import {
  daysBefore,
  getP05PersonaState,
  P05_PERSONA_THEMES,
  scheduleCards,
  type CardSchedule,
  type P05PersonaState,
  type TrainingDeps,
} from "./p05-persona-states";
import { archiveFixture, gameFixture, loadContext, planFixtures } from "./review";
import { checkTripwire, SeedGuardError } from "./target";
import { memberByEmail, resetReviewProgress, SHARED_LETTER_EMAIL, writeFixtures } from "./writer";

type Tx = Prisma.TransactionClient;
const TX_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;
const RELEASE_HOUR = 8;
const DAY_START_HOUR = 4;

export interface P05WriteOptions {
  now?: Date;
  deps: TrainingDeps;
  log?: (line: string) => void;
}

export interface P05ClearReport {
  mistakes: number;
  cards: number;
  attempts: number;
  sessions: number;
  days: number;
  themes: number;
  profiles: number;
  reports: number;
}

export interface P05PersonaReport {
  persona: string;
  cleared: P05ClearReport;
  games: number;
  mistakes: number;
  cards: number;
  dueNow: number;
  attempts: number;
  /** key → game ref (GAME, archive-01 …), for specs that open a review. */
  gameRefs: Record<string, string>;
  /** The first card's key (the two-tabs spec grades it). */
  firstCardKey: string | null;
}

/** One bank position derived from a key moment, before the database ids exist. */
export interface PersonaMistake {
  referenceId: string;
  epdHash: bigint;
  color: Color;
  fen: string;
  setupUci: string | null;
  solution: string;
  accept: string | null;
  playedUci: string;
  refuteUci: string | null;
  judgement: "INACCURACY" | "MISTAKE" | "MISS" | "BLUNDER";
  source: "OWN_ERROR" | "MISSED_PUNISH";
  isPuzzle: boolean;
  primaryTheme: string;
  phase: "OPENING" | "MIDDLEGAME" | "ENDGAME";
  winBefore: number;
  winAfterPlayed: number;
  cpBest: number | null;
  mateBest: number | null;
  timeClass: string | null;
  ecoCode: string | null;
  moveNumber: number;
  /** Every (game, ply) where it happened; the newest is `last`. */
  occurrences: { gameRef: string; ply: number; playedAt: Date; opponent: string }[];
}

function refuseShared(email: string): void {
  if (SHARED_LETTER_EMAIL.test(email)) {
    throw new SeedGuardError(`refusing: ${email} is a shared e2e user; personas run on pool users or S`);
  }
}

/** A UUID (v4 layout) derived from a key: the persona's attempt ids are the same on every reset. */
export function seededUuid(key: string): string {
  const h = createHash("sha256").update(`p5-persona:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function playUci(chess: Chess, uci: string): boolean {
  try {
    return !!chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
}

const ERROR_JUDGEMENTS = new Set(["INACCURACY", "MISTAKE", "MISS", "BLUNDER"]);

/**
 * The member side's key moments of one analysed fixture as bank positions (plan 8.1 step 6, Lichess shape): `fen` is
 * the position before the opponent's previous move (`setupUci`), the solution starts with the engine's best move (the
 * first three plies of the moment's line when it has them, else the best move alone, a review position), the hash is
 * of the position before the member's move. Moments whose stored move does not match the game are skipped.
 */
export function momentMistakes(fixture: SeedFixture, memberId: bigint, deps: Pick<TrainingDeps, "epdHash">, memberRef: string, themeOffset: number): PersonaMistake[] {
  const player = fixture.players.find((p) => p.userId === memberId);
  const review = player && fixture.reviews.find((r) => r.color === player.color);
  if (!player || !review || !fixture.analysis) return [];
  const moves = fixture.game.moves.split(" ").filter(Boolean);
  const a = fixture.analysis;
  const out: PersonaMistake[] = [];
  for (const m of review.content.moments) {
    const i = m.ply;
    const judgement = judgementEnum(m.judgement);
    if (!judgement || !ERROR_JUDGEMENTS.has(judgement) || moves[i] !== m.playedUci) continue;
    const chess = new Chess(fixture.game.startingFen);
    for (let k = 0; k < i - 1; k++) if (!playUci(chess, moves[k]!)) return out;
    const setupFen = chess.fen();
    if (i >= 1 && !playUci(chess, moves[i - 1]!)) return out;
    const before = chess.fen();
    if (chess.turn() !== player.color) continue;
    const pv = m.pv.split(" ").filter(Boolean);
    const line = pv[0] === m.bestUci && pv.length >= 3 ? pv.slice(0, 3) : [m.bestUci];
    const check = new Chess(before);
    const legal = line.every((u) => playUci(check, u));
    const solution = legal ? line : [m.bestUci];
    const isPuzzle = legal && solution.length >= 3;
    const accept = m.accept.filter((u) => u !== m.bestUci);
    const ev = a.evals[i];
    let cpBest: number | null = null;
    let mateBest: number | null = null;
    if (typeof ev === "number") {
      const d = decodeEval(ev);
      if (d.kind === "cp") cpBest = Math.max(-1000, Math.min(1000, player.color === "w" ? d.cp : -d.cp));
      else mateBest = d.winner === player.color ? d.moves : -d.moves;
    }
    const refuteCode = a.best[i + 1];
    const refuteUci = typeof refuteCode === "number" && refuteCode > 0 ? decodeMove(refuteCode) : null;
    const plyAbs = fixture.game.startPly + i;
    const phase = a.endgamePly !== null && i >= a.endgamePly ? "ENDGAME" : a.middlegamePly !== null && i >= a.middlegamePly ? "MIDDLEGAME" : "OPENING";
    const epdHash = deps.epdHash(before);
    out.push({
      referenceId: seededRef(`p5-mistake:${epdHash}`, memberRef),
      epdHash,
      color: player.color,
      fen: i >= 1 ? setupFen : before,
      setupUci: i >= 1 ? moves[i - 1]! : null,
      solution: solution.join(" "),
      accept: accept.length ? accept.join(" ") : null,
      playedUci: m.playedUci,
      refuteUci,
      judgement: judgement as PersonaMistake["judgement"],
      source: judgement === "MISS" ? "MISSED_PUNISH" : "OWN_ERROR",
      isPuzzle,
      primaryTheme: P05_PERSONA_THEMES[(themeOffset + out.length) % P05_PERSONA_THEMES.length]!,
      phase,
      winBefore: m.winBefore,
      winAfterPlayed: m.winAfter,
      cpBest,
      mateBest,
      timeClass: fixture.game.timeClass,
      ecoCode: fixture.game.ecoCode,
      moveNumber: Math.floor(plyAbs / 2) + 1,
      occurrences: [{ gameRef: fixture.game.ref, ply: i, playedAt: fixture.game.completedAt, opponent: player.opponentName.slice(0, 40) }],
    });
  }
  return out;
}

/** The first `limit` distinct positions over the fixtures, in order; a repeated position adds an occurrence. */
export function personaMistakes(fixtures: readonly SeedFixture[], memberId: bigint, memberRef: string, deps: Pick<TrainingDeps, "epdHash">, limit: number): PersonaMistake[] {
  const byHash = new Map<bigint, PersonaMistake>();
  for (const f of fixtures) {
    for (const m of momentMistakes(f, memberId, deps, memberRef, byHash.size)) {
      const seen = byHash.get(m.epdHash);
      if (seen) {
        if (!seen.occurrences.some((o) => o.gameRef === m.occurrences[0]!.gameRef && o.ply === m.occurrences[0]!.ply)) seen.occurrences.push(m.occurrences[0]!);
        continue;
      }
      if (byHash.size >= limit) continue;
      byHash.set(m.epdHash, m);
    }
  }
  return [...byHash.values()];
}

// ── Clear ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function lockUser(tx: Tx, email: string): Promise<{ id: bigint; ref: string }> {
  const rows = await tx.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`
    SELECT id, "referenceId" AS ref FROM users WHERE email = ${email} FOR UPDATE`);
  const row = rows[0];
  if (!row) throw new SeedGuardError(`no users row for ${email}; provision it first`);
  return row;
}

async function clearInTx(tx: Tx, userId: bigint): Promise<P05ClearReport> {
  const attempts = await tx.$executeRaw(Prisma.sql`DELETE FROM training_attempts WHERE "userId" = ${userId}`);
  const sessions = await tx.$executeRaw(Prisma.sql`DELETE FROM training_sessions WHERE "userId" = ${userId}`);
  const cards = await tx.$executeRaw(Prisma.sql`DELETE FROM training_cards WHERE "userId" = ${userId}`);
  const mistakes = await tx.$executeRaw(Prisma.sql`DELETE FROM mistakes WHERE "userId" = ${userId}`);
  const days = await tx.$executeRaw(Prisma.sql`DELETE FROM training_days WHERE "userId" = ${userId}`);
  const themes = await tx.$executeRaw(Prisma.sql`DELETE FROM theme_mastery WHERE "userId" = ${userId}`);
  const profiles = await tx.$executeRaw(Prisma.sql`DELETE FROM training_profiles WHERE "userId" = ${userId}`);
  const reports = await tx.$executeRaw(Prisma.sql`DELETE FROM reports WHERE "reporterId" = ${userId}`);
  return { mistakes, cards, attempts, sessions, days, themes, profiles, reports };
}

/** Removes every P5 row of the user (every persona reset runs this first). Games and billing are not touched. */
export async function clearP05State(db: PrismaClient, email: string, opts: { log?: (line: string) => void } = {}): Promise<P05ClearReport> {
  refuseShared(email);
  await checkTripwire(db, MAX_TARGET_USERS);
  const cleared = await db.$transaction(async (tx) => clearInTx(tx, (await lockUser(tx, email)).id), { timeout: TX_TIMEOUT_MS });
  opts.log?.(`[personas] p5 cleared: ${cleared.mistakes} mistake(s), ${cleared.cards} card(s), ${cleared.attempts} attempt(s)`);
  return cleared;
}

// ── Write ──────────────────────────────────────────────────────────────────────────────────────────────────────
function cardKind(m: PersonaMistake): "MISTAKE" | "REVIEW_POSITION" {
  return m.isPuzzle ? "MISTAKE" : "REVIEW_POSITION";
}

/** The persona's mistakes, cards and schedules (pure, for the writer and the tests). */
export function personaBank(state: P05PersonaState, fixtures: readonly SeedFixture[], member: { id: bigint; ref: string }, now: Date, deps: TrainingDeps) {
  const mistakes = state.mistakes > 0 ? personaMistakes(fixtures, member.id, member.ref, deps, state.mistakes) : [];
  if (mistakes.length < state.mistakes) {
    throw new Error(`${state.name}: the games hold ${mistakes.length} distinct positions, the state needs ${state.mistakes}`);
  }
  const schedules: CardSchedule[] = state.cards > 0 ? scheduleCards(state, now, deps, RELEASE_HOUR) : [];
  const cards = schedules.map((s, i) => {
    const m = mistakes[i]!;
    return { mistake: m, itemKey: deps.mistakeItemKey(m.epdHash), schedule: s, mastery: deps.masteryOf(s.state, s.stability) };
  });
  return { mistakes, cards };
}

async function insertMistakes(tx: Tx, userId: bigint, mistakes: readonly PersonaMistake[], gameIds: Map<string, bigint>, now: Date) {
  const rows = mistakes.map((m) => {
    const last = m.occurrences.reduce((a, b) => (b.playedAt > a.playedAt ? b : a));
    return {
      referenceId: m.referenceId,
      epdHash: m.epdHash.toString(),
      color: m.color,
      fen: m.fen,
      setupUci: m.setupUci,
      solution: m.solution,
      accept: m.accept,
      playedUci: m.playedUci,
      refuteUci: m.refuteUci,
      judgement: m.judgement,
      source: m.source,
      isPuzzle: m.isPuzzle,
      themes: [m.primaryTheme],
      primaryTheme: m.primaryTheme,
      phase: m.phase,
      winBefore: m.winBefore,
      winAfterPlayed: m.winAfterPlayed,
      cpBest: m.cpBest,
      mateBest: m.mateBest,
      timeClass: m.timeClass,
      ecoCode: m.ecoCode,
      moveNumber: m.moveNumber,
      occurrences: m.occurrences.length,
      lastGameId: gameIds.get(last.gameRef)?.toString() ?? null,
      lastPly: last.ply,
      lastPlayedAt: last.playedAt.toISOString().replace("Z", ""),
      lastOpponentName: last.opponent,
    };
  });
  if (rows.length === 0) return;
  const ts = now.toISOString().replace("Z", "");
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, "setupUci", solution, accept, "playedUci", "refuteUci",
                          judgement, source, "isPuzzle", themes, "primaryTheme", phase, "winBefore", "winAfterPlayed", "cpBest",
                          "mateBest", "timeClass", "ecoCode", "moveNumber", occurrences, "lastGameId", "lastPly", "lastPlayedAt",
                          "lastOpponentName", "createdAt", "updatedAt")
    SELECT x."referenceId", ${userId}, x."epdHash", x.color, x.fen, x."setupUci", x.solution, x.accept, x."playedUci", x."refuteUci",
           x.judgement::"Judgement", x.source::"MistakeSource", x."isPuzzle", ARRAY(SELECT jsonb_array_elements_text(x.themes)),
           x."primaryTheme", x.phase::"GamePhase", x."winBefore", x."winAfterPlayed", x."cpBest", x."mateBest",
           x."timeClass"::"TimeClass", x."ecoCode", x."moveNumber", x.occurrences, x."lastGameId", x."lastPly", x."lastPlayedAt",
           x."lastOpponentName", ${ts}::timestamp, ${ts}::timestamp
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
        "referenceId" text, "epdHash" bigint, color char(1), fen text, "setupUci" text, solution text, accept text, "playedUci" text,
        "refuteUci" text, judgement text, source text, "isPuzzle" boolean, themes jsonb, "primaryTheme" text, phase text,
        "winBefore" real, "winAfterPlayed" real, "cpBest" int, "mateBest" smallint, "timeClass" text, "ecoCode" text,
        "moveNumber" smallint, occurrences smallint, "lastGameId" bigint, "lastPly" smallint, "lastPlayedAt" timestamp,
        "lastOpponentName" text)`);
  const occ = mistakes.flatMap((m) =>
    m.occurrences.flatMap((o) => {
      const gameId = gameIds.get(o.gameRef);
      return gameId === undefined ? [] : [{ gameId: gameId.toString(), ply: o.ply, epdHash: m.epdHash.toString() }];
    }),
  );
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId")
    SELECT x."gameId", x.ply, m.id FROM jsonb_to_recordset(${JSON.stringify(occ)}::jsonb) AS x("gameId" bigint, ply smallint, "epdHash" bigint)
      JOIN mistakes m ON m."userId" = ${userId} AND m."epdHash" = x."epdHash"
    ON CONFLICT ("gameId", ply) DO NOTHING`);
}

async function insertCards(tx: Tx, userId: bigint, cards: ReturnType<typeof personaBank>["cards"], now: Date) {
  if (cards.length === 0) return;
  const iso = (d: Date | null) => (d ? d.toISOString().replace("Z", "") : null);
  const rows = cards.map((c) => ({
    epdHash: c.mistake.epdHash.toString(),
    kind: cardKind(c.mistake),
    itemKey: c.itemKey,
    theme: c.mistake.primaryTheme,
    phase: c.mistake.phase,
    due: iso(c.schedule.due),
    stability: c.schedule.stability,
    difficulty: c.schedule.difficulty,
    scheduledDays: c.schedule.scheduledDays,
    reps: c.schedule.reps,
    lapses: c.schedule.lapses,
    state: c.schedule.state,
    lastReview: iso(c.schedule.lastReview),
    mastery: c.mastery,
  }));
  const ts = iso(now);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, stability, difficulty, "scheduledDays",
                                reps, lapses, state, "lastReview", mastery, "createdAt", "updatedAt")
    SELECT ${userId}, 'BANK', x.kind::"TrainingItemKind", x."itemKey", m.id, x.theme, x.phase::"GamePhase", x.due, x.stability,
           x.difficulty, x."scheduledDays", x.reps, x.lapses, x.state::"CardState", x."lastReview", x.mastery, ${ts}::timestamp, ${ts}::timestamp
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x("epdHash" bigint, kind text, "itemKey" text, theme text, phase text,
             due timestamp, stability real, difficulty real, "scheduledDays" smallint, reps smallint, lapses smallint, state text,
             "lastReview" timestamp, mastery smallint)
      JOIN mistakes m ON m."userId" = ${userId} AND m."epdHash" = x."epdHash"`);
}

/** Puts `personaName` on the user (pool user or S), exactly. */
export async function writeP05Persona(db: PrismaClient, email: string, personaName: string, opts: P05WriteOptions): Promise<P05PersonaReport> {
  refuseShared(email);
  const state = getP05PersonaState(personaName);
  const now = opts.now ?? new Date();
  const deps = opts.deps;
  await checkTripwire(db, MAX_TARGET_USERS);

  // 1. The games (P3's builders; deterministic refs per member).
  let fixtures: SeedFixture[] = [];
  let member: { id: bigint; ref: string };
  if (state.games.game || state.games.archives > 0) {
    const ctx = await loadContext(db, email, true, opts.log);
    member = ctx.member;
    if (state.games.game) fixtures.push(gameFixture(ctx));
    for (let n = 1; n <= state.games.archives; n++) fixtures.push(archiveFixture(ctx, n));
    const plan = await planFixtures(db, fixtures);
    const changed = fixtures.filter((_, k) => plan[k]!.action !== "unchanged");
    if (changed.length > 0) await writeFixtures(db, changed);
    await resetReviewProgress(db, fixtures.map((f) => f.game.ref));
  } else {
    const m = await memberByEmail(db, email, null);
    if (!m) throw new SeedGuardError(`no users row for ${email}; provision it first`);
    member = m;
    fixtures = [];
  }

  const bank = personaBank(state, fixtures, member, now, deps);
  const today = deps.dayKey(now, state.timeZone, DAY_START_HOUR);
  const ts = now.toISOString().replace("Z", "");

  const report = await db.$transaction(
    async (tx) => {
      const user = await lockUser(tx, email);
      const cleared = await clearInTx(tx, user.id);
      await tx.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = ${state.timeZone}, "updatedAt" = now() WHERE id = ${user.id}`);
      const refs = fixtures.map((f) => f.game.ref);
      const games = refs.length
        ? await tx.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`
            SELECT id, "referenceId" AS ref FROM games WHERE "referenceId" = ANY(${refs}::text[])`)
        : [];
      const gameIds = new Map(games.map((g) => [g.ref, g.id]));
      if (games.length) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE game_players SET "bankVersion" = ${EXTRACT_VERSION}
           WHERE "userId" = ${user.id} AND "gameId" = ANY(${games.map((g) => g.id)}::bigint[])`);
      }
      await insertMistakes(tx, user.id, bank.mistakes, gameIds, now);
      await insertCards(tx, user.id, bank.cards, now);

      // Theme mastery: the state's rows, plus bankCount per primary theme of the cards.
      const bankCount = new Map<string, number>();
      for (const c of bank.cards) bankCount.set(c.mistake.primaryTheme, (bankCount.get(c.mistake.primaryTheme) ?? 0) + 1);
      const themes = new Map<string, { attempts: number; firstTry: number; ewma: number; milestonePct: number; bankCount: number }>();
      for (const t of state.mastery) themes.set(t.theme, { attempts: t.attempts, firstTry: t.firstTry, ewma: t.ewma, milestonePct: t.milestonePct, bankCount: 0 });
      for (const [theme, n] of bankCount) themes.set(theme, { ...(themes.get(theme) ?? { attempts: 0, firstTry: 0, ewma: 0, milestonePct: 0 }), bankCount: n });
      if (state.perfectSession) {
        const fork = themes.get("fork");
        if (fork) themes.set("fork", { ...fork, attempts: fork.attempts + 5, firstTry: fork.firstTry + 5, ewma: 0.71, milestonePct: 70 });
      }
      for (const [theme, t] of themes) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO theme_mastery ("userId", theme, attempts, "firstTry", ewma, "bankCount", "milestonePct", "lastAttemptAt")
          VALUES (${user.id}, ${theme}, ${t.attempts}, ${t.firstTry}, ${t.ewma}, ${t.bankCount}, ${t.milestonePct},
                  ${t.attempts > 0 ? new Date(now.getTime() - DAY_MS) : null})`);
      }

      if (state.profile) {
        const p = state.profile;
        const lastActive = p.lastActiveDaysAgo === null ? null : daysBefore(today, p.lastActiveDaysAgo);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO training_profiles ("userId", "puzzleRating", "puzzleRd", "puzzleVol", "puzzleAttempts", "ratingSeeded", "solveStreak",
                                         "solveStreakBest", "dayStreak", "dayStreakBest", "lastActiveDay", "dayStartHour", "releaseHour",
                                         "bankDailyCap", "newPerDay", "autoGrade", "updatedAt")
          VALUES (${user.id}, ${p.rating}, ${p.rd}, 0.06, ${p.puzzleAttempts}, ${p.ratingSeeded}, ${p.solveStreak}, ${p.solveStreakBest},
                  ${p.dayStreak}, ${p.dayStreakBest}, ${lastActive}::date, ${DAY_START_HOUR}, ${RELEASE_HOUR}, 10, 5, false, ${ts}::timestamp)`);
      }

      // Trained days: one graded BANK attempt each (on the first cards), oldest first; today's cap counters.
      let attempts = 0;
      for (const n of state.trainedDaysAgo) {
        const day = daysBefore(today, n);
        const reviewedAt = new Date(now.getTime() - n * DAY_MS - 2 * 3_600_000);
        const c = bank.cards.length ? bank.cards[attempts % bank.cards.length]! : null;
        const isToday = n === 0 && state.today !== null;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO training_days ("userId", day, "bankReviewed", "newIntroduced", "puzzlesDone", "activeMs", "updatedAt")
          VALUES (${user.id}, ${day}::date, ${isToday ? state.today!.bankReviewed : 1}, ${isToday ? state.today!.newIntroduced : 0}, 0,
                  ${isToday ? 600_000 : 90_000}, ${ts}::timestamp)`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO training_attempts ("clientAttemptId", "userId", "cardId", deck, kind, theme, solved, "firstTry", "timeMs", grade,
                                         "suggestedGrade", state, stability, difficulty, "scheduledDays", "reviewedAt", "createdAt")
          SELECT ${seededUuid(`${user.ref}:${state.name}:day:${n}`)}::uuid, ${user.id},
                 (SELECT id FROM training_cards WHERE "userId" = ${user.id} AND "itemKey" = ${c?.itemKey ?? ""}),
                 'BANK', ${c ? cardKind(c.mistake) : "MISTAKE"}::"TrainingItemKind", ${c?.mistake.primaryTheme ?? "fork"}, true, true,
                 24000, 'GOOD', 'GOOD', 'REVIEW', 4, 5, 4, ${reviewedAt.toISOString().replace("Z", "")}::timestamp, ${ts}::timestamp`);
        attempts++;
      }
      if (state.today && !state.trainedDaysAgo.includes(0)) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO training_days ("userId", day, "bankReviewed", "newIntroduced", "updatedAt")
          VALUES (${user.id}, ${today}::date, ${state.today.bankReviewed}, ${state.today.newIntroduced}, ${ts}::timestamp)`);
      }

      // dev-perfect: one COMPLETED five-item session, all first try.
      if (state.perfectSession) {
        const five = bank.cards.slice(0, 5);
        const items = buildSessionItems({ v: 1, items: five.map((c, i) => ({ id: `i${i + 1}`, key: c.itemKey, kind: cardKind(c.mistake), pass: 1 })) });
        const startedAt = new Date(now.getTime() - 3_600_000);
        const ended = new Date(now.getTime() - 3_000_000);
        const sessionRef = seededRef(`p5-session:${state.name}`, user.ref);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO training_sessions ("referenceId", "userId", kind, status, source, "filterKey", size, items, day, total, solved, "firstTry",
                                         "withHint", "startedAt", "endedAt")
          VALUES (${sessionRef}, ${user.id}, 'BANK', 'COMPLETED', 'hub', ${`p5-persona:${state.name}`}, 5, ${JSON.stringify(items)}::jsonb,
                  ${today}::date, 5, 5, 5, 0, ${startedAt.toISOString().replace("Z", "")}::timestamp, ${ended.toISOString().replace("Z", "")}::timestamp)`);
        for (const [i, c] of five.entries()) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO training_attempts ("clientAttemptId", "userId", "cardId", "sessionId", "itemId", deck, kind, theme, solved, "firstTry",
                                           "timeMs", grade, "suggestedGrade", state, stability, difficulty, "scheduledDays", "reviewedAt", "createdAt")
            SELECT ${seededUuid(`${user.ref}:${state.name}:session:${i}`)}::uuid, ${user.id},
                   (SELECT id FROM training_cards WHERE "userId" = ${user.id} AND "itemKey" = ${c.itemKey}),
                   (SELECT id FROM training_sessions WHERE "referenceId" = ${sessionRef}), ${`i${i + 1}`}, 'BANK',
                   ${cardKind(c.mistake)}::"TrainingItemKind", 'fork', true, true, 18000, 'GOOD', 'GOOD', 'REVIEW', 4, 5, 4,
                   ${new Date(startedAt.getTime() + (i + 1) * 60_000).toISOString().replace("Z", "")}::timestamp, ${ts}::timestamp`);
          attempts++;
        }
      }
      return { cleared, attempts, gameIds };
    },
    { timeout: TX_TIMEOUT_MS },
  );

  const dueNow = bank.cards.filter((c) => c.schedule.due.getTime() <= now.getTime()).length;
  opts.log?.(
    `[personas] p5 ${state.name}: ${fixtures.length} game(s), ${bank.mistakes.length} mistake(s), ${bank.cards.length} card(s) (${dueNow} due), ` +
      `${report.attempts} attempt(s)`,
  );
  return {
    persona: state.name,
    cleared: report.cleared,
    games: fixtures.length,
    mistakes: bank.mistakes.length,
    cards: bank.cards.length,
    dueNow,
    attempts: report.attempts,
    gameRefs: Object.fromEntries(fixtures.map((f) => [f.key, f.game.ref])),
    firstCardKey: bank.cards[0]?.itemKey ?? null,
  };
}
