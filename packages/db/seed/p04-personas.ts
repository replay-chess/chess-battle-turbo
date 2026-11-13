// Phase 4 persona writers (phase-04 plan 6.7, data-model 13.4; testing X4). They put a pool user, S, or a dev user into
// one of the states of ./p04-persona-states.ts, exactly: the reset first removes every trace of an earlier P4 state,
// then writes the persona's columns, links, cursors, runs and imported games.
//
// Callers:
//   - WEB/scripts/dev/personas.ts (the persona tool behind `leasePersona()` and the dev seed:
//     `npx tsx scripts/dev/personas.ts --reset S --persona import-trial`). It owns the target guards (dev endpoint or
//     a local Postgres), passes the trial-ledger hashers from WEB/lib/billing/trial-ledger.ts and syncs the Clerk
//     claims afterwards; WP-H wires it through WEB/e2e/personas/p04.ts.
//   - the integration test test/p04-personas.int.test.ts.
//
// The reset (plan 6.7 "E2E lease pool"), in one transaction:
//   1. the user's `trial_ledger` rows: the email hash and every handle hash (verified and unverified) of the user's
//      current links and of the persona's links, so a leased user is trial-eligible exactly when the persona says;
//   2. the user's QUEUED jobs;
//   3. the user's imported games, through `import_purge_batch()` (the plan 8.12 statement, `source <> 'REPLAY'`);
//      games another member also holds survive with only this member's side cleared;
//   4. the user's `linked_accounts` (cascading `import_cursors` and `import_runs`);
//   5. the billing, trial, checkout and onboarding columns set to the persona's values (`dodoCustomerId` NULL).
// Then the persona's links, cursors, runs and games are written, and `gamesVersion` is bumped (archive ETags).
//
// Imported games are the fixture accounts of @repo/chess-fixtures/import (Chess.com knightowl_88: three archive
// months; Lichess knightowl88: the export), mapped by @repo/chess-import's real mappers, so the seed exercises the
// same parser as the worker. Their `externalId` carries a per-user suffix, and persona links carry a per-user
// `externalId`: two leased users never collide on `games_source_externalId_key`, `game_players_gameId_color_key` or
// `linked_accounts_verified_key`, and a persona never blocks the real fixture identity a spec links through the
// upstream mock (the Lichess OAuth mock returns id `knightowl88`).
//
// Writes finished states only: no job is created, so the worker never picks a persona row up (a RUNNING run is a
// static picture; "Sync now" on it creates real work). Shared e2e letters A–R are refused (they only gain data).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Prisma, type PrismaClient } from "#generated";
import { mapChessComGame } from "@repo/chess-import/chesscom/map";
import { mapLichessGame } from "@repo/chess-import/lichess/map";
import type { ImportedGame } from "@repo/chess-import/types";
import { buildArchivesPatch, buildRatings, importError, type ArchivesV1 } from "../src/json";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { seededRef } from "./builders";
import {
  getP04PersonaState,
  P04_TIME,
  type P04GameSet,
  type P04LinkSpec,
  type P04PersonaState,
  type P04ProviderDb,
} from "./p04-persona-states";
import { checkTripwire, SeedGuardError } from "./target";
import { SHARED_LETTER_EMAIL, ts } from "./writer";

export {
  P04_PERSONA_STATES,
  P04_POOL_PERSONAS,
  P04_SEED_PERSONAS,
  getP04PersonaState,
  isP04PersonaName,
  type P04PersonaName,
  type P04PersonaState,
} from "./p04-persona-states";

const { MINUTE } = P04_TIME;

/** The trial-ledger hashers (WEB/lib/billing/trial-ledger.ts `trialLedgerEmailHash` / `handleHash`, plan 8.4). */
export interface LedgerKeys {
  emailHash(email: string): string;
  handleHash(provider: "chesscom" | "lichess", usernameLower: string, verified: boolean): string;
}

export interface P04WriteOptions {
  now?: Date;
  ledger: LedgerKeys;
  log?: (line: string) => void;
}

