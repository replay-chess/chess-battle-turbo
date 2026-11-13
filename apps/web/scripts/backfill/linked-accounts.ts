/**
 * B5 linked-accounts backfill (phase-04 plan 6.6; data-model 11.6 B5): every legacy `chess_com_profiles` row becomes a
 * `linked_accounts` row (provider CHESSCOM) with its `import_cursors` row, so `/settings/connected` and the archive
 * show the account the member linked before P4. `chess_com_profiles` stays (dual-read until contract step C4).
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/linked-accounts.ts                          # dry run: counts, skips by reason
 *   npx tsx scripts/backfill/linked-accounts.ts --apply                  # writes links in batches of 500
 *   npx tsx scripts/backfill/linked-accounts.ts --apply --queue-imports  # also queues the first import (OD-1, P13)
 *
 * Mapping: `username` = the handle as stored, `usernameLower`, `externalId` = the lower-cased handle until the first
 * sync replaces it with Chess.com's `player_id`, `ratings` (RatingsV1) from the rapid / blitz / bullet / daily rating,
 * best and win/loss/draw columns (`games` = wins + losses + draws), `totalRatedGames` = their sum, `displayName`,
 * `avatarUrl` (https only), `countryCode` (from the country URL or a stored code), `title`, `joinedAt`,
 * `linkedAt` = the profile's `createdAt`, `verifiedAt` NULL (Chess.com links are unverified in P4, D4-10),
 * `importState` IDLE, no `nextAutoSyncAt` (nothing syncs until an import is queued). A handle that is not a valid
 * Chess.com username is skipped and counted (`invalid_handle`).
 *
 * Predicate: `NOT EXISTS (SELECT 1 FROM linked_accounts la WHERE la."userId" = p."userId" AND la.provider = 'CHESSCOM')`
 * (the insert repeats it and has ON CONFLICT ("userId", provider) DO NOTHING, so a link made in between is kept).
 * Verification: every profile has a CHESSCOM link afterwards (`unlinked` = 0, except counted skips).
 *
 * `--queue-imports` (owner decision OD-1; on production only in P13): every CHESSCOM link that never synced and has no
 * run gets an `ImportRun(INITIAL, WAITING_FOR_MEMBERSHIP)` (importState WAITING_FOR_MEMBERSHIP); then, for each
 * entitled user, `releaseWaitingImports()` + `kickImports("import")` (WEB/lib/jobs/import.ts), one user per second.
 * Non-members' runs wait for the entitlement fan-out (plan 8.5.4). Guards and the audit row: ./p04-common.ts.
 */
import { Prisma } from "@repo/db";
import { extractCountryCode } from "@repo/chess-import/chesscom/map";
import { CHESSCOM_USERNAME_RE } from "@repo/contracts/http/p04-plain";
import { buildRatings, type RatingsV1 } from "@repo/db/json";
import { isEntitled, type EntitlementCore } from "../../lib/billing/entitlement-rules";
import {
  BATCH_SIZE,
  eachBatch,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  recordBackfill,
  reportFailure,
  sleep,
  type BackfillDb,
} from "./p04-common";

// ─── Pure mapping (unit-tested in linked-accounts.test.ts) ──────────────────────────────────────────────────────

const POOLS = ["rapid", "blitz", "bullet", "daily"] as const;
type Pool = (typeof POOLS)[number];

export type LegacyProfileRow = {
  id: bigint;
  userId: bigint;
  chessComHandle: string;
  displayName: string | null;
  avatar: string | null;
  title: string | null;
  country: string | null;
  joined: Date | null;
  createdAt: Date;
} & { [K in `${Pool}Rating` | `${Pool}BestRating` | `${Pool}Wins` | `${Pool}Losses` | `${Pool}Draws`]: number | null };

export interface LinkInsert {
  userId: string;
  externalId: string;
  username: string;
  usernameLower: string;
  displayName: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  title: string | null;
  joinedAt: string | null;
  ratings: RatingsV1;
  totalRatedGames: number | null;
  linkedAt: string;
}

