// Connected-accounts DAL (phase-04 plan §5.1, §5.4, §7.3, §9.2). Server-only. The same functions back the GET routes
// and the RSC first paint, so the dehydrated query and the API body are identical (client-data-layer §2.3).
//
//   listLinkedAccounts(viewer)          ACC-1: ≤ 2 accounts with each one's newest run, ONE statement
//                                       (linked_accounts_userId_provider_key + a LATERAL … LIMIT 1 on
//                                       import_runs_linkedAccountId_createdAt_idx).
//   readLinkedAccount(db, userId, p)    one account view (ACC-5's answer, the link responses).
//   getAccountPreview(viewer, p, u)     the onboarding Confirm step: Chess.com lookup (cached) + the five newest
//                                       games; Lichess: the linked row + its newest five. A recent-games failure is
//                                       a partial render (`recent: null`), never an error page.
//   verifiedElsewhereSql(…)             the D4-10 conflict probe (linked_accounts_verified_key).
import type { AccountsData, LinkedAccountView, LookupData, ProviderSlug } from "@repo/contracts/http/accounts";
import { providerToDb, type ProviderDb } from "@repo/contracts/http/p04-plain";
import { Prisma } from "@repo/db";
import { parseRatings, ratingsView } from "@repo/db/json";
import { chesscomLookup, chesscomRecentGames } from "@/lib/accounts/chesscom";
import { lichessRecentGames } from "@/lib/accounts/lichess";
import { headlineOf, lookupDataOf, privateLookupData, type RecentGame } from "@/lib/accounts/preview";
import type { Viewer } from "@/lib/auth/viewer";
import { rawDb, type GamesDb } from "@/lib/games/snapshot.server";
import { isApiError } from "@/lib/api/api-error";
import { DataError } from "./errors";
import { ACCOUNT_COLUMNS, RUN_COLUMNS_AS_PREFIXED, toAccountView, type AccountRow } from "./import-rows";

export type AccountsDb = GamesDb;

async function defaultDb(): Promise<AccountsDb> {
  const { prisma } = await import("@/lib/prisma");
  return rawDb(prisma);
}

const FROM_WITH_RUN = `FROM linked_accounts la
LEFT JOIN LATERAL (
  SELECT * FROM import_runs r0 WHERE r0."linkedAccountId" = la.id ORDER BY r0."createdAt" DESC LIMIT 1
) r ON true`;

/** ACC-1's one statement. */
export function linkedAccountsSql(userId: bigint, provider?: ProviderDb): Prisma.Sql {
  const head = Prisma.raw(`SELECT ${ACCOUNT_COLUMNS}, ${RUN_COLUMNS_AS_PREFIXED} ${FROM_WITH_RUN} WHERE la."userId" = `);
  return provider
    ? Prisma.sql`${head}${userId}::bigint AND la.provider = ${provider}::"ChessProvider"`
    : Prisma.sql`${head}${userId}::bigint ORDER BY la.provider`;
}

/** `now` is the request clock (ctx.now in a route, requestNow() in a server component): the view status uses it. */
export async function listLinkedAccounts(viewer: Pick<Viewer, "id">, opts: { db?: AccountsDb; now: Date }): Promise<AccountsData> {
  const db = opts.db ?? (await defaultDb());
  const rows = await db.$queryRaw<AccountRow[]>(linkedAccountsSql(viewer.id));
  return { items: rows.map((row) => toAccountView(row, opts.now)) };
}

/** One account of the viewer (with its newest run) and its id, or null. */
export async function readLinkedAccount(
  db: AccountsDb,
  userId: bigint,
  provider: ProviderSlug,
  now: Date,
): Promise<{ id: bigint; view: LinkedAccountView } | null> {
  const rows = await db.$queryRaw<AccountRow[]>(linkedAccountsSql(userId, providerToDb(provider)));
  const row = rows[0];
  return row ? { id: BigInt(row.id), view: toAccountView(row, now) } : null;
}

/** The user id of another member holding a VERIFIED link to this external account (D4-10), or null. */
export function verifiedElsewhereSql(provider: ProviderDb, externalId: string, me: bigint): Prisma.Sql {
  return Prisma.sql`SELECT "userId" FROM linked_accounts
   WHERE provider = ${provider}::"ChessProvider" AND "externalId" = ${externalId} AND "verifiedAt" IS NOT NULL
     AND "userId" <> ${me}::bigint LIMIT 1`;
}