export interface P04ClearReport {
  ledgerRows: number;
  jobs: number;
  purgedGames: number;
  links: number;
}

export interface P04LinkReport {
  provider: P04ProviderDb;
  id: bigint;
  runRef: string | null;
  games: number;
  firstGameRef: string | null;
}

export interface P04PersonaReport {
  persona: string;
  userId: bigint;
  userRef: string;
  cleared: P04ClearReport;
  links: P04LinkReport[];
  ledgerRow: boolean;
}

/** Imported games per write statement (the batch writer's IMPORT_CHUNK). */
export const P04_GAME_CHUNK = 100;
/** `import_purge_batch` batch size (plan 8.12). */
const PURGE_BATCH = 500;
/** The interactive transaction of one reset: ≈ 10 statements, ≈ 80 games. */
const TX_TIMEOUT_MS = 60_000;

const providerSlug = (p: P04ProviderDb): "chesscom" | "lichess" => (p === "CHESSCOM" ? "chesscom" : "lichess");

// ── Fixture games ──────────────────────────────────────────────────────────────────────────────────────────────

const requireHere = createRequire(import.meta.url);
const fixtureText = (rel: string) => readFileSync(requireHere.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8");

export const CHESSCOM_FIXTURE_USER = "knightowl_88";
export const LICHESS_FIXTURE_USER = "knightowl88";
const CHESSCOM_MONTHS = ["2026-08", "2026-09", "2026-10"] as const;

const gameCache = new Map<Exclude<P04GameSet, null>, readonly ImportedGame[]>();

/** The fixture account's importable games through the real mappers, newest first. Skipped games are left out. */
export function fixtureGames(set: Exclude<P04GameSet, null>): readonly ImportedGame[] {
  const cached = gameCache.get(set);
  if (cached) return cached;
  const games: ImportedGame[] = [];
  if (set === "chesscom-knightowl_88") {
    for (const month of CHESSCOM_MONTHS) {
      const body = JSON.parse(fixtureText(`chesscom/${CHESSCOM_FIXTURE_USER}/${month}.json`)) as { games: unknown[] };
      for (const raw of body.games) {
        const r = mapChessComGame(raw, { usernameLower: CHESSCOM_FIXTURE_USER });
        if (r.ok) games.push(r.game);
      }
    }
  } else {
    for (const line of fixtureText(`lichess/${LICHESS_FIXTURE_USER}/games.ndjson`).split("\n")) {
      if (line.trim() === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue; // the fixture's deliberate malformed line (the worker counts it as skipped)
      }
      const r = mapLichessGame(raw, { userId: LICHESS_FIXTURE_USER });
      if (r.ok) games.push(r.game);
    }
  }
  games.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime() || (a.externalId < b.externalId ? -1 : 1));
  const frozen = Object.freeze(games);
  gameCache.set(set, frozen);
  return frozen;
}

const shortHash = (text: string, n: number) => createHash("sha256").update(text).digest("hex").slice(0, n);

/** A persona game's `externalId`: the provider id plus a per-user suffix (≤ 40 chars, `games."externalId"`). */
export function personaExternalId(externalId: string, userRef: string): string {
  const id = `${externalId}.p4${shortHash(userRef, 10)}`;
  if (id.length > 40) throw new SeedGuardError(`persona externalId ${id} is longer than 40 characters`);
  return id;
}

/** A persona link's `externalId` (≤ 64): never the fixture account's real id, unique per user and provider. */
export function personaLinkExternalId(provider: P04ProviderDb, userRef: string): string {
  return `p4seed:${providerSlug(provider)}:${userRef}`;
}

// ── Reset ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

interface TargetUser {
  id: bigint;
  ref: string;
}

function refuseShared(email: string): void {
  if (SHARED_LETTER_EMAIL.test(email)) {
    throw new SeedGuardError(`refusing: ${email} is a shared e2e user; personas run on pool users or S`);
  }
}

