// The onboarding DAL (phase-04 plan §5.1 `getOnboardingState`, §7.2 ME-4, §8.1). Server code only (Prisma,
// next/headers); like lib/data/accounts.ts it carries no `server-only` marker, because the ME-4 route imports it and
// the route contract tests (test/api/contract.test.ts) load every route module in plain Node.
//
// - getOnboardingState(viewer): React cache() per request. ONE statement: the user's onboarding columns plus a
//   json_agg lateral over linked_accounts (≤ 2 rows, PK-prefix index `linked_accounts_userId_provider_key`). The
//   step pages, the resolver and the Level suggestion read it; the viewer row stays as P1 built it (the onboarding
//   fields of /api/me are WP-C's, interface-check §0.10).
// - toOnbViewer(): the resolver's input (lib/onboarding/resolve.ts) from the viewer + this row + the destination.
// - patchOnboardingSql() / completeOnboardingSql(): the ME-4 statements. The step is monotonic (array_position on the
//   DB order), so a retried, reordered or replayed PATCH is harmless, and a write whose response was lost can simply
//   be sent again. Timestamps are `timestamp(3)` holding UTC: `(now() AT TIME ZONE 'UTC')`, never bare now().
import { cache } from "react";
import { Prisma } from "@repo/db";
import type { OnboardingView } from "@repo/contracts/http/onboarding";
import {
  DAILY_MINUTES,
  type DailyMinutes,
  type OnboardingGoalDb,
  type OnboardingStepDb,
  type RatingBandDb,
} from "@repo/contracts/http/p04-plain";
import { parseRatings } from "@repo/db/json";
import { redirect } from "next/navigation";
import { requestNow } from "@/lib/api/now";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { rawDb } from "@/lib/games/snapshot.server";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { NEXT_COOKIE, readNextCookie, safeNextPath } from "@/lib/onboarding/guard";
import { guardStep, type OnbViewer, type StepQuery } from "@/lib/onboarding/resolve";
import { parseBandSource, suggestBand, type BandSuggestion, type RatingsLike, type SuggestProvider } from "@/lib/onboarding/suggest-band";
import { ORDER, isOnbPage, isOnbStep, stepPath, type OnbPage } from "@/lib/onboarding/steps";

export type LinkedAccountRow = {
  provider: "CHESSCOM" | "LICHESS";
  username: string;
  status: "ACTIVE" | "ERROR" | "RELINK_REQUIRED";
  ratings: RatingsLike | null;
  totalRatedGames: number | null;
  verified: boolean;
};

/** The onboarding columns of the viewer's row and their links (oldest link first). */
export type OnboardingState = {
  step: OnboardingStepDb;
  onboarded: boolean;
  onboardedAt: Date | null;
  ratingBand: RatingBandDb | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: OnboardingGoalDb[];
  dailyMinutes: DailyMinutes | null;
  timeZone: string;
  pendingCheckoutAt: Date | null;
  accounts: LinkedAccountRow[];
};

/** The raw row (Postgres enums cast to text; the lateral's JSON as Postgres returns it). */
export type OnboardingStateRow = {
  onboardingStep: string;
  onboarded: boolean;
  onboardedAt: Date | null;
  ratingBand: string | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: string[] | null;
  dailyMinutes: number | null;
  timeZone: string;
  pendingCheckoutAt: Date | null;
  accounts: unknown;
};

const STATE_COLUMNS = Prisma.sql`
  u."onboardingStep"::text AS "onboardingStep", u.onboarded, u."onboardedAt", u."ratingBand"::text AS "ratingBand",
  u."ratingBandSource", u."initialRating", u.goals::text[] AS goals, u."dailyMinutes", u."timeZone", u."pendingCheckoutAt"`;

