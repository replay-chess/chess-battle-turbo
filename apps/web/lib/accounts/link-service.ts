// The account write paths (phase-04 plan §7.3.2, §7.3.5–§7.3.8, §7.4 retry, §8.15; D4-07, D4-10, D4-15). Server-only.
// Each operation is ONE interactive transaction (≤ 7 statements, all next to Neon) through a seam, so the routes stay
// thin and test/api/accounts.contract.int.test.ts runs the real SQL on Docker Postgres:
//
//   linkChessCom     same handle again → idempotent 200; another Chess.com link → 409 already_linked; a VERIFIED
//                    link elsewhere → 409 linked_elsewhere (re-checked inside the transaction); else insert the
//                    account (unverified), its cursor, the INITIAL run (QUEUED when entitled, else
//                    WAITING_FOR_MEMBERSHIP, D4-07) and, when entitled, the IMPORT_SYNC job; context onboarding also
//                    moves the step to LEVEL (monotonic) and stores the band suggestion with COALESCE (D4-15).
//   linkLichess      the OAuth callback's write: the same rules, verified (Lichess rows are always verified; the
//                    partial unique index linked_accounts_verified_key backs linked_elsewhere); the same account again
//                    refreshes the ratings; returnTo onboarding moves the step to CONFIRM.
//   syncAccount      ACC-4: a MANUAL run (the import_runs_one_active index makes "already running" race-free) and the
//                    job upsert at IMPORT_SYNC_MANUAL; a RUNNING job → 409 sync_running.
//   retryRun         ACC-8: FAILED → QUEUED (trigger RETRY) and the job upsert.
//   setAutoImport    ACC-5: the switch, `nextAutoSyncAt` in the member's zone (§8.10), the DAILY job on / off.
//   unlinkAccount    ACC-6: drops the queued job and the link (cascades cursor and runs; game_players.linkedAccountId
//                    → NULL), the legacy chess_com_profiles row for Chess.com, and with deleteGames queues IMPORT_PURGE.
//
// Side effects after the commit (kick, audit, the legacy dual-write, cache tags, telemetry) are returned as a list of
// `effects` the route runs in `after()`, so a failed effect never fails the request and tests can inspect them.
import type { ChessComProfile, ChessComStats } from "@repo/chess-import/chesscom/types";
import type { LichessAccount } from "@repo/chess-import/lichess/types";
import { chessComRatings, lichessRatings } from "@repo/chess-import/ratings";
import type { LinkData, LinkedAccountView, ProviderSlug, RunView } from "@repo/contracts/http/accounts";
import type { OnboardingView } from "@repo/contracts/http/onboarding";
import {
  ONBOARDING_STEPS_DB,
  providerToDb,
  toWire,
  type OnboardingStepDb,
  type ProviderDb,
} from "@repo/contracts/http/p04-plain";
import { nextAutoSyncAt } from "@repo/contracts/internal/import-schedule";
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, importDedupeKey, importPurgeDedupeKey, type ImportTriggerDb } from "@repo/contracts/internal/jobs";
import { Prisma } from "@repo/db";
import { newGameRef } from "@repo/db/games";
import { enqueueJob } from "@repo/db/jobs";
import { buildRatings } from "@repo/db/json";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { readLinkedAccount, verifiedElsewhere, type AccountsDb } from "@/lib/data/accounts";
import { toRunView, type RunRow } from "@/lib/data/import-rows";
import { DataError } from "@/lib/data/errors";
import { rawDb } from "@/lib/games/snapshot.server";
import { enqueueImport } from "@/lib/jobs/import";
import { extractCountryCode } from "@repo/chess-import/chesscom/map";
import { suggestBand } from "@/lib/onboarding/suggest-band";
import { profileView } from "./preview";

// ── Seam ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LinkDeps = {
  /** One interactive transaction (READ COMMITTED); the callback's statements commit or roll back together. */
  transaction<T>(fn: (db: AccountsDb) => Promise<T>): Promise<T>;
  /** Statements outside a transaction (re-reads after a commit). */
  db(): Promise<AccountsDb>;
};