async function lockUser(tx: Tx, email: string): Promise<TargetUser> {
  const rows = await tx.$queryRaw<{ id: bigint; ref: string }[]>(Prisma.sql`
    SELECT id, "referenceId" AS ref FROM users WHERE email = ${email} FOR UPDATE`);
  const row = rows[0];
  if (!row) throw new SeedGuardError(`no users row for ${email}; provision it first`);
  return { id: row.id, ref: row.ref };
}

/** Every handle hash a ledger row might hold for these handles: both the verified and the unverified form. */
export function ledgerHandleHashes(
  ledger: LedgerKeys,
  handles: readonly { provider: P04ProviderDb; usernameLower: string }[],
): string[] {
  const out = new Set<string>();
  for (const h of handles) {
    out.add(ledger.handleHash(providerSlug(h.provider), h.usernameLower, true));
    out.add(ledger.handleHash(providerSlug(h.provider), h.usernameLower, false));
  }
  return [...out].sort();
}

async function clearInTx(
  tx: Tx,
  user: TargetUser,
  email: string,
  ledger: LedgerKeys,
  extraHandles: readonly { provider: P04ProviderDb; usernameLower: string }[],
): Promise<P04ClearReport> {
  const current = await tx.$queryRaw<{ provider: P04ProviderDb; usernameLower: string }[]>(Prisma.sql`
    SELECT provider::text AS provider, "usernameLower" FROM linked_accounts WHERE "userId" = ${user.id}`);
  const hashes = ledgerHandleHashes(ledger, [...current, ...extraHandles]);
  const ledgerRows = await tx.$executeRaw(Prisma.sql`
    DELETE FROM trial_ledger WHERE "emailHash" = ${ledger.emailHash(email)} OR "handleHashes" && ${hashes}::text[]`);
  const jobs = await tx.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "userId" = ${user.id} AND status = 'QUEUED'`);
  let purgedGames = 0;
  for (const source of ["CHESSCOM", "LICHESS"] as const) {
    for (;;) {
      const rows = await tx.$queryRaw<{ deleted_players: number }[]>(Prisma.sql`
        SELECT deleted_players FROM import_purge_batch(${user.id}::bigint, ${source}::"GameSource", ${PURGE_BATCH}::int)`);
      const n = Number(rows[0]?.deleted_players ?? 0);
      purgedGames += n;
      if (n === 0) break;
    }
  }
  const links = await tx.$executeRaw(Prisma.sql`DELETE FROM linked_accounts WHERE "userId" = ${user.id}`);
  return { ledgerRows, jobs, purgedGames, links };
}

/**
 * Removes every trace of a P4 persona from the user (ledger rows, queued jobs, imported games, links with their
 * cursors and runs). The persona tool calls it before any non-P4 persona too, so a pool user never carries a link or
 * an import from an earlier lease. Columns are left alone (the persona being applied sets them).
 */
export async function clearP04State(db: PrismaClient, email: string, opts: P04WriteOptions): Promise<P04ClearReport> {
  refuseShared(email);
  await checkTripwire(db, MAX_TARGET_USERS);
  const cleared = await db.$transaction(
    async (tx) => {
      const user = await lockUser(tx, email);
      return clearInTx(tx, user, email, opts.ledger, []);
    },
    { timeout: TX_TIMEOUT_MS },
  );
  opts.log?.(
    `[personas] p4 cleared: ${cleared.links} link(s), ${cleared.purgedGames} imported game(s), ${cleared.jobs} queued job(s), ` +
      `${cleared.ledgerRows} ledger row(s)`,
  );
  return cleared;
}

// ── Write ──────────────────────────────────────────────────────────────────────────────────────────────────────

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * MINUTE);
const minutesAhead = (now: Date, m: number) => new Date(now.getTime() + m * MINUTE);

/** The user's billing, trial, checkout and onboarding columns (one UPDATE). */
function userColumnsSql(user: TargetUser, email: string, state: P04PersonaState, now: Date): Prisma.Sql {
  const b = state.billing(now);
  const x = state.extras(now);
  const o = state.onboarding;
  const onboardedAt = o.step === "DONE" ? minutesAgo(now, o.onboardedAgoMin ?? 0) : null;
  return Prisma.sql`
    UPDATE users SET
      plan = ${b.plan}, "planInterval" = ${b.planInterval},
      "subscriptionId" = ${b.hasSubscription ? `e2e_persona_${email}` : null},
      "subscriptionStatus" = ${b.subscriptionStatus}, "subscriptionProductId" = ${b.subscriptionProductId},
      "currentPeriodEnd" = ${ts(b.currentPeriodEnd)}, "cancelAtPeriodEnd" = ${b.cancelAtPeriodEnd},
      "subscriptionUpdatedAt" = ${ts(b.subscriptionUpdatedAt)}, "subscriptionSourceAt" = NULL,
      "trialStartedAt" = ${ts(b.trialStartedAt)}, "trialEndsAt" = ${ts(b.trialEndsAt)},
      "dodoCustomerId" = NULL,
      "trialOfferedAt" = ${ts(x.trialOfferedAt)}, "membershipEndedAt" = ${ts(x.membershipEndedAt)},
      "pendingCheckoutSessionId" = NULL, "pendingCheckoutPlan" = NULL, "pendingCheckoutAt" = NULL,
      "lastCheckoutSource" = NULL, "lastPaymentFailedAt" = NULL, "lastPaymentFailureReason" = NULL,
      onboarded = ${o.step === "DONE"}, "onboardingStep" = ${o.step}::"OnboardingStep", "onboardedAt" = ${ts(onboardedAt)},
      "ratingBand" = ${o.ratingBand}::"RatingBand", "ratingBandSource" = ${o.ratingBandSource},
      "initialRating" = ${o.initialRating}::smallint, goals = ${[...o.goals]}::text[]::"OnboardingGoal"[],
      "dailyMinutes" = ${o.dailyMinutes}::smallint, "timeZone" = ${o.timeZone},
      "gamesVersion" = "gamesVersion" + 1, "updatedAt" = ${ts(now)}
    WHERE id = ${user.id}`;
}

function linkedAtOf(state: P04PersonaState, link: P04LinkSpec, now: Date): Date {
  const onboardedAgo = state.onboarding.onboardedAgoMin ?? 10;
  const runAgo = link.run?.startedAgoMin ?? 0;
  return minutesAgo(now, Math.max(onboardedAgo, runAgo) + 1);
}

async function insertLink(tx: Tx, user: TargetUser, state: P04PersonaState, link: P04LinkSpec, now: Date): Promise<bigint> {
  const linkedAt = linkedAtOf(state, link, now);
  const ratings = buildRatings({ v: 1, ...link.ratings });
  const lastError = link.lastError
    ? importError(link.lastError.code, link.lastError.message, minutesAgo(now, link.lastError.agoMin), {
        retryAt: link.lastError.retryInSec !== undefined ? new Date(now.getTime() + link.lastError.retryInSec * 1000) : null,
        httpStatus: link.lastError.httpStatus ?? null,
      })
    : null;
  const at = (m: number | null) => (m === null ? null : minutesAgo(now, m));
  const rows = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "displayName", "avatarUrl",
        "countryCode", title, "joinedAt", ratings, "totalRatedGames", "verifiedAt", status, "importState", "importedCount",
        "skippedCount", "autoImport", "nextAutoSyncAt", "nextAllowedSyncAt", "lastSyncAt", "lastSyncOkAt", "lastError",
        "linkedAt", "updatedAt")
    VALUES (${user.id}, ${link.provider}::"ChessProvider", ${personaLinkExternalId(link.provider, user.ref)}, ${link.username},
        ${link.username.toLowerCase()}, ${link.displayName}, ${link.avatarUrl}, ${link.countryCode}, ${link.title},
        ${ts(link.joinedAt)}, ${JSON.stringify(ratings)}::jsonb, ${link.totalRatedGames}, ${ts(link.verified ? linkedAt : null)},
        ${link.status}::"LinkStatus", ${link.importState}::"ImportState", ${link.importedCount}, ${link.skippedCount}, true,
        ${ts(link.nextAutoSyncInMin === null ? null : minutesAhead(now, link.nextAutoSyncInMin))},
        ${ts(link.nextAllowedSyncInSec === null ? null : new Date(now.getTime() + link.nextAllowedSyncInSec * 1000))},
        ${ts(at(link.lastSyncAgoMin))}, ${ts(at(link.lastSyncOkAgoMin))},
        ${lastError === null ? null : JSON.stringify(lastError)}::jsonb, ${ts(linkedAt)}, ${ts(now)})
    RETURNING id`);
  return rows[0]!.id;
}