/** The one read (exported for the explain gate and the integration test). */
export function onboardingStateSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`
SELECT ${STATE_COLUMNS},
  COALESCE(a.accounts, '[]'::json) AS accounts
FROM users u
LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(
           'provider', l.provider, 'username', l.username, 'status', l.status, 'ratings', l.ratings,
           'totalRatedGames', l."totalRatedGames", 'verified', l."verifiedAt" IS NOT NULL
         ) ORDER BY l."linkedAt", l.id) AS accounts
  FROM linked_accounts l
  WHERE l."userId" = u.id
) a ON true
WHERE u.id = ${userId}`;
}

const isDailyMinutes = (n: unknown): n is DailyMinutes => (DAILY_MINUTES as readonly unknown[]).includes(n);
const GOALS_DB = new Set<string>(["STOP_BLUNDERING", "LEARN_OPENINGS", "IMPROVE_ENDGAMES", "STUDY_LEGENDS", "PLAY_FRIENDS"]);
const BANDS_DB = new Set<string>(["NEW_TO_CHESS", "UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"]);

function ratingsOf(value: unknown): RatingsLike | null {
  if (value === null || value === undefined) return null;
  const r = parseRatings(value);
  const out: RatingsLike = {};
  for (const tc of ["bullet", "blitz", "rapid", "daily", "classical"] as const) {
    const e = r[tc];
    if (e) out[tc] = { rating: e.rating, games: e.games };
  }
  return out;
}

function accountsOf(value: unknown): LinkedAccountRow[] {
  const list = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  const out: LinkedAccountRow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    if (a.provider !== "CHESSCOM" && a.provider !== "LICHESS") continue;
    if (typeof a.username !== "string") continue;
    const status = a.status === "ERROR" || a.status === "RELINK_REQUIRED" ? a.status : "ACTIVE";
    out.push({
      provider: a.provider,
      username: a.username,
      status,
      ratings: ratingsOf(a.ratings),
      totalRatedGames: typeof a.totalRatedGames === "number" ? a.totalRatedGames : null,
      verified: a.verified === true,
    });
  }
  return out;
}

/** Row → state; unknown enum values (a newer DB) read as the safest value. */
export function toOnboardingState(row: OnboardingStateRow): OnboardingState {
  return {
    step: isOnbStep(row.onboardingStep) ? row.onboardingStep : "WELCOME",
    onboarded: row.onboarded,
    onboardedAt: row.onboardedAt,
    ratingBand: row.ratingBand && BANDS_DB.has(row.ratingBand) ? (row.ratingBand as RatingBandDb) : null,
    ratingBandSource: row.ratingBandSource,
    initialRating: row.initialRating,
    goals: (row.goals ?? []).filter((g): g is OnboardingGoalDb => GOALS_DB.has(g)),
    dailyMinutes: isDailyMinutes(row.dailyMinutes) ? row.dailyMinutes : null,
    timeZone: row.timeZone || "UTC",
    pendingCheckoutAt: row.pendingCheckoutAt,
    accounts: accountsOf(row.accounts),
  };
}

/** The viewer's onboarding state (one statement per request). Null when the row is gone (deleted mid-request). */
export const getOnboardingState = cache(async (viewer: Pick<Viewer, "id">): Promise<OnboardingState | null> => {
  // rawDb: Next bundles @repo/db apart from the client lib/prisma extends; a foreign Prisma.Sql must go through
  // $queryRawUnsafe (lib/games/snapshot.server.ts).
  const rows = await rawDb(prisma).$queryRaw<OnboardingStateRow[]>(onboardingStateSql(viewer.id));
  return rows[0] ? toOnboardingState(rows[0]) : null;
});

/** The resolver's input. */
export function toOnbViewer(
  viewer: Pick<Viewer, "role" | "entitlement">,
  state: OnboardingState,
  next: string | null,
): OnbViewer {
  const active = state.accounts.filter((a) => a.status === "ACTIVE");
  return {
    step: state.step,
    onboardingDone: state.onboarded,
    entitled: viewer.entitlement.entitled,
    isAdmin: viewer.role === "admin",
    paywallOn: viewer.entitlement.paywall,
    hasActiveLink: active.length > 0,
    lichessLinked: active.some((a) => a.provider === "LICHESS"),
    pendingCheckoutAt: state.pendingCheckoutAt ? state.pendingCheckoutAt.getTime() : null,
    checkoutReported: viewer.entitlement.status === "pending" || viewer.entitlement.status === "on_hold",
    next,
  };
}

