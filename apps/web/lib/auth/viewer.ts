// The viewer (plan §5.2, §8.2, P1-08): who is signed in, and what they may do, from ONE database statement.
//
//   getViewerRecord()   React cache(): the raw row (users LEFT JOIN chess_com_profiles), provisioning a first-time
//                       user (§8.5). null when signed out, inactive or not provisionable.
//   getViewer()         React cache(): toViewer(record, now, paywall, catalog). What route({ auth }) and server
//                       components read.
//   getRouteViewer()    getViewer() for route(): a user Clerk can't provision → 502 upstream_unavailable.
//   toViewer / toMeData pure mappers (unit-tested; toMeData is also what lib/shell/shell-user.test.ts compares with
//                       the shell's banner state).
//
// Why $queryRaw and not `relationLoadStrategy: "join"`: see plan §5.2 (the relationJoins preview flag would change
// every query in the app). The column list is VIEWER_COLUMNS; viewer.test.ts checks it against VIEWER_SELECT (the
// Prisma select the provisioning re-read uses) and viewer.int.test.ts runs the statement on Postgres.
//
// Importable from plain Node (tests): Prisma, Clerk, next/* and the server-only product catalog load lazily.
import { accountName } from "@/lib/onboarding/display-name";
import { cache } from "react";
import type { Entitlement, MeAccount, MeData, MeImport, MeUser } from "@repo/contracts/http/me";
import type { Badges } from "@repo/contracts/http/train";
import {
  providerFromDb,
  toWire,
  type OnboardingGoalDb,
  type OnboardingStepDb,
  type ProviderDb,
  type RatingBandDb,
} from "@repo/contracts/http/p04-plain";
import { linkViewStatus, type ImportStateDb, type LinkStatusDb } from "../accounts/view-status";
import type { EntitlementSummary } from "../billing/entitlement-rules";
import { ApiError } from "../api/api-error";
import { requestNow } from "../api/now";
import { exemptWrites } from "../api/timing";
import type { ShellUserRecord } from "../shell/shell-user";
import { badgeFactsSql, badgesFrom } from "../train/badges.server";
import { isPaywallEnabled, membershipOf, type BillingFacts, type MembershipOptions } from "./membership";
import type { ProvisionFailure } from "./provision-user";
import { meDataOf, toMeUser } from "./viewer-dto";

/** Mirrors ENTITLEMENT_SELECT (lib/billing/entitlement.ts); viewer.test.ts checks the two agree. */
export const ENTITLEMENT_COLUMNS = [
  "plan",
  "planInterval",
  "subscriptionId",
  "subscriptionStatus",
  "subscriptionProductId",
  "currentPeriodEnd",
  "cancelAtPeriodEnd",
  "subscriptionUpdatedAt",
  "trialStartedAt",
  "trialEndsAt",
] as const;

/** P4 onboarding columns of the viewer row (phase-04 plan §7.2 `GET /api/me`, interface-check §0.10). */
export const ONBOARDING_COLUMNS = [
  "onboardingStep",
  "onboardedAt",
  "ratingBand",
  "ratingBandSource",
  "initialRating",
  "goals",
  "dailyMinutes",
  "timeZone",
  "pendingCheckoutAt",
] as const;

/** The users columns of the one viewer statement (plan §8.2). */
export const VIEWER_COLUMNS = [
  "id",
  "referenceId",
  "code",
  "googleId",
  "email",
  "name",
  "profilePictureUrl",
  "role",
  "isActive",
  "onboarded",
  "dodoCustomerId",
  "subscriptionSourceAt",
  "gamesVersion",
  ...ENTITLEMENT_COLUMNS,
  // P4 (phase-04 plan §7.2, R-03): onboarding v3, the member's zone and the pending checkout (WP-C owns these lines).
  ...ONBOARDING_COLUMNS,
] as const;

export type ViewerColumn = (typeof VIEWER_COLUMNS)[number];