/** The cursor a finished import of these games leaves (Chess.com archive months; Lichess `since`). */
export function cursorOf(provider: P04ProviderDb, games: readonly ImportedGame[], now: Date) {
  if (games.length === 0) {
    return { archives: null, archivesEtag: null, lichessSinceMs: null, oldestImportedAt: null, seen: 0 };
  }
  const oldest = games.reduce((m, g) => (g.endedAt < m ? g.endedAt : m), games[0]!.endedAt);
  if (provider === "LICHESS") {
    const newestMs = games.reduce((m, g) => Math.max(m, g.createdAtMs ?? g.endedAt.getTime()), 0);
    return { archives: null, archivesEtag: null, lichessSinceMs: BigInt(newestMs), oldestImportedAt: oldest, seen: games.length };
  }
  const months: ArchivesV1["months"] = {};
  const currentKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const g of games) {
    const key = `${g.endedAt.getUTCFullYear()}/${String(g.endedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    const m = (months[key] ??= { done: key !== currentKey, games: 0, skipped: 0, etag: `"p4seed-${key}"` });
    m.games += 1;
  }
  const archives = buildArchivesPatch({ v: 1, months });
  return { archives, archivesEtag: `"p4seed-${games.length}"`, lichessSinceMs: null, oldestImportedAt: oldest, seen: games.length };
}

async function insertCursor(tx: Tx, accountId: bigint, provider: P04ProviderDb, games: readonly ImportedGame[], now: Date) {
  const c = cursorOf(provider, games, now);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO import_cursors ("linkedAccountId", provider, "archivesEtag", archives, "lichessSinceMs", "oldestImportedAt",
        seen, "updatedAt")
    VALUES (${accountId}, ${provider}::"ChessProvider", ${c.archivesEtag}, ${c.archives === null ? null : JSON.stringify(c.archives)}::jsonb,
        ${c.lichessSinceMs}::bigint, ${ts(c.oldestImportedAt)}, ${c.seen}, ${ts(now)})`);
}