/** OnboardingView (wire, lowercase enums, D4-25) of a state or of a PATCH's RETURNING row. */
export function onboardingViewOf(s: Pick<OnboardingState, "step" | "onboarded" | "onboardedAt" | "ratingBand" | "ratingBandSource" | "initialRating" | "goals" | "dailyMinutes">): OnboardingView {
  return {
    step: s.step.toLowerCase() as OnboardingView["step"],
    done: s.onboarded,
    ratingBand: s.ratingBand ? (s.ratingBand.toLowerCase() as NonNullable<OnboardingView["ratingBand"]>) : null,
    ratingBandSource: s.ratingBandSource,
    initialRating: s.initialRating,
    goals: s.goals.map((g) => g.toLowerCase() as OnboardingView["goals"][number]),
    dailyMinutes: s.dailyMinutes,
    onboardedAt: s.onboardedAt ? s.onboardedAt.toISOString() : null,
  };
}

// ── ME-4 writes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A PATCH in DB spelling (the route maps the wire body with fromWire()). Absent = unchanged. */
export type OnboardingPatch = {
  step?: Exclude<OnboardingStepDb, "DONE">;
  /** null clears the band; undefined leaves it. */
  ratingBand?: RatingBandDb | null;
  ratingBandSource?: string;
  initialRating?: number;
  goals?: OnboardingGoalDb[];
  dailyMinutes?: DailyMinutes;
  timeZone?: string;
};

const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

const RETURNING = Prisma.sql`
RETURNING "onboardingStep"::text AS "onboardingStep", onboarded, "onboardedAt", "ratingBand"::text AS "ratingBand",
  "ratingBandSource", "initialRating", goals::text[] AS goals, "dailyMinutes", "timeZone"`;

/** The monotonic step write (§7.2): one UPDATE … RETURNING. */
export function patchOnboardingSql(userId: bigint, patch: OnboardingPatch): Prisma.Sql {
  const hasBand = patch.ratingBand !== undefined;
  return Prisma.sql`
UPDATE users SET
  "onboardingStep" = CASE
      WHEN ${patch.step ?? null}::text IS NOT NULL
       AND array_position(${[...ORDER]}::text[], ${patch.step ?? null}::text) > array_position(${[...ORDER]}::text[], "onboardingStep"::text)
      THEN ${patch.step ?? null}::text::"OnboardingStep" ELSE "onboardingStep" END,
  "ratingBand"       = CASE WHEN ${hasBand}::boolean THEN ${patch.ratingBand ?? null}::text::"RatingBand" ELSE "ratingBand" END,
  "ratingBandSource" = COALESCE(${patch.ratingBandSource ?? null}::text, "ratingBandSource"),
  "initialRating"    = COALESCE(${patch.initialRating ?? null}::int::smallint, "initialRating"),
  goals              = COALESCE(${patch.goals ?? null}::text[]::"OnboardingGoal"[], goals),
  "dailyMinutes"     = COALESCE(${patch.dailyMinutes ?? null}::int::smallint, "dailyMinutes"),
  "timeZone"         = COALESCE(${patch.timeZone ?? null}::text, "timeZone"),
  "updatedAt"        = ${NOW_UTC}
WHERE id = ${userId}
${RETURNING}`;
}

/**
 * `complete: true` (§7.2): onboarded, the first onboardedAt kept, step DONE. The caller has checked entitlement
 * against the same request's viewer row. Idempotent: a second call changes nothing but updatedAt.
 */
