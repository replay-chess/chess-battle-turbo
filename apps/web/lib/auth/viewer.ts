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
import { cache } from "react";
import type { Entitlement, MeData, MeUser } from "@repo/contracts/http/me";
import type { EntitlementSummary } from "../billing/entitlement-rules";
import { ApiError } from "../api/api-error";
import { requestNow } from "../api/now";
import { exemptWrites } from "../api/timing";
import type { ShellUserRecord } from "../shell/shell-user";
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
  /** chess_com_profiles (LEFT JOIN): null without a linked profile. */
  blitzRating: number | null;
  rapidRating: number | null;
};

// Compile-time: ViewerRecord has exactly the statement's columns.
type _RecordMatchesColumns = [Exclude<keyof ViewerRecord, ViewerColumn | "blitzRating" | "rapidRating">, Exclude<ViewerColumn, keyof ViewerRecord>];
const _recordMatchesColumns: _RecordMatchesColumns extends [never, never] ? true : false = true;
void _recordMatchesColumns;

/**
 * The one statement (plan §5.2). Column names are compile-time constants; the only input is the bound parameter $1
 * (the Clerk user id), so $queryRawUnsafe here carries no injection surface.
 */
export const VIEWER_SQL =
  `SELECT ${VIEWER_COLUMNS.map((c) => `u."${c}"`).join(", ")}, c."blitzRating", c."rapidRating" ` +
  `FROM users u LEFT JOIN chess_com_profiles c ON c."userId" = u.id ` +
  `WHERE u."googleId" = $1 LIMIT 1`;

/** The Prisma surface the viewer reads use (the real client, or a test fake). */
export type ViewerDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  user: {
    findUnique(args: {
      where: { id: bigint };
      select: typeof VIEWER_SELECT & { chessComProfile: { select: { blitzRating: true; rapidRating: true } } };
    }): Promise<(Omit<ViewerRecord, "blitzRating" | "rapidRating"> & { chessComProfile: { blitzRating: number | null; rapidRating: number | null } | null }) | null>;
  };
};

/** Runs VIEWER_SQL. */
export async function queryViewerRecord(db: Pick<ViewerDb, "$queryRawUnsafe">, googleId: string): Promise<ViewerRecord | null> {
  const rows = await db.$queryRawUnsafe<ViewerRecord[]>(VIEWER_SQL, googleId);
  return rows[0] ?? null;
}

/** The same row by users.id through Prisma (VIEWER_SELECT), for the re-read right after provisioning. */
export async function readViewerRecordById(db: Pick<ViewerDb, "user">, id: bigint): Promise<ViewerRecord | null> {
  const row = await db.user.findUnique({
    where: { id },
    select: { ...VIEWER_SELECT, chessComProfile: { select: { blitzRating: true, rapidRating: true } } },
  });
  if (!row) return null;
  const { chessComProfile, ...rest } = row;
  return { ...rest, blitzRating: chessComProfile?.blitzRating ?? null, rapidRating: chessComProfile?.rapidRating ?? null };
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
};

/** The record fields toViewer reads (a ViewerRecord; tests pass partial shell records too). */
export type ViewerSource = Omit<ViewerRecord, "id" | "googleId" | "isActive" | "subscriptionSourceAt" | "gamesVersion"> &
  Partial<Pick<ViewerRecord, "id" | "googleId" | "isActive" | "subscriptionSourceAt" | "gamesVersion">>;

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
    name: record.name,
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
    record = await readViewerRecordById(prisma as unknown as Pick<ViewerDb, "user">, result.userId);
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