/** One data-modifying statement per chunk: the batch writer's games + game_players inserts (plan 8.8), no jobs. */
function gamesChunkSql(
  rows: readonly (ImportedGame & { referenceId: string; ord: number })[],
  user: TargetUser,
  accountId: bigint,
  source: P04ProviderDb,
  now: Date,
): Prisma.Sql {
  const json = JSON.stringify(
    rows.map((g) => ({
      ...g,
      endedAt: g.endedAt.toISOString(),
      evalHint: undefined,
      createdAtMs: undefined,
      opponentName: g.opponentName.slice(0, 40),
    })),
  );
  return Prisma.sql`
    WITH src AS (
      SELECT * FROM jsonb_to_recordset(${json}::jsonb) AS x(
        "referenceId" text, ord int, "externalId" text, "externalUrl" text, "timeClass" "TimeClass", rated boolean,
        "endedAt" timestamptz, "whiteName" text, "blackName" text, "whiteRating" int, "blackRating" int,
        "whiteTitle" text, "blackTitle" text, outcome "GameWinner", "endMethod" "GameEndMethod", "legacyResult" "GameResult",
        "ecoCode" text, "openingName" text, moves text, "moveClocksMs" int[], "plyCount" int, "startPly" int,
        "startingFen" text, fen text, "initialTimeSeconds" int, "incrementSeconds" int,
        "creatorTimeRemaining" int, "opponentTimeRemaining" int, "memberWon" boolean,
        color char(1), result "PlayerResult", "ratingBefore" int, "ratingDelta" int,
        "opponentName" text, "opponentRating" int)),
    ins AS (
      INSERT INTO games ("referenceId", source, "externalId", "externalUrl", mode, status, rated, "timeClass",
          "completedAt", "expiresAt", "whiteName", "blackName", "whiteRating", "blackRating", "whiteTitle", "blackTitle",
          outcome, "endMethod", result, "winnerId", "ecoCode", "openingName", moves, "moveClocksMs", "plyCount", "startPly",
          "startingFen", fen, "initialTimeSeconds", "incrementSeconds", "creatorTimeRemaining", "opponentTimeRemaining",
          "creatorId", "whitePlayerId", "blackPlayerId", "analysisStatus", "createdAt", "updatedAt")
      SELECT s."referenceId", ${source}::"GameSource", s."externalId", s."externalUrl", 'IMPORTED', 'COMPLETED', s.rated, s."timeClass",
          (s."endedAt" AT TIME ZONE 'UTC'), (s."endedAt" AT TIME ZONE 'UTC'), s."whiteName", s."blackName",
          s."whiteRating", s."blackRating", s."whiteTitle", s."blackTitle",
          s.outcome, s."endMethod", s."legacyResult", CASE WHEN s."memberWon" THEN ${user.id}::bigint END, s."ecoCode", s."openingName",
          s.moves, s."moveClocksMs", s."plyCount", s."startPly", s."startingFen", s.fen, s."initialTimeSeconds",
          s."incrementSeconds", s."creatorTimeRemaining", s."opponentTimeRemaining",
          ${user.id}::bigint, CASE WHEN s.color = 'w' THEN ${user.id}::bigint END, CASE WHEN s.color = 'b' THEN ${user.id}::bigint END,
          'NONE', ${ts(now)}, ${ts(now)}
      FROM src s
      RETURNING id, "externalId"),
    gp AS (
      INSERT INTO game_players ("gameId", "userId", color, source, mode, "timeClass", rated, "endedAt", result,
          "ratingBefore", "ratingDelta", "opponentName", "opponentRating", "ecoCode", "linkedAccountId", "createdAt", "updatedAt")
      SELECT ins.id, ${user.id}::bigint, s.color, ${source}::"GameSource", 'IMPORTED', s."timeClass", s.rated,
          (s."endedAt" AT TIME ZONE 'UTC'), s.result, s."ratingBefore", s."ratingDelta", s."opponentName", s."opponentRating",
          s."ecoCode", ${accountId}::bigint, ${ts(now)}, ${ts(now)}
      FROM ins JOIN src s USING ("externalId")
      RETURNING "gameId")
    SELECT (SELECT count(*) FROM gp)::int AS inserted,
           (SELECT ins.id FROM ins JOIN src s USING ("externalId") ORDER BY s.ord LIMIT 1) AS "firstGameId"`;
}