export function completeOnboardingSql(userId: bigint, timeZone?: string): Prisma.Sql {
  return Prisma.sql`
UPDATE users SET
  onboarded        = true,
  "onboardedAt"    = COALESCE("onboardedAt", ${NOW_UTC}),
  "onboardingStep" = 'DONE'::"OnboardingStep",
  "timeZone"       = COALESCE(${timeZone ?? null}::text, "timeZone"),
  "updatedAt"      = ${NOW_UTC}
WHERE id = ${userId}
${RETURNING}`;
}

export type OnboardingWriteRow = Omit<OnboardingStateRow, "pendingCheckoutAt" | "accounts">;

/** The RETURNING row → the parts of the state it carries. */
export function toWriteResult(row: OnboardingWriteRow): { view: OnboardingView; timeZone: string } {
  const s = toOnboardingState({ ...row, pendingCheckoutAt: null, accounts: [] });
  return { view: onboardingViewOf(s), timeZone: s.timeZone };
}

/** Anything that runs a Prisma.Sql: `rawDb(prisma)` in the app, a PrismaClient in the integration tests. */
export type OnboardingSqlClient = { $queryRaw<T = unknown>(sql: Prisma.Sql): PromiseLike<T> };

/** Runs a write statement; null when the user row is gone. The route passes `rawDb(prisma)`. */
export async function runOnboardingWrite(
  db: OnboardingSqlClient,
  sql: Prisma.Sql,
): Promise<{ view: OnboardingView; timeZone: string } | null> {
  const rows = await db.$queryRaw<OnboardingWriteRow[]>(sql);
  return rows[0] ? toWriteResult(rows[0]) : null;
}

// ── Page loading (step pages and the resolver) ──────────────────────────────────────────────────────────────────

/** The destination after onboarding: a safe `?redirect_url=` on this request, else the `rc_onb_next` cookie. */
export async function onboardingNext(redirectUrl: string | null | undefined): Promise<string | null> {
  const fromQuery = safeNextPath(redirectUrl ?? null);
  if (fromQuery) return fromQuery;
  const { cookies } = await import("next/headers");
  return readNextCookie((await cookies()).get(NEXT_COOKIE)?.value);
}

export type StepPageData = {
  viewer: Viewer;
  state: OnboardingState;
  onb: OnbViewer;
  /** The request clock (x-rc-now aware), epoch ms. */
  now: number;
};

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Everything a step page needs, after its guard (§8.1 guardStep): signed out → sign-in; a page the viewer may not
 * open yet (or any more) → the guard's target. The page renders only when this returns.
 */
/**
 * The step guard for a hard load, run by the (flow) layout OUTSIDE the steps' Suspense boundary (FIX-1): a redirect
 * from there is a plain 307 before anything streams (P2 FIX-A), while each page still runs `loadStepPage` (soft
 * navigations skip the layout). `requestPath` is middleware's `x-rc-pathname` (path + query of the document request);
 * a path that is not a step leaves the decision to the page. Same cached reads as the page: no extra statement.
 */
export async function guardStepFromLayout(viewer: Viewer, requestPath: string | null): Promise<string | null> {
  if (!requestPath) return null;
  const url = new URL(requestPath, "https://rc.invalid");
  const m = /^\/onboarding\/([a-z]+)\/?$/.exec(url.pathname);
  const page = m?.[1];
  if (!page || !isOnbPage(page)) return null;
  const state = await getOnboardingState(viewer);
  if (!state) return "/sign-in";
  const now = (await requestNow()).getTime();
  const sp = (k: string) => url.searchParams.get(k) ?? undefined;
  const next = await onboardingNext(sp("redirect_url"));
  const onb = toOnbViewer(viewer, state, next);
  return guardStep(page, onb, now, { provider: sp("provider"), u: sp("u"), checkout: sp("checkout") });
}