const prismaDeps: LinkDeps = {
  async transaction(fn) {
    const { prisma } = await import("@/lib/prisma");
    return prisma.$transaction((tx) => fn(rawDb(tx)), { maxWait: 5_000, timeout: 10_000 });
  },
  async db() {
    const { prisma } = await import("@/lib/prisma");
    return rawDb(prisma);
  },
};

let deps: LinkDeps = prismaDeps;

/** Test seam; returns a restore function. */
export function setLinkDeps(next: LinkDeps): () => void {
  const previous = deps;
  deps = next;
  return () => {
    deps = previous;
  };
}

// ── Shared statements ────────────────────────────────────────────────────────────────────────────────────────────

const UTC = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Effects for after(): never awaited by the request. */
export type LinkEffect =
  | { kind: "kick"; reason: "import" | "import_retry" }
  | { kind: "audit"; action: "account.linked" | "account.unlinked" | "account.link_coclaim"; provider: ProviderSlug; meta: Record<string, string | number | boolean> }
  | { kind: "dual_write"; profile: ChessComProfile; stats: ChessComStats }
  | { kind: "revalidate"; tag: string }
  | { kind: "event"; name: "account_linked" | "account_unlinked"; props: Record<string, string | number | boolean> };

type OnboardingRow = {
  onboardingStep: OnboardingStepDb;
  onboarded: boolean;
  onboardedAt: Date | null;
  ratingBand: string | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: string[] | null;
  dailyMinutes: number | null;
};

export function toOnboardingView(r: OnboardingRow): OnboardingView {
  const minutes = r.dailyMinutes === 5 || r.dailyMinutes === 10 || r.dailyMinutes === 20 ? r.dailyMinutes : null;
  return {
    step: toWire(r.onboardingStep) as OnboardingView["step"],
    done: Boolean(r.onboarded),
    ratingBand: r.ratingBand ? (r.ratingBand.toLowerCase() as OnboardingView["ratingBand"]) : null,
    ratingBandSource: r.ratingBandSource,
    initialRating: r.initialRating === null ? null : Number(r.initialRating),
    goals: (r.goals ?? []).map((g) => g.toLowerCase()) as OnboardingView["goals"],
    dailyMinutes: minutes,
    onboardedAt: r.onboardedAt ? new Date(r.onboardedAt).toISOString() : null,
  };
}

/**
 * The monotonic step update folded into a link (D4-15): the step moves forward only, the band suggestion is written
 * only where the member has none yet. Returns the onboarding columns after the write.
 */
export function advanceOnboardingSql(
  userId: bigint,
  step: Exclude<OnboardingStepDb, "DONE">,
  band: { band: string; source: string; initialRating: number } | null,
  now: Date,
): Prisma.Sql {
  return Prisma.sql`UPDATE users SET
  "onboardingStep" = CASE WHEN array_position(${[...ONBOARDING_STEPS_DB]}::text[], ${step}::text)
                              > array_position(${[...ONBOARDING_STEPS_DB]}::text[], "onboardingStep"::text)
                         THEN ${step}::"OnboardingStep" ELSE "onboardingStep" END,
  "ratingBand" = COALESCE("ratingBand", ${band?.band ?? null}::"RatingBand"),
  "ratingBandSource" = COALESCE("ratingBandSource", ${band?.source ?? null}::varchar(24)),
  "initialRating" = COALESCE("initialRating", ${band?.initialRating ?? null}::smallint),
  "updatedAt" = ${UTC(now)}
WHERE id = ${userId}::bigint
RETURNING "onboardingStep"::text AS "onboardingStep", onboarded, "onboardedAt", "ratingBand"::text AS "ratingBand",
          "ratingBandSource", "initialRating", goals::text[] AS goals, "dailyMinutes"`;
}

const RUN_RETURNING = Prisma.sql`id, "referenceId", provider::text AS provider, trigger::text AS trigger, status::text AS status,
  phase, seen, total, imported, skipped, "analysisQueued", analysed, error, "startedAt", "finishedAt", "updatedAt"`;

type RunInsertRow = RunRow & { id: bigint };