/** The same columns as a Prisma `select` (provisioning re-read by id). Must equal VIEWER_COLUMNS (viewer.test.ts). */
export const VIEWER_SELECT = {
  id: true,
  referenceId: true,
  code: true,
  googleId: true,
  email: true,
  name: true,
  profilePictureUrl: true,
  role: true,
  isActive: true,
  onboarded: true,
  dodoCustomerId: true,
  subscriptionSourceAt: true,
  gamesVersion: true,
  plan: true,
  planInterval: true,
  subscriptionId: true,
  subscriptionStatus: true,
  subscriptionProductId: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  subscriptionUpdatedAt: true,
  trialStartedAt: true,
  trialEndsAt: true,
  onboardingStep: true,
  onboardedAt: true,
  ratingBand: true,
  ratingBandSource: true,
  initialRating: true,
  goals: true,
  dailyMinutes: true,
  timeZone: true,
  pendingCheckoutAt: true,
} as const satisfies Record<ViewerColumn, true>;

/** One row of the viewer statement. */
export type ViewerRecord = {
  id: bigint;
  referenceId: string;
  code: string;
  googleId: string;
  email: string;
  name: string;
  profilePictureUrl: string | null;
  /** Prisma `Role` ("USER" | "ADMIN"). */
  role: string;
  isActive: boolean;
  onboarded: boolean;
  dodoCustomerId: string | null;
  subscriptionSourceAt: Date | null;
  gamesVersion: number;
  plan: string | null;
  planInterval: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionProductId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  subscriptionUpdatedAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /** P4: `OnboardingStep` (DB spelling). */
  onboardingStep: OnboardingStepDb;
  onboardedAt: Date | null;
  ratingBand: RatingBandDb | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  /** `OnboardingGoal[]` (DB spelling), cast to text[] in the statement. */
  goals: OnboardingGoalDb[];
  dailyMinutes: number | null;
  /** IANA zone, default "UTC" (R-03). */
  timeZone: string;
  pendingCheckoutAt: Date | null;
  /** chess_com_profiles (LEFT JOIN): null without a linked profile. */
  blitzRating: number | null;
  rapidRating: number | null;
  /** P4: the member's linked accounts (≤ 2, link order) and the active / last-24-h import run (LATERAL joins). */
  linkedAccounts: ViewerLinkedAccount[];
  importRun: ViewerImportRun | null;
  /**
   * P5 (phase-05 §7.3 R8, interface check §0.13): the nav badge facts (due BANK cards, the cap inputs, the latest
   * training_days row) as one json scalar of the same statement. Optional so hand-built records need not carry it.
   */
  badgeFacts?: unknown;
};

/** One linked account of the viewer row (the `MeAccount` source). */
export type ViewerLinkedAccount = {
  provider: ProviderDb;
  username: string;
  status: LinkStatusDb;
  importState: ImportStateDb;
  lastSyncAt: Date | null;
  nextAllowedSyncAt: Date | null;
  /** The trial-ledger key (plan 8.4.3; FIX-1). Optional so hand-built records need not carry it. */
  usernameLower?: string;
  /** verifiedAt IS NOT NULL: only verified handles can deny a trial (D4-10). */
  verified?: boolean;
};

/** The viewer's active import run, or one finished in the last 24 h (the `MeImport` source). */
export type ViewerImportRun = {
  referenceId: string;
  provider: ProviderDb;
  status: "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  phase: string | null;
  imported: number;
  total: number | null;
};

/** The non-column fields of a ViewerRecord (joins). */
type ViewerJoinField = "blitzRating" | "rapidRating" | "linkedAccounts" | "importRun" | "badgeFacts";

// Compile-time: ViewerRecord has exactly the statement's columns.
type _RecordMatchesColumns = [Exclude<keyof ViewerRecord, ViewerColumn | ViewerJoinField>, Exclude<ViewerColumn, keyof ViewerRecord>];
const _recordMatchesColumns: _RecordMatchesColumns extends [never, never] ? true : false = true;
void _recordMatchesColumns;

/** Column expressions that need a cast to come back as plain JS values through $queryRawUnsafe. */
const COLUMN_EXPR: Partial<Record<ViewerColumn, string>> = {
  onboardingStep: `u."onboardingStep"::text AS "onboardingStep"`,
  ratingBand: `u."ratingBand"::text AS "ratingBand"`,
  goals: `u.goals::text[] AS goals`,
};