export type LinkSkipReason = "invalid_handle";
export type LinkMapping = { ok: true; link: LinkInsert } | { ok: false; reason: LinkSkipReason };

const RATING_MAX = 4000;
const validRating = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= RATING_MAX;
const nonNegative = (n: number | null) => (n !== null && Number.isInteger(n) && n > 0 ? n : 0);

/** RatingsV1 from the legacy columns; a pool without a valid current rating is left out. */
export function ratingsFromProfile(p: LegacyProfileRow): { ratings: RatingsV1; totalRatedGames: number | null } {
  const ratings: RatingsV1 = { v: 1 };
  let total: number | null = null;
  for (const pool of POOLS) {
    const rating = p[`${pool}Rating`];
    if (!validRating(rating)) continue;
    const best = p[`${pool}BestRating`];
    const games = nonNegative(p[`${pool}Wins`]) + nonNegative(p[`${pool}Losses`]) + nonNegative(p[`${pool}Draws`]);
    ratings[pool] = { rating, best: validRating(best) ? best : null, games };
    total = (total ?? 0) + games;
  }
  return { ratings: buildRatings(ratings), totalRatedGames: total };
}

function cleanText(value: string | null, max: number): string | null {
  const t = value?.trim() ?? "";
  if (t === "") return null;
  return t.length <= max ? t : t.slice(0, max);
}