/** A new run; null when the account already has an active one (import_runs_one_active). */
function insertRunSql(input: {
  userId: bigint;
  linkedAccountId: bigint;
  provider: ProviderDb;
  trigger: ImportTriggerDb;
  status: "QUEUED" | "WAITING_FOR_MEMBERSHIP";
  now: Date;
}): Prisma.Sql {
  return Prisma.sql`INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "createdAt", "updatedAt")
VALUES (${newGameRef(input.now.getTime())}, ${input.userId}::bigint, ${input.linkedAccountId}::bigint, ${input.provider}::"ChessProvider",
        ${input.trigger}::"ImportTrigger", ${input.status}::"ImportRunStatus", ${UTC(input.now)}, ${UTC(input.now)})
ON CONFLICT ("linkedAccountId") WHERE status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING') DO NOTHING
RETURNING ${RUN_RETURNING}`;
}

function conflict(reason: "linked_elsewhere" | "already_linked" | "sync_running" | "not_failed" | "profile_closed"): DataError {
  return new DataError("conflict", { details: { reason } });
}

/** The SQLSTATE of a raw-query failure (Prisma P2010 carries it in meta.code), or null. */
export function sqlStateOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; meta?: { code?: unknown } };
  for (const v of [e.meta?.code, e.code]) if (typeof v === "string" && /^[0-9A-Z]{5}$/.test(v)) return v;
  const m = /\b(23505|23503)\b/.exec(String((err as { message?: unknown }).message ?? ""));
  return m ? m[1]! : null;
}

type LinkInsert = {
  provider: ProviderDb;
  externalId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  title: string | null;
  joinedAt: Date | null;
  ratings: unknown;
  totalRatedGames: number | null;
  verified: boolean;
};

function insertAccountSql(userId: bigint, a: LinkInsert, importState: "QUEUED" | "WAITING_FOR_MEMBERSHIP", now: Date): Prisma.Sql {
  return Prisma.sql`INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "displayName", "avatarUrl",
  "countryCode", title, "joinedAt", ratings, "totalRatedGames", "verifiedAt", "importState", "linkedAt", "updatedAt")
VALUES (${userId}::bigint, ${a.provider}::"ChessProvider", ${a.externalId}, ${a.username}, ${a.username.toLowerCase()}, ${a.displayName},
  ${a.avatarUrl}, ${a.countryCode}::char(2), ${a.title}, ${a.joinedAt ? UTC(a.joinedAt) : null}, ${JSON.stringify(a.ratings)}::jsonb,
  ${a.totalRatedGames}::int, ${a.verified ? UTC(now) : null}, ${importState}::"ImportState", ${UTC(now)}, ${UTC(now)})
ON CONFLICT ("userId", provider) DO NOTHING
RETURNING id, EXISTS (SELECT 1 FROM linked_accounts o WHERE o.provider = ${a.provider}::"ChessProvider"
  AND o."usernameLower" = ${a.username.toLowerCase()} AND o."userId" <> ${userId}::bigint) AS coclaim`;
}

type ExistingLink = { id: bigint; externalId: string };

async function lockExisting(db: AccountsDb, userId: bigint, provider: ProviderDb): Promise<ExistingLink | null> {
  const rows = await db.$queryRaw<ExistingLink[]>(Prisma.sql`SELECT id, "externalId" FROM linked_accounts
   WHERE "userId" = ${userId}::bigint AND provider = ${provider}::"ChessProvider" FOR UPDATE`);
  return rows[0] ? { id: BigInt(rows[0].id), externalId: rows[0].externalId } : null;
}

/** `coclaim`: another member links the same handle (D4-10), read by the insert itself (plan §9.4: ≤ 7 statements). */
type NewLink = { accountId: bigint; run: RunInsertRow; onboarding: OnboardingRow | null; queued: boolean; coclaim: boolean };