/** UTC `timestamp(3)` as an ISO string inside json_build_object (the column type carries no zone). */
const isoJson = (col: string) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Run statuses that hold an account's one active slot (import_runs_one_active). */
const ACTIVE_RUN_SQL = `('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING')`;

/**
 * The one statement (plan §5.2; P4 §7.2). Column names are compile-time constants; the only input is the bound
 * parameter $1 (the Clerk user id, or the users.id for the provisioning re-read), so $queryRawUnsafe here carries no
 * injection surface. P4 adds two LATERAL joins and stays one round trip: the ≤ 2 linked accounts as one json_agg
 * (linked_accounts_userId_provider_key) and the newest active-or-recent import run with LIMIT 1
 * (import_runs_userId_createdAt_idx). P5 adds the badge facts as one scalar subquery (training_cards_userId_deck_due_idx,
 * training_profiles_pkey, training_days_pkey; lib/train/badges.server.ts), still one round trip with the one bound
 * parameter: its due comparison reads the database clock, while the local day the cap counters belong to is taken in
 * TS from the request clock (`toViewer`'s `now`). `GET /api/me/badges` (R8) runs the same facts at `ctx.now`.
 */
function viewerSql(where: string): string {
  return (
    `SELECT ${VIEWER_COLUMNS.map((c) => COLUMN_EXPR[c] ?? `u."${c}"`).join(", ")}, c."blitzRating", c."rapidRating", ` +
    `COALESCE(la.accounts, '[]'::json) AS "linkedAccounts", ` +
    `ir."referenceId" AS "importRef", ir.provider::text AS "importProvider", ir.status::text AS "importStatus", ` +
    `ir.phase AS "importPhase", ir.imported AS "importImported", ir.total AS "importTotal", ` +
    `${badgeFactsSql("u.id", "(now() AT TIME ZONE 'UTC')")} AS "badgeFacts" ` +
    `FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id ` +
    `LEFT JOIN LATERAL (SELECT json_agg(json_build_object('provider', l.provider::text, 'username', l.username, ` +
    `'status', l.status::text, 'importState', l."importState"::text, 'lastSyncAt', ${isoJson(`l."lastSyncAt"`)}, ` +
    `'nextAllowedSyncAt', ${isoJson(`l."nextAllowedSyncAt"`)}, 'usernameLower', l."usernameLower", ` +
    `'verified', (l."verifiedAt" IS NOT NULL)) ORDER BY l."linkedAt", l.id) AS accounts ` +
    `FROM linked_accounts l WHERE l."userId" = u.id) la ON true ` +
    `LEFT JOIN LATERAL (SELECT r."referenceId", r.provider, r.status, r.phase, r.imported, r.total FROM import_runs r ` +
    `WHERE r."userId" = u.id AND (r.status IN ${ACTIVE_RUN_SQL} OR r."finishedAt" > (now() AT TIME ZONE 'UTC') - interval '1 day') ` +
    `ORDER BY r."createdAt" DESC LIMIT 1) ir ON true ` +
    `WHERE ${where} LIMIT 1`
  );
}

export const VIEWER_SQL = viewerSql(`u."googleId" = $1`);
/** The same statement by users.id (the provisioning re-read). */
export const VIEWER_BY_ID_SQL = viewerSql(`u.id = $1::bigint`);

/** The raw row of VIEWER_SQL before the joins are folded into the record. */
type ViewerRow = Omit<ViewerRecord, "linkedAccounts" | "importRun"> & {
  linkedAccounts: unknown;
  importRef: string | null;
  importProvider: ProviderDb | null;
  importStatus: ViewerImportRun["status"] | null;
  importPhase: string | null;
  importImported: number | null;
  importTotal: number | null;
};

const dateOrNull = (v: unknown): Date | null => (typeof v === "string" || v instanceof Date ? new Date(v) : null);