export async function verifiedElsewhere(db: AccountsDb, provider: ProviderDb, externalId: string, me: bigint): Promise<boolean> {
  const rows = await db.$queryRaw<unknown[]>(verifiedElsewhereSql(provider, externalId, me));
  return rows.length > 0;
}

// ── Confirm step ─────────────────────────────────────────────────────────────────────────────────────────────────

export type AccountPreview = {
  provider: ProviderSlug;
  /** The profile card: LookupData (Chess.com from the cached lookup; Lichess from the linked row). */
  account: LookupData;
  /** The five newest rated games, newest first; null when the provider could not be read (partial render). */
  recent: RecentGame[] | null;
  /** Lichess: true (the OAuth callback already linked it). Chess.com: whether this viewer already linked this handle. */
  linked: boolean;
};

async function recentOrNull(load: () => Promise<RecentGame[]>): Promise<RecentGame[] | null> {
  try {
    return await load();
  } catch (e) {
    if (isApiError(e) && (e.code === "upstream_unavailable" || e.code === "rate_limited")) return null;
    throw e;
  }
}

/**
 * The Confirm step's data. Chess.com: 404 (`DataError not_found`) when the handle no longer exists, 409
 * `linked_elsewhere` when another member holds a verified link; `private` profiles come back with no games.
 * Lichess: 404 when the viewer has no Lichess link (the confirm page sends them back to Link).
 */
export async function getAccountPreview(
  viewer: Pick<Viewer, "id">,
  provider: ProviderSlug,
  username: string | null,
  opts: { db?: AccountsDb; now: Date },
): Promise<AccountPreview> {
  const db = opts.db ?? (await defaultDb());
  if (provider === "lichess") {
    const linked = await readLinkedAccount(db, viewer.id, "lichess", opts.now);
    if (!linked) throw new DataError("not_found");
    const account = { ...linked.view, id: linked.id };
    const rows = await db.$queryRaw<{ countryCode: string | null; joinedAt: Date | null; usernameLower: string; ratings: unknown }[]>(
      Prisma.sql`SELECT "countryCode", "joinedAt", "usernameLower", ratings FROM linked_accounts WHERE id = ${account.id}::bigint`,
    );
    const extra = rows[0];
    const ratings = ratingsView(parseRatings(extra?.ratings));
    const total = account.totalRatedGames ?? 0;
    return {
      provider,
      linked: true,
      account: {
        status: total === 0 ? "no_games" : "found",
        profile: {
          username: extra?.usernameLower ?? account.username.toLowerCase(),
          displayUsername: account.username,
          name: account.displayName,
          avatarUrl: null,
          countryCode: extra?.countryCode?.trim() || null,
          joinedAt: extra?.joinedAt ? new Date(extra.joinedAt).toISOString() : null,
          title: account.title,
        },
        ratings,
        headline: headlineOf(ratings, "lichess"),
        totalRatedGames: total,
      },
      recent: total === 0 ? [] : await recentOrNull(() => lichessRecentGames(account.username)),
    };
  }

  if (!username) throw new DataError("not_found");
  const { value } = await chesscomLookup(username);
  if (value.kind === "not_found") throw new DataError("not_found");
  if (value.kind === "private") {
    return { provider, linked: false, account: privateLookupData(username, value.profile), recent: [] };
  }
  const externalId = String(value.profile.player_id);
  if (await verifiedElsewhere(db, "CHESSCOM", externalId, viewer.id)) {
    throw new DataError("conflict", { details: { reason: "linked_elsewhere" } });
  }
  const mine = await db.$queryRaw<unknown[]>(
    Prisma.sql`SELECT 1 FROM linked_accounts WHERE "userId" = ${viewer.id}::bigint AND provider = 'CHESSCOM' AND "externalId" = ${externalId}`,
  );
  const account = lookupDataOf(value.profile, value.stats);
  return {
    provider,
    linked: mine.length > 0,
    account,
    recent: account.totalRatedGames === 0 ? [] : await recentOrNull(() => chesscomRecentGames(username)),
  };
}