/** Steps 3–7 of §7.3.2 after the conflict checks: account, cursor, run, job, onboarding step. */
async function createLink(
  db: AccountsDb,
  viewer: Pick<Viewer, "id" | "entitlement">,
  a: LinkInsert,
  onboarding: { step: "LEVEL" | "CONFIRM" } | null,
  now: Date,
): Promise<NewLink | "raced"> {
  const entitled = viewer.entitlement.member;
  const state = entitled ? "QUEUED" : "WAITING_FOR_MEMBERSHIP";
  const inserted = await db.$queryRaw<{ id: bigint; coclaim: boolean }[]>(insertAccountSql(viewer.id, a, state, now));
  if (!inserted[0]) return "raced";
  const accountId = BigInt(inserted[0].id);
  const coclaim = inserted[0].coclaim === true;
  await db.$executeRaw(Prisma.sql`INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt")
    VALUES (${accountId}::bigint, ${a.provider}::"ChessProvider", ${UTC(now)})`);
  const runs = await db.$queryRaw<RunInsertRow[]>(
    insertRunSql({ userId: viewer.id, linkedAccountId: accountId, provider: a.provider, trigger: "INITIAL", status: state, now }),
  );
  const run = runs[0];
  if (!run) throw new Error("link: a brand-new account already had an active run");
  if (entitled) {
    const job = await enqueueImport(db, {
      linkedAccountId: accountId,
      userId: viewer.id,
      runId: BigInt(run.id),
      trigger: "INITIAL",
      priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL,
      runAt: now,
    });
    if (!job) throw new Error("link: the new account's import job is already running");
  }
  let onb: OnboardingRow | null = null;
  if (onboarding) {
    const suggestion = suggestBand(a.ratings as Parameters<typeof suggestBand>[0], a.provider === "CHESSCOM" ? "chesscom" : "lichess");
    const band = suggestion ? { band: suggestion.band, source: suggestion.source, initialRating: suggestion.initialRating } : null;
    const rows = await db.$queryRaw<OnboardingRow[]>(advanceOnboardingSql(viewer.id, onboarding.step, band, now));
    onb = rows[0] ?? null;
  }
  return { accountId, run, onboarding: onb, queued: entitled, coclaim };
}

async function onboardingOf(db: AccountsDb, userId: bigint): Promise<OnboardingRow | null> {
  const rows = await db.$queryRaw<OnboardingRow[]>(Prisma.sql`SELECT "onboardingStep"::text AS "onboardingStep", onboarded, "onboardedAt",
    "ratingBand"::text AS "ratingBand", "ratingBandSource", "initialRating", goals::text[] AS goals, "dailyMinutes"
    FROM users WHERE id = ${userId}::bigint`);
  return rows[0] ?? null;
}

async function accountView(userId: bigint, provider: ProviderSlug, now: Date): Promise<LinkedAccountView> {
  const linked = await readLinkedAccount(await deps.db(), userId, provider, now);
  if (!linked) throw new DataError("not_found");
  return linked.view;
}

const bucketOf = (n: number | null): string => (n === null ? "unknown" : n === 0 ? "0" : n < 50 ? "1-49" : n < 500 ? "50-499" : "500+");

// ── Chess.com link (ACC-3) ───────────────────────────────────────────────────────────────────────────────────────

export type LinkOutcome = { status: 200 | 201; data: LinkData; effects: LinkEffect[] };