/** Folds the LATERAL columns into the record (the json accounts get Date timestamps). */
export function recordOfRow(row: ViewerRow): ViewerRecord {
  const { linkedAccounts, importRef, importProvider, importStatus, importPhase, importImported, importTotal, ...rest } = row;
  const accounts = Array.isArray(linkedAccounts) ? (linkedAccounts as Record<string, unknown>[]) : [];
  return {
    ...rest,
    goals: Array.isArray(rest.goals) ? rest.goals : [],
    linkedAccounts: accounts.map((a) => ({
      provider: a.provider as ProviderDb,
      username: String(a.username),
      status: a.status as LinkStatusDb,
      importState: a.importState as ImportStateDb,
      lastSyncAt: dateOrNull(a.lastSyncAt),
      nextAllowedSyncAt: dateOrNull(a.nextAllowedSyncAt),
      ...(typeof a.usernameLower === "string" ? { usernameLower: a.usernameLower } : {}),
      ...(typeof a.verified === "boolean" ? { verified: a.verified } : {}),
    })),
    importRun:
      importRef && importProvider && importStatus
        ? {
            referenceId: importRef,
            provider: importProvider,
            status: importStatus,
            phase: importPhase,
            imported: Number(importImported ?? 0),
            total: importTotal === null || importTotal === undefined ? null : Number(importTotal),
          }
        : null,
  };
}

/** The Prisma surface the viewer reads use (the real client, or a test fake). */
export type ViewerDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

/** Runs VIEWER_SQL. */
export async function queryViewerRecord(db: Pick<ViewerDb, "$queryRawUnsafe">, googleId: string): Promise<ViewerRecord | null> {
  const rows = await db.$queryRawUnsafe<ViewerRow[]>(VIEWER_SQL, googleId);
  return rows[0] ? recordOfRow(rows[0]) : null;
}

/**
 * The same row by users.id, for the re-read right after provisioning (VIEWER_BY_ID_SQL: the same statement, so the
 * joins cannot drift from the googleId read). The id travels as a decimal string (`$1::bigint`).
 */