export async function loadStepPage(
  page: OnbPage,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<StepPageData> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent(stepPath(page))}`);
  const state = await getOnboardingState(viewer);
  if (!state) redirect("/sign-in");
  const now = (await requestNow()).getTime();
  const next = await onboardingNext(one(searchParams.redirect_url));
  const onb = toOnbViewer(viewer, state, next);
  const query: StepQuery = { provider: one(searchParams.provider), u: one(searchParams.u), checkout: one(searchParams.checkout) };
  const to = guardStep(page, onb, now, query);
  if (to) redirect(to);
  return { viewer, state, onb, now };
}

// ── Level step ──────────────────────────────────────────────────────────────────────────────────────────────────

/** "CHESSCOM" → "chesscom". */
export const providerSlugOf = (a: LinkedAccountRow): SuggestProvider => (a.provider === "CHESSCOM" ? "chesscom" : "lichess");

/**
 * The Level suggestion: the stored one (`ratingBandSource` = `chesscom:rapid`, written with the link) with that
 * account's current rating for the banner; else computed from the first active link with rated games; else null.
 */
export function levelSuggestion(state: OnboardingState): (BandSuggestion & { provider: SuggestProvider }) | null {
  const active = state.accounts.filter((a) => a.status === "ACTIVE");
  const stored = parseBandSource(state.ratingBandSource);
  if (stored) {
    const account = active.find((a) => providerSlugOf(a) === stored.provider);
    const entry = account?.ratings?.[stored.timeClass];
    if (account && entry && state.ratingBand && state.ratingBand !== "NEW_TO_CHESS" && state.initialRating !== null) {
      return {
        provider: stored.provider,
        band: state.ratingBand,
        source: `${stored.provider}:${stored.timeClass}`,
        initialRating: state.initialRating,
        timeClass: stored.timeClass,
        displayRating: entry.rating,
      };
    }
  }
  for (const account of active) {
    const s = suggestBand(account.ratings, providerSlugOf(account));
    if (s) return { ...s, provider: providerSlugOf(account) };
  }
  return null;
}

/** Level's back target: the linked account's confirm URL, else Link. */
export function levelBackHref(state: OnboardingState): string {
  const active = state.accounts.filter((a) => a.status === "ACTIVE");
  const chesscom = active.find((a) => a.provider === "CHESSCOM");
  if (chesscom) return `${stepPath("confirm")}?provider=chesscom&u=${encodeURIComponent(chesscom.username)}`;
  if (active.some((a) => a.provider === "LICHESS")) return `${stepPath("confirm")}?provider=lichess`;
  return stepPath("link");
}


// ── Done / Activating ───────────────────────────────────────────────────────────────────────────────────────────

/** The providers with an ACTIVE link, oldest link first ("chesscom" | "lichess"). */
export function activeProviders(state: Pick<OnboardingState, "accounts">): SuggestProvider[] {
  return [...new Set(state.accounts.filter((a) => a.status === "ACTIVE").map(providerSlugOf))];
}

/** The lookup of the legend aside's position (D4-14): the legacy `chess_positions` row with that FEN (unique index). */
export function legendPositionSql(fen: string): Prisma.Sql {
  return Prisma.sql`SELECT "referenceId" FROM chess_positions WHERE fen = ${fen} AND "isActive" = true LIMIT 1`;
}

/**
 * `getFeaturedPositionByFen(KT_FEN)` (D4-14): the legacy `/position/[ref]` reference of the Kasparov–Topalov
 * position, or null, in which case "Play Your First Legend Position" is hidden (P8 retargets it to its legend
 * practice). A lookup failure hides the CTA too: Done must never fail on an optional link.
 */
export const getFeaturedPositionByFen = cache(async (fen: string): Promise<string | null> => {
  try {
    const rows = await rawDb(prisma).$queryRaw<{ referenceId: string }[]>(legendPositionSql(fen));
    return rows[0]?.referenceId ?? null;
  } catch (err) {
    logger.warn(`onboarding: legend position lookup failed (${err instanceof Error ? err.message : String(err)}); CTA hidden`);
    return null;
  }
});