/** A stored two-letter code, or the code at the end of Chess.com's country URL. */
export function countryCodeOf(value: string | null): string | null {
  const v = value?.trim() ?? "";
  if (v === "") return null;
  const code = /^[A-Za-z]{2}$/.test(v) ? v : extractCountryCode(v);
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

function avatarOf(value: string | null): string | null {
  const v = value?.trim() ?? "";
  return v.startsWith("https://") && v.length <= 300 ? v : null;
}

function titleOf(value: string | null): string | null {
  const v = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{1,4}$/.test(v) ? v : null;
}

export function linkFromProfile(p: LegacyProfileRow): LinkMapping {
  const handle = p.chessComHandle.trim();
  if (!CHESSCOM_USERNAME_RE.test(handle)) return { ok: false, reason: "invalid_handle" };
  const lower = handle.toLowerCase();
  const { ratings, totalRatedGames } = ratingsFromProfile(p);
  return {
    ok: true,
    link: {
      userId: p.userId.toString(),
      externalId: lower,
      username: handle,
      usernameLower: lower,
      displayName: cleanText(p.displayName, 80),
      avatarUrl: avatarOf(p.avatar),
      countryCode: countryCodeOf(p.country),
      title: titleOf(p.title),
      joinedAt: p.joined ? p.joined.toISOString() : null,
      ratings,
      totalRatedGames,
      linkedAt: p.createdAt.toISOString(),
    },
  };
}

// ─── Statements ─────────────────────────────────────────────────────────────────────────────────────────────────

const UNLINKED = Prisma.sql`NOT EXISTS (SELECT 1 FROM linked_accounts la WHERE la."userId" = p."userId" AND la.provider = 'CHESSCOM')`;

function profileBatchSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT p.id, p."userId", p."chessComHandle", p."displayName", p.avatar, p.title, p.country,
           (p.joined AT TIME ZONE 'UTC') AS joined, (p."createdAt" AT TIME ZONE 'UTC') AS "createdAt",
           p."rapidRating", p."rapidBestRating", p."rapidWins", p."rapidLosses", p."rapidDraws",
           p."blitzRating", p."blitzBestRating", p."blitzWins", p."blitzLosses", p."blitzDraws",
           p."bulletRating", p."bulletBestRating", p."bulletWins", p."bulletLosses", p."bulletDraws",
           p."dailyRating", p."dailyBestRating", p."dailyWins", p."dailyLosses", p."dailyDraws"
      FROM chess_com_profiles p
     WHERE p.id > ${cursor} AND ${UNLINKED}
     ORDER BY p.id LIMIT ${limit}`;
}

/** One statement per batch: the links (predicate repeated) and their cursors. */
export function insertLinksSql(links: readonly LinkInsert[]): Prisma.Sql {
  return Prisma.sql`
    WITH src AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS x(
        "userId" bigint, "externalId" text, username text, "usernameLower" text, "displayName" text, "avatarUrl" text,
        "countryCode" text, title text, "joinedAt" timestamptz, ratings jsonb, "totalRatedGames" int, "linkedAt" timestamptz)),
    ins AS (
      INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "displayName", "avatarUrl",
          "countryCode", title, "joinedAt", ratings, "totalRatedGames", "linkedAt", "updatedAt")
      SELECT s."userId", 'CHESSCOM', s."externalId", s.username, s."usernameLower", s."displayName", s."avatarUrl",
          s."countryCode", s.title, (s."joinedAt" AT TIME ZONE 'UTC'), s.ratings, s."totalRatedGames",
          (s."linkedAt" AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      FROM src s
      WHERE NOT EXISTS (SELECT 1 FROM linked_accounts la WHERE la."userId" = s."userId" AND la.provider = 'CHESSCOM')
      ON CONFLICT ("userId", provider) DO NOTHING
      RETURNING id, provider),
    cur AS (
      INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt")
      SELECT id, provider, (now() AT TIME ZONE 'UTC') FROM ins
      ON CONFLICT ("linkedAccountId") DO NOTHING
      RETURNING 1)
    SELECT (SELECT count(*)::int FROM ins) AS linked, (SELECT count(*)::int FROM cur) AS cursors`;
}

/** Links the backfill made that never synced and have no run yet (`--queue-imports`). */
const NEVER_IMPORTED = Prisma.sql`la.provider = 'CHESSCOM' AND la."lastSyncAt" IS NULL AND la."importedCount" = 0
  AND la."importState" = 'IDLE' AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r."linkedAccountId" = la.id)`;

/** One statement per batch: WAITING_FOR_MEMBERSHIP INITIAL runs (refs: `c` + 24 hex) and the account state. */
export function queueRunsBatchSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH b AS (
      SELECT la.id, la."userId" FROM linked_accounts la WHERE la.id > ${cursor} AND ${NEVER_IMPORTED} ORDER BY la.id LIMIT ${limit}
    ), run AS (
      INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "createdAt", "updatedAt")
      SELECT 'c' || substr(md5(gen_random_uuid()::text || b.id::text), 1, 24), b."userId", b.id, 'CHESSCOM', 'INITIAL',
             'WAITING_FOR_MEMBERSHIP', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      FROM b
      ON CONFLICT DO NOTHING
      RETURNING "linkedAccountId"),
    acc AS (
      UPDATE linked_accounts SET "importState" = 'WAITING_FOR_MEMBERSHIP', "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id IN (SELECT "linkedAccountId" FROM run)
      RETURNING 1)
    SELECT (SELECT max(id) FROM b) AS last, (SELECT count(*)::int FROM b) AS size, (SELECT count(*)::int FROM run) AS queued`;
}

/** Users with a waiting INITIAL run (the release candidates), with the columns `isEntitled` reads. */
function waitingUsersSql(cursor: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT u.id, u."subscriptionStatus", u."cancelAtPeriodEnd", (u."currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd"
      FROM users u
     WHERE u.id > ${cursor}
       AND EXISTS (SELECT 1 FROM import_runs r WHERE r."userId" = u.id AND r.status = 'WAITING_FOR_MEMBERSHIP' AND r.trigger = 'INITIAL')
     ORDER BY u.id LIMIT ${limit}`;
}

// ─── Runner ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** WEB/lib/jobs/import.ts (WP-C) and the entitlement rule, injected so tests run them against a local Postgres. */
export interface QueueImportDeps {
  releaseWaitingImports(db: BackfillDb, userId: bigint): Promise<{ released: number; queued: number }>;
  kickImports(reason: "import"): Promise<unknown>;
  isEntitled(row: EntitlementCore, now: Date): boolean;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

/** One entitled user per second (plan 6.6 B5): spreads the first imports over the worker's I/O lane. */
export const RELEASE_SPACING_MS = 1_000;

export interface LinkedAccountsBackfillResult {
  apply: boolean;
  /** Profiles without a CHESSCOM link at the start. */
  unlinkedBefore: number;
  linked: number;
  cursors: number;
  skipped: Record<LinkSkipReason, number>;
  batches: number;
  /** Profiles still without a CHESSCOM link at the end (the verification; equals the skips after --apply). */
  unlinkedAfter: number;
  queue: null | {
    /** Links that get (dry run: would get) a waiting INITIAL run. */
    runs: number;
    /** Entitled users whose waiting runs are (would be) released now. */
    entitledUsers: number;
    released: number;
    jobs: number;
    waitingUsers: number;
  };
}

async function countUnlinked(db: BackfillDb): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM chess_com_profiles p WHERE ${UNLINKED}`);
  return rows[0]?.n ?? 0;
}