export async function readViewerRecordById(db: Pick<ViewerDb, "$queryRawUnsafe">, id: bigint): Promise<ViewerRecord | null> {
  const rows = await db.$queryRawUnsafe<ViewerRow[]>(VIEWER_BY_ID_SQL, id.toString());
  return rows[0] ? recordOfRow(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Pure mappers

export type Viewer = {
  /** users.id (server-only; never serialised). */
  id: bigint;
  /** users.referenceId */
  ref: string;
  clerkUserId: string;
  role: "user" | "admin";
  /** MeData.user */
  user: MeUser;
  /** MeData.entitlement */
  entitlement: Entitlement;
  /** Server-side billing facts (reason derivation, billing refresh, the legacy subscription body). Never sent as is. */
  billing: BillingFacts & {
    email: string;
    dodoCustomerId: string | null;
    subscriptionId: string | null;
    subscriptionProductId: string | null;
    summary: EntitlementSummary;
  };
  /** M1: bumped by every write that changes the member's game list (P3 archive ETag). */
  gamesVersion: number;
  /**
   * P4 (phase-04 §7.2): the onboarding row, the linked accounts (wire `MeAccount`) and the active / recent run (wire
   * `MeImport`). Always set by toViewer(); optional so hand-built viewers (tests, fixtures) need not carry them.
   */
  onboarding?: ViewerOnboarding;
  accounts?: MeAccount[];
  importRun?: MeImport | null;
  /**
   * Server-only (never serialised): the VERIFIED linked handles, the trial ledger's handle keys (plan 8.4.3). Read by
   * lib/billing/trial-eligibility.ts so `trial.eligible` can consult the ledger without another linked-accounts read.
   */
  ledgerHandles?: { provider: "chesscom" | "lichess"; usernameLower: string; verified: true }[];
  /** P5 (phase-05 §7.3 R8): the nav badges at the request clock, from the viewer statement. */
  badges?: Badges;
};

/** The onboarding columns as the server reads them (DB spellings; the wire view is `MeData.onboarding`). */
export type ViewerOnboarding = {
  step: OnboardingStepDb;
  onboarded: boolean;
  onboardedAt: Date | null;
  ratingBand: RatingBandDb | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: OnboardingGoalDb[];
  dailyMinutes: number | null;
  timeZone: string;
  pendingCheckoutAt: Date | null;
};

/** The record fields toViewer reads (a ViewerRecord; tests pass partial shell records too). */
export type ViewerSource = Omit<
  ViewerRecord,
  "id" | "googleId" | "isActive" | "subscriptionSourceAt" | "gamesVersion" | P4RecordField
> &
  Partial<Pick<ViewerRecord, "id" | "googleId" | "isActive" | "subscriptionSourceAt" | "gamesVersion" | P4RecordField>>;

/** P4 record fields: optional in a ViewerSource so P1's shell records (no onboarding columns) still map. */
type P4RecordField = (typeof ONBOARDING_COLUMNS)[number] | "linkedAccounts" | "importRun";

/** The P4 viewer fields of a record (defaults for a P1 shell record without the columns). */
export function p4ViewerFields(record: ViewerSource, now: Date): Pick<Viewer, "onboarding" | "accounts" | "importRun" | "ledgerHandles"> {
  const onboarding: ViewerOnboarding = {
    step: record.onboardingStep ?? (record.onboarded ? "DONE" : "WELCOME"),
    onboarded: Boolean(record.onboarded),
    onboardedAt: record.onboardedAt ?? null,
    ratingBand: record.ratingBand ?? null,
    ratingBandSource: record.ratingBandSource ?? null,
    initialRating: record.initialRating ?? null,
    goals: record.goals ?? [],
    dailyMinutes: record.dailyMinutes ?? null,
    timeZone: record.timeZone ?? "UTC",
    pendingCheckoutAt: record.pendingCheckoutAt ?? null,
  };
  const accounts: MeAccount[] = (record.linkedAccounts ?? []).slice(0, 2).map((a) => ({
    provider: providerFromDb(a.provider),
    username: a.username,
    status: linkViewStatus(a, now),
    lastSyncAt: a.lastSyncAt ? a.lastSyncAt.toISOString() : null,
  }));
  const r = record.importRun ?? null;
  const importRun: MeImport | null = r
    ? {
        ref: r.referenceId,
        provider: providerFromDb(r.provider),
        status: toWire(r.status),
        phase: r.phase === "reading" || r.phase === "saving" ? r.phase : null,
        imported: r.imported,
        total: r.total,
      }
    : null;
  const ledgerHandles = (record.linkedAccounts ?? [])
    .filter((a) => a.verified === true && typeof a.usernameLower === "string")
    .map((a) => ({ provider: providerFromDb(a.provider), usernameLower: a.usernameLower!, verified: true as const }));
  return { onboarding, accounts, importRun, ledgerHandles };
}

export function toViewer(record: ViewerSource, options: MembershipOptions): Viewer {
  const { entitlement, summary, billing } = membershipOf(record, options);
  return {
    id: record.id as bigint,
    ref: record.referenceId,
    clerkUserId: record.googleId ?? "",
    role: record.role === "ADMIN" ? "admin" : "user",
    user: toMeUser(record),
    entitlement,
    billing: {
      ...billing,
      email: record.email,
      dodoCustomerId: record.dodoCustomerId,
      subscriptionId: record.subscriptionId,
      subscriptionProductId: record.subscriptionProductId,
      summary,
    },
    gamesVersion: record.gamesVersion ?? 0,
    ...p4ViewerFields(record, options.now),
    ...(record.badgeFacts !== undefined ? { badges: badgesFrom(record.badgeFacts, record.timeZone ?? "UTC", options.now) } : {}),
  };
}

export type MeDataOptions = MembershipOptions & { flags: Record<string, boolean>; buildId: string };

/** MeData for a record (plan §7.3). GET /api/me builds it from the request's Viewer with meDataOf(). */
export function toMeData(record: ViewerSource, options: MeDataOptions): MeData {
  return meDataOf(toViewer(record, options), options.flags, options.buildId);
}

/** The shell's record shape (lib/shell/shell-user.ts) from a ViewerRecord, for 1B·J's getShellSession swap. */
export function toShellUserRecord(record: ViewerRecord): ShellUserRecord {
  return {
    referenceId: record.referenceId,
    // §8.13 (D5): never Clerk's "Anonymous User" placeholder or an email +tag in the shell.
    name: accountName({ name: record.name, email: record.email }),
    profilePictureUrl: record.profilePictureUrl,
    role: record.role,
    dodoCustomerId: record.dodoCustomerId,
    plan: record.plan,
    planInterval: record.planInterval,
    subscriptionId: record.subscriptionId,
    subscriptionStatus: record.subscriptionStatus,
    subscriptionProductId: record.subscriptionProductId,
    currentPeriodEnd: record.currentPeriodEnd,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
    subscriptionUpdatedAt: record.subscriptionUpdatedAt,
    trialStartedAt: record.trialStartedAt,
    trialEndsAt: record.trialEndsAt,
    chessComProfile:
      record.blitzRating === null && record.rapidRating === null
        ? null
        : { blitzRating: record.blitzRating, rapidRating: record.rapidRating },
  };
}

// ---------------------------------------------------------------------------
// Per-request loaders (React cache())

export type ViewerLookup =
  | { status: "ok"; record: ViewerRecord }
  | { status: "signed_out" }
  | { status: "inactive" }
  | { status: "unprovisioned"; reason: ProvisionFailure };

/** Writes the Clerk claims for a row the request path just created or relinked (after the response). */
async function scheduleClaimsSync(userId: bigint): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      const { syncClerkClaims } = await import("./claims");
      await syncClerkClaims(userId);
    });
  } catch {
    // Outside a request scope (scripts): the next billing write or the backfill syncs the claims.
  }
}