async function insertGames(
  tx: Tx,
  user: TargetUser,
  accountId: bigint,
  provider: P04ProviderDb,
  games: readonly ImportedGame[],
  now: Date,
): Promise<{ inserted: number; firstGameId: bigint | null; firstGameRef: string | null }> {
  const rows = games.map((g, ord) => {
    const externalId = personaExternalId(g.externalId, user.ref);
    return { ...g, externalId, ord, referenceId: seededRef(`p4-game:${provider}:${externalId}`, user.ref) };
  });
  let inserted = 0;
  let firstGameId: bigint | null = null;
  for (let i = 0; i < rows.length; i += P04_GAME_CHUNK) {
    const chunk = rows.slice(i, i + P04_GAME_CHUNK);
    const r = await tx.$queryRaw<{ inserted: number; firstGameId: bigint | null }[]>(gamesChunkSql(chunk, user, accountId, provider, now));
    inserted += Number(r[0]?.inserted ?? 0);
    if (firstGameId === null) firstGameId = r[0]?.firstGameId ?? null;
  }
  return { inserted, firstGameId, firstGameRef: rows[0]?.referenceId ?? null };
}

async function insertRun(
  tx: Tx,
  user: TargetUser,
  accountId: bigint,
  link: P04LinkSpec,
  firstGameId: bigint | null,
  now: Date,
): Promise<string | null> {
  const run = link.run;
  if (!run) return null;
  const ref = seededRef(`p4-run:${link.provider}`, user.ref);
  const error = run.error ? importError(run.error.code, run.error.message, minutesAgo(now, run.error.agoMin)) : null;
  const at = (m: number | null) => (m === null ? null : minutesAgo(now, m));
  const createdAt = at(run.startedAgoMin) ?? minutesAgo(now, 1);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, phase, seen, total, imported,
        skipped, "analysisQueued", analysed, "firstGameId", error, "createdAt", "startedAt", "finishedAt", "updatedAt")
    VALUES (${ref}, ${user.id}, ${accountId}, ${link.provider}::"ChessProvider", ${run.trigger}::"ImportTrigger",
        ${run.status}::"ImportRunStatus", ${run.phase}, ${run.seen}, ${run.total}::int, ${run.imported}, ${run.skipped},
        ${run.analysisQueued}::smallint, ${run.analysed}::smallint, ${firstGameId}::bigint,
        ${error === null ? null : JSON.stringify(error)}::jsonb, ${ts(createdAt)}, ${ts(at(run.startedAgoMin))},
        ${ts(at(run.finishedAgoMin))}, ${ts(now)})`);
  return ref;
}

/**
 * Applies a P4 persona to `email` exactly (see the header). Idempotent: applying the same persona twice leaves the
 * same rows (fresh ids, the same refs). `db` must already be guarded by the caller (dev endpoint or local Postgres).
 */
export async function writeP04Persona(
  db: PrismaClient,
  email: string,
  personaName: string,
  opts: P04WriteOptions,
): Promise<P04PersonaReport> {
  refuseShared(email);
  const state = getP04PersonaState(personaName);
  const now = opts.now ?? new Date();
  const links = state.links(now);
  await checkTripwire(db, MAX_TARGET_USERS);
  const report = await db.$transaction(
    async (tx) => {
      const user = await lockUser(tx, email);
      const cleared = await clearInTx(
        tx,
        user,
        email,
        opts.ledger,
        links.map((l) => ({ provider: l.provider, usernameLower: l.username.toLowerCase() })),
      );
      await tx.$executeRaw(userColumnsSql(user, email, state, now));
      const written: P04LinkReport[] = [];
      for (const link of links) {
        const accountId = await insertLink(tx, user, state, link, now);
        const games = link.games ? fixtureGames(link.games) : [];
        await insertCursor(tx, accountId, link.provider, games, now);
        const g = await insertGames(tx, user, accountId, link.provider, games, now);
        const runRef = await insertRun(tx, user, accountId, link, g.firstGameId, now);
        written.push({ provider: link.provider, id: accountId, runRef, games: g.inserted, firstGameRef: g.firstGameRef });
      }
      if (state.ledgerRow) {
        const b = state.billing(now);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO trial_ledger ("emailHash", "handleHashes", "firstTrialAt")
          VALUES (${opts.ledger.emailHash(email)}, ARRAY[]::text[], ${ts(b.trialStartedAt ?? now)})
          ON CONFLICT ("emailHash") DO NOTHING`);
      }
      return { persona: state.name, userId: user.id, userRef: user.ref, cleared, links: written, ledgerRow: state.ledgerRow };
    },
    { timeout: TX_TIMEOUT_MS },
  );
  opts.log?.(
    `[personas] p4 ${report.persona}: cleared ${report.cleared.links} link(s), ${report.cleared.purgedGames} imported game(s), ` +
      `${report.cleared.jobs} queued job(s), ${report.cleared.ledgerRows} ledger row(s); wrote ` +
      (report.links.length === 0
        ? "no links"
        : report.links.map((l) => `${providerSlug(l.provider)} (${l.games} games${l.runRef ? `, run ${l.runRef}` : ""})`).join(", ")),
  );
  return report;
}