export async function linkChessCom(input: {
  viewer: Pick<Viewer, "id" | "entitlement">;
  profile: ChessComProfile;
  stats: ChessComStats;
  context: "onboarding" | "settings";
  now: Date;
}): Promise<LinkOutcome> {
  const { viewer, profile, stats, context, now } = input;
  const view = profileView(profile);
  const externalId = String(profile.player_id);
  const ratings = buildRatings({ v: 1, ...chessComRatings(stats) });
  const total = ["chess_rapid", "chess_blitz", "chess_bullet", "chess_daily"].reduce((sum, k) => {
    const s = stats[k as "chess_rapid"];
    return sum + (s ? s.record.win + s.record.loss + s.record.draw : 0);
  }, 0);
  const insert: LinkInsert = {
    provider: "CHESSCOM",
    externalId,
    username: view.displayUsername,
    displayName: view.name,
    avatarUrl: view.avatarUrl,
    countryCode: view.countryCode,
    title: view.title,
    joinedAt: view.joinedAt ? new Date(view.joinedAt) : null,
    ratings,
    totalRatedGames: total,
    verified: false,
  };

  const result = await deps.transaction(async (db) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await lockExisting(db, viewer.id, "CHESSCOM");
      if (existing) {
        if (existing.externalId !== externalId) throw conflict("already_linked");
        return { kind: "same" as const, onboarding: context === "onboarding" ? await onboardingOf(db, viewer.id) : null };
      }
      if (await verifiedElsewhere(db, "CHESSCOM", externalId, viewer.id)) throw conflict("linked_elsewhere");
      const created = await createLink(db, viewer, insert, context === "onboarding" ? { step: "LEVEL" } : null, now);
      if (created === "raced") continue; // a concurrent request inserted the row first: re-read it (locked) once
      return { kind: "new" as const, created, coclaim: created.coclaim };
    }
    throw new Error("link: lost the insert race twice");
  });

  const account = await accountView(viewer.id, "chesscom", now);
  if (result.kind === "same") {
    return {
      status: 200,
      data: { account, run: account.run, onboarding: result.onboarding ? toOnboardingView(result.onboarding) : null },
      effects: [{ kind: "revalidate", tag: `chesscom:${insert.username.toLowerCase()}` }],
    };
  }
  const effects: LinkEffect[] = [
    { kind: "dual_write", profile, stats },
    { kind: "audit", action: "account.linked", provider: "chesscom", meta: { verified: false, context } },
    { kind: "revalidate", tag: `chesscom:${insert.username.toLowerCase()}` },
    {
      kind: "event",
      name: "account_linked",
      props: { provider: "chesscom", context, is_verified: false, total_rated_games_bucket: bucketOf(total) },
    },
  ];
  if (result.coclaim) effects.push({ kind: "audit", action: "account.link_coclaim", provider: "chesscom", meta: { verified: false } });
  if (result.created.queued) effects.unshift({ kind: "kick", reason: "import" });
  return {
    status: 201,
    data: {
      account,
      run: toRunView(result.created.run),
      onboarding: result.created.onboarding ? toOnboardingView(result.created.onboarding) : null,
    },
    effects,
  };
}

// ── Lichess link (OAU-2) ─────────────────────────────────────────────────────────────────────────────────────────

export type LichessLinkOutcome =
  | { kind: "linked"; run: RunView | null; importing: number | null; effects: LinkEffect[] }
  | { kind: "conflict"; reason: "linked_elsewhere" | "already_linked" };

export async function linkLichess(input: {
  viewer: Pick<Viewer, "id" | "entitlement">;
  account: LichessAccount;
  ratedCount: number | null;
  countryCode: string | null;
  context: "onboarding" | "settings";
  now: Date;
}): Promise<LichessLinkOutcome> {
  const { viewer, account, context, now } = input;
  const externalId = account.id.toLowerCase();
  const ratings = buildRatings({ v: 1, ...lichessRatings(account.perfs) });
  const insert: LinkInsert = {
    provider: "LICHESS",
    externalId,
    username: account.username.slice(0, 40),
    displayName: null,
    avatarUrl: null,
    countryCode: input.countryCode,
    title: account.title ? account.title.slice(0, 4) : null,
    joinedAt: typeof account.createdAt === "number" ? new Date(account.createdAt) : null,
    ratings,
    totalRatedGames: input.ratedCount,
    verified: true,
  };
  try {
    return await deps.transaction(async (db): Promise<LichessLinkOutcome> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await lockExisting(db, viewer.id, "LICHESS");
        if (existing) {
          if (existing.externalId !== externalId) return { kind: "conflict", reason: "already_linked" };
          await db.$executeRaw(Prisma.sql`UPDATE linked_accounts SET username = ${insert.username}, "usernameLower" = ${insert.username.toLowerCase()},
            ratings = ${JSON.stringify(ratings)}::jsonb, "totalRatedGames" = ${insert.totalRatedGames}::int, title = ${insert.title},
            "countryCode" = ${insert.countryCode}::char(2), "verifiedAt" = COALESCE("verifiedAt", ${UTC(now)}), "updatedAt" = ${UTC(now)}
            WHERE id = ${existing.id}::bigint`);
          if (context === "onboarding") await db.$queryRaw(advanceOnboardingSql(viewer.id, "CONFIRM", null, now));
          return { kind: "linked", run: null, importing: null, effects: [] };
        }
        if (await verifiedElsewhere(db, "LICHESS", externalId, viewer.id)) return { kind: "conflict", reason: "linked_elsewhere" };
        const created = await createLink(db, viewer, insert, context === "onboarding" ? { step: "CONFIRM" } : null, now);
        if (created === "raced") continue;
        const effects: LinkEffect[] = [
          { kind: "audit", action: "account.linked", provider: "lichess", meta: { verified: true, context } },
          {
            kind: "event",
            name: "account_linked",
            props: { provider: "lichess", context, is_verified: true, total_rated_games_bucket: bucketOf(insert.totalRatedGames) },
          },
        ];
        if (created.queued) effects.unshift({ kind: "kick", reason: "import" });
        return { kind: "linked", run: toRunView(created.run), importing: insert.totalRatedGames, effects };
      }
      throw new Error("link: lost the insert race twice");
    });
  } catch (err) {
    // A concurrent verified insert of the same Lichess id by another member (linked_accounts_verified_key).
    if (sqlStateOf(err) === "23505") return { kind: "conflict", reason: "linked_elsewhere" };
    throw err;
  }
}