/** Clerk session → one statement → (first sign-in only) provisioning + one re-read. */
export const lookupViewer = cache(async (): Promise<ViewerLookup> => {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return { status: "signed_out" };

  const { prisma } = await import("@/lib/prisma");
  let record = await queryViewerRecord(prisma, userId);
  if (!record) {
    const { provisionUser } = await import("./provision-user");
    // Identity provisioning is part of resolving the session (like the limiter's upsert), not a handler write: it
    // must not trip GET purity on routes that don't declare it (/api/me declares provision_user).
    const result = await exemptWrites(() => provisionUser(userId));
    if (result.status !== "ok") return { status: "unprovisioned", reason: result.status };
    record = await readViewerRecordById(prisma, result.userId);
    if (!record) return { status: "unprovisioned", reason: "clerk_user_missing" };
    if (result.created || result.relinked) await scheduleClaimsSync(result.userId);
  }
  if (!record.isActive) return { status: "inactive" };
  return { status: "ok", record };
});

/** The raw viewer row, or null (signed out, inactive, or Clerk could not provision the user). */
export const getViewerRecord = cache(async (): Promise<ViewerRecord | null> => {
  const lookup = await lookupViewer();
  return lookup.status === "ok" ? lookup.record : null;
});

/** now (x-rc-now aware), the paywall switch and the env's product catalog. */
export async function viewerOptions(): Promise<MembershipOptions> {
  const [{ getProductCatalog }, now] = await Promise.all([import("../billing/products"), requestNow()]);
  return { now, paywallEnabled: isPaywallEnabled(), catalog: getProductCatalog() };
}

/** The signed-in viewer for this request, or null. Never throws for an unprovisionable user (marketing chrome). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const record = await getViewerRecord();
  return record ? toViewer(record, await viewerOptions()) : null;
});

/**
 * route()'s viewer loader (lib/api/context.ts): getViewer(), except that a signed-in user Clerk can't provision
 * (no verified email, Clerk unreachable) is a 502 `upstream_unavailable { provider: "clerk", kind }`, not a 401.
 */
export async function getRouteViewer(): Promise<Viewer | null> {
  const lookup = await lookupViewer();
  if (lookup.status === "unprovisioned") {
    throw new ApiError("upstream_unavailable", { details: { provider: "clerk", kind: lookup.reason } });
  }
  return getViewer();
}