/** Entitlement columns of the given users (the dry run's would-be release candidates). */
function entitlementOfSql(userIds: readonly bigint[]): Prisma.Sql {
  return Prisma.sql`
    SELECT u.id, u."subscriptionStatus", u."cancelAtPeriodEnd", (u."currentPeriodEnd" AT TIME ZONE 'UTC') AS "currentPeriodEnd"
      FROM users u WHERE u.id = ANY(${userIds.map(String)}::bigint[])`;
}

async function queueImports(
  db: BackfillDb,
  apply: boolean,
  wouldLink: readonly bigint[],
  deps: QueueImportDeps,
  log: (l: string) => void,
): Promise<NonNullable<LinkedAccountsBackfillResult["queue"]>> {
  const out = { runs: 0, entitledUsers: 0, released: 0, jobs: 0, waitingUsers: 0 };
  if (apply) {
    await eachBatch(async (cursor, n) => {
      const rows = await db.$queryRaw<{ last: bigint | null; size: number; queued: number }[]>(queueRunsBatchSql(cursor, n));
      out.runs += rows[0]!.queued;
      return { last: rows[0]!.last, size: rows[0]!.size };
    });
  } else {
    // Existing links without a run, plus the links this run would create (each gets one waiting run).
    const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM linked_accounts la WHERE ${NEVER_IMPORTED}`);
    out.runs = (rows[0]?.n ?? 0) + wouldLink.length;
  }
  const now = deps.now();
  const entitled = new Map<string, bigint>();
  await eachBatch(async (cursor, n) => {
    const users = await db.$queryRaw<(EntitlementCore & { id: bigint })[]>(waitingUsersSql(cursor, n));
    out.waitingUsers += users.length;
    for (const u of users) if (deps.isEntitled(u, now)) entitled.set(String(u.id), u.id);
    return { last: users.at(-1)?.id ?? null, size: users.length };
  });
  if (!apply) {
    // The users whose waiting runs a write would create: existing never-imported links and the would-be links.
    const existing = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT DISTINCT la."userId" AS id FROM linked_accounts la WHERE ${NEVER_IMPORTED}`);
    const candidates = [...existing.map((r) => r.id), ...wouldLink];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const users = await db.$queryRaw<(EntitlementCore & { id: bigint })[]>(entitlementOfSql(candidates.slice(i, i + BATCH_SIZE)));
      for (const u of users) if (deps.isEntitled(u, now)) entitled.set(String(u.id), u.id);
    }
    out.entitledUsers = entitled.size;
    return out;
  }
  out.entitledUsers = entitled.size;
  for (const [i, userId] of [...entitled.values()].entries()) {
    if (i > 0) await deps.sleep(RELEASE_SPACING_MS);
    const r = await deps.releaseWaitingImports(db, userId);
    out.released += r.released;
    out.jobs += r.queued;
    if (r.queued > 0) await deps.kickImports("import");
    log(`[linked-accounts] users.id ${userId}: released ${r.released} run(s), queued ${r.queued} job(s)`);
  }
  return out;
}