// ── Sync (ACC-4) and retry (ACC-8) ───────────────────────────────────────────────────────────────────────────────

type SyncAccountRow = { id: bigint; nextAllowedSyncAt: Date | null; status: string };

export async function syncAccount(input: {
  viewer: Pick<Viewer, "id">;
  provider: ProviderSlug;
  now: Date;
}): Promise<{ run: RunView; effects: LinkEffect[] }> {
  const { viewer, provider, now } = input;
  const db0 = await deps.db();
  const rows = await db0.$queryRaw<SyncAccountRow[]>(Prisma.sql`SELECT id, "nextAllowedSyncAt", status::text AS status FROM linked_accounts
    WHERE "userId" = ${viewer.id}::bigint AND provider = ${providerToDb(provider)}::"ChessProvider"`);
  const account = rows[0];
  if (!account) throw new DataError("not_found");
  const nextAllowed = account.nextAllowedSyncAt ? new Date(account.nextAllowedSyncAt) : null;
  if (nextAllowed && nextAllowed.getTime() > now.getTime()) {
    throw new ApiError("rate_limited", {
      retryAfterSec: Math.max(1, Math.ceil((nextAllowed.getTime() - now.getTime()) / 1000)),
      details: { source: provider },
    });
  }
  const accountId = BigInt(account.id);
  const run = await deps.transaction(async (db) => {
    const inserted = await db.$queryRaw<RunInsertRow[]>(
      insertRunSql({ userId: viewer.id, linkedAccountId: accountId, provider: providerToDb(provider), trigger: "MANUAL", status: "QUEUED", now }),
    );
    const r = inserted[0];
    if (!r) throw conflict("sync_running");
    const job = await enqueueImport(db, {
      linkedAccountId: accountId,
      userId: viewer.id,
      runId: BigInt(r.id),
      trigger: "MANUAL",
      priority: JOB_PRIORITY.IMPORT_SYNC_MANUAL,
      runAt: now,
    });
    if (!job) throw conflict("sync_running"); // the job is RUNNING: the transaction rolls the run back
    await db.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "importState" = 'QUEUED', "updatedAt" = ${UTC(now)} WHERE id = ${accountId}::bigint`);
    return r;
  });
  return { run: toRunView(run), effects: [{ kind: "kick", reason: "import" }] };
}

export async function retryRun(input: { viewer: Pick<Viewer, "id">; ref: string; now: Date }): Promise<{ run: RunView; effects: LinkEffect[] }> {
  const { viewer, ref, now } = input;
  try {
    const run = await deps.transaction(async (db) => {
      const updated = await db.$queryRaw<(RunInsertRow & { linkedAccountId: bigint })[]>(Prisma.sql`UPDATE import_runs r
        SET status = 'QUEUED', trigger = 'RETRY', error = NULL, "finishedAt" = NULL, "updatedAt" = ${UTC(now)}
        WHERE r."referenceId" = ${ref} AND r."userId" = ${viewer.id}::bigint AND r.status = 'FAILED'
          AND NOT EXISTS (SELECT 1 FROM import_runs o WHERE o."linkedAccountId" = r."linkedAccountId" AND o.id <> r.id
                            AND o.status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING'))
        RETURNING ${RUN_RETURNING}, "linkedAccountId"`);
      const r = updated[0];
      if (!r) {
        const found = await db.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text AS status FROM import_runs
          WHERE "referenceId" = ${ref} AND "userId" = ${viewer.id}::bigint`);
        if (!found[0]) throw new DataError("not_found");
        throw conflict(found[0].status === "FAILED" ? "sync_running" : "not_failed");
      }
      const job = await enqueueImport(db, {
        linkedAccountId: BigInt(r.linkedAccountId),
        userId: viewer.id,
        runId: BigInt(r.id),
        trigger: "RETRY",
        priority: JOB_PRIORITY.IMPORT_SYNC_MANUAL,
        runAt: now,
      });
      if (!job) throw conflict("sync_running");
      await db.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "importState" = 'QUEUED', "updatedAt" = ${UTC(now)}
        WHERE id = ${BigInt(r.linkedAccountId)}::bigint`);
      return r;
    });
    return { run: toRunView(run), effects: [{ kind: "kick", reason: "import_retry" }] };
  } catch (err) {
    if (sqlStateOf(err) === "23505") throw conflict("sync_running");
    throw err;
  }
}

// ── Auto-import (ACC-5) ──────────────────────────────────────────────────────────────────────────────────────────

export async function setAutoImport(input: {
  viewer: Pick<Viewer, "id">;
  provider: ProviderSlug;
  autoImport: boolean;
  timeZone?: string;
  now: Date;
}): Promise<LinkedAccountView> {
  const { viewer, provider, autoImport, now } = input;
  await deps.transaction(async (db) => {
    const rows = await db.$queryRaw<{ id: bigint; lastSyncOkAt: Date | null; timeZone: string }[]>(Prisma.sql`WITH tz AS (
        UPDATE users SET "timeZone" = COALESCE(${input.timeZone ?? null}::varchar(64), "timeZone")
         WHERE id = ${viewer.id}::bigint RETURNING "timeZone")
      SELECT la.id, la."lastSyncOkAt", (SELECT "timeZone" FROM tz) AS "timeZone"
        FROM linked_accounts la WHERE la."userId" = ${viewer.id}::bigint AND la.provider = ${providerToDb(provider)}::"ChessProvider"
        FOR UPDATE OF la`);
    const row = rows[0];
    if (!row) throw new DataError("not_found");
    const id = BigInt(row.id);
    const next = autoImport ? nextAutoSyncAt(row.timeZone, now, row.lastSyncOkAt ? new Date(row.lastSyncOkAt) : null, id) : null;
    await db.$executeRaw(Prisma.sql`UPDATE linked_accounts SET "autoImport" = ${autoImport}, "nextAutoSyncAt" = ${next ? UTC(next) : null},
      "updatedAt" = ${UTC(now)} WHERE id = ${id}::bigint`);
    const key = importDedupeKey(id);
    if (next) {
      // On: the DAILY job at the next slot, unless a job is already queued or running for the account.
      await enqueueJob(db, {
        kind: "IMPORT_SYNC",
        priority: JOB_PRIORITY.IMPORT_SYNC_DAILY,
        dedupeKey: key,
        userId: viewer.id,
        payload: { v: 1, linkedAccountId: id.toString(), runId: null, trigger: "DAILY" },
        runAt: next,
        maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
        onConflict: "requeue",
        when: Prisma.sql`NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = ${key} AND j.status IN ('QUEUED', 'RUNNING'))`,
      });
    } else {
      await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${key} AND status = 'QUEUED' AND payload->>'trigger' = 'DAILY'`);
    }
  });
  return accountView(viewer.id, provider, now);
}