export async function runLinkedAccountsBackfill(
  db: BackfillDb,
  opts: { apply: boolean; queueImports: boolean; deps?: QueueImportDeps; log?: (line: string) => void; batchSize?: number },
): Promise<LinkedAccountsBackfillResult> {
  const log = opts.log ?? (() => {});
  const limit = opts.batchSize ?? BATCH_SIZE;
  if (opts.queueImports && !opts.deps) throw new Error("--queue-imports needs the import helpers (deps)");
  const result: LinkedAccountsBackfillResult = {
    apply: opts.apply,
    unlinkedBefore: await countUnlinked(db),
    linked: 0,
    cursors: 0,
    skipped: { invalid_handle: 0 },
    batches: 0,
    unlinkedAfter: 0,
    queue: null,
  };

  const wouldLink: bigint[] = [];
  result.batches = await eachBatch(async (cursor, n) => {
    const profiles = await db.$queryRaw<LegacyProfileRow[]>(profileBatchSql(cursor, n));
    const links: LinkInsert[] = [];
    for (const p of profiles) {
      const m = linkFromProfile(p);
      if (m.ok) links.push(m.link);
      else result.skipped[m.reason]++;
    }
    if (opts.apply && links.length > 0) {
      const rows = await db.$queryRaw<{ linked: number; cursors: number }[]>(insertLinksSql(links));
      result.linked += rows[0]!.linked;
      result.cursors += rows[0]!.cursors;
      log(`[linked-accounts] batch after profile ${cursor}: linked ${rows[0]!.linked} of ${profiles.length}`);
    } else if (!opts.apply) {
      result.linked += links.length;
      for (const l of links) wouldLink.push(BigInt(l.userId));
    }
    return { last: profiles.at(-1)?.id ?? null, size: profiles.length };
  }, limit);
  result.unlinkedAfter = opts.apply ? await countUnlinked(db) : result.unlinkedBefore;

  if (opts.queueImports) result.queue = await queueImports(db, opts.apply, wouldLink, opts.deps!, log);

  if (opts.apply) {
    await recordBackfill(db, "linked_accounts", {
      unlinkedBefore: result.unlinkedBefore,
      linked: result.linked,
      cursors: result.cursors,
      skippedInvalidHandle: result.skipped.invalid_handle,
      unlinkedAfter: result.unlinkedAfter,
      batches: result.batches,
      queueImports: opts.queueImports,
      ...(result.queue
        ? { runs: result.queue.runs, entitledUsers: result.queue.entitledUsers, released: result.queue.released, jobs: result.queue.jobs }
        : {}),
    });
  }
  return result;
}

async function main() {
  const { apply, flags } = parseBackfillArgs(process.argv.slice(2), ["--queue-imports"]);
  const queue = flags.has("--queue-imports");
  const log = (l: string) => console.log(l);
  log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}${queue ? " + queue imports" : ""}`);
  const { db } = await openBackfillDb(log);
  try {
    let deps: QueueImportDeps | undefined;
    if (queue) {
      const jobs = await import("../../lib/jobs/import");
      deps = {
        releaseWaitingImports: (d, userId) => jobs.releaseWaitingImports(d, userId),
        kickImports: (reason) => jobs.kickImports(reason),
        isEntitled: (row, now) => isEntitled(row, now),
        sleep,
        now: () => new Date(),
      };
    }
    const r = await runLinkedAccountsBackfill(db, { apply, queueImports: queue, deps, log });
    log(`profiles without a Chess.com link: ${r.unlinkedBefore}`);
    log(`${apply ? "linked  " : "would link"} ${r.linked}${apply ? ` (cursors ${r.cursors})` : ""}; skipped invalid handle ${r.skipped.invalid_handle}`);
    if (r.queue) {
      log(
        `imports ${apply ? "queued" : "would queue"} ${r.queue.runs} waiting run(s); entitled users ${r.queue.entitledUsers}` +
          (apply ? `; released ${r.queue.released} run(s), ${r.queue.jobs} job(s)` : ""),
      );
    }
    if (apply) {
      log(`verify  profiles still without a link: ${r.unlinkedAfter} (expected ${r.skipped.invalid_handle}, the skipped handles)`);
      if (r.unlinkedAfter !== r.skipped.invalid_handle) process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/linked-accounts", err));