// ── Unlink (ACC-6) ───────────────────────────────────────────────────────────────────────────────────────────────

export async function unlinkAccount(input: {
  viewer: Pick<Viewer, "id">;
  provider: ProviderSlug;
  deleteGames: boolean;
  now: Date;
}): Promise<{ purge: { games: number } | null; effects: LinkEffect[] }> {
  const { viewer, provider, deleteGames, now } = input;
  const db = providerToDb(provider);
  const purge = await deps.transaction(async (tx) => {
    const existing = await lockExisting(tx, viewer.id, db);
    if (!existing) throw new DataError("not_found");
    await tx.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "dedupeKey" = ${importDedupeKey(existing.id)} AND status = 'QUEUED'`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM linked_accounts WHERE id = ${existing.id}::bigint`);
    if (db === "CHESSCOM") await tx.$executeRaw(Prisma.sql`DELETE FROM chess_com_profiles WHERE "userId" = ${viewer.id}::bigint`);
    if (!deleteGames) return null;
    const counted = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM game_players
      WHERE "userId" = ${viewer.id}::bigint AND source = ${db}::"GameSource"`);
    await enqueueJob(tx, {
      kind: "IMPORT_PURGE",
      priority: JOB_PRIORITY.IMPORT_PURGE,
      dedupeKey: importPurgeDedupeKey(viewer.id, db),
      userId: viewer.id,
      payload: { v: 1, userId: viewer.id.toString(), provider: db, requestedAt: now.toISOString() },
      runAt: now,
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
      onConflict: "requeue",
    });
    return { games: Number(counted[0]?.n ?? 0) };
  });
  const effects: LinkEffect[] = [
    { kind: "audit", action: "account.unlinked", provider, meta: { provider, deleteGames } },
    {
      kind: "event",
      name: "account_unlinked",
      props: { provider, has_delete_games: deleteGames, games_count_bucket: bucketOf(purge?.games ?? null) },
    },
  ];
  if (purge) effects.unshift({ kind: "kick", reason: "import" });
  return { purge, effects };
}

// ── Legacy dual-write (§3: chess_com_profiles stays fresh until P10's profile rebuild) ──────────────────────────

/** The legacy `chess_com_profiles` columns from a profile + stats (the old route's mapping, without `onboarded`). */
export function legacyProfileColumns(profile: ChessComProfile, stats: ChessComStats, now: Date) {
  const pick = (s: ChessComStats["chess_rapid"]) => ({
    rating: s?.last.rating ?? null,
    best: s?.best?.rating ?? null,
    win: s?.record.win ?? null,
    loss: s?.record.loss ?? null,
    draw: s?.record.draw ?? null,
  });
  const r = pick(stats.chess_rapid);
  const b = pick(stats.chess_blitz);
  const u = pick(stats.chess_bullet);
  const d = pick(stats.chess_daily);
  return {
    chessComHandle: profile.username.toLowerCase(),
    displayName: profile.name ?? null,
    avatar: profile.avatar ?? null,
    title: profile.title ?? null,
    country: extractCountryCode(profile.country ?? null),
    status: profile.status ?? null,
    followers: profile.followers ?? null,
    isStreamer: profile.is_streamer ?? false,
    joined: profile.joined ? new Date(profile.joined * 1000) : null,
    rapidRating: r.rating, rapidBestRating: r.best, rapidWins: r.win, rapidLosses: r.loss, rapidDraws: r.draw,
    blitzRating: b.rating, blitzBestRating: b.best, blitzWins: b.win, blitzLosses: b.loss, blitzDraws: b.draw,
    bulletRating: u.rating, bulletBestRating: u.best, bulletWins: u.win, bulletLosses: u.loss, bulletDraws: u.draw,
    dailyRating: d.rating, dailyBestRating: d.best, dailyWins: d.win, dailyLosses: d.loss, dailyDraws: d.draw,
    lastSyncedAt: now,
  };
}
