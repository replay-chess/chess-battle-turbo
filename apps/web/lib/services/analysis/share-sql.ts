// The share statements (phase-03 plan §6.4 `shares_owner_idx` / `shares_code_key`, §7.2 A10–A12, §7.3). One
// statement per step, all on the partial index `shares_owner_idx (ownerId, createdAt DESC) WHERE kind = 'REVIEW'` or
// the unique `shares_code_key`. Times are timestamp(3) without zone, stored in UTC: every comparison and every write
// uses (now() AT TIME ZONE 'UTC'), never the column defaults (which follow the session TimeZone).
import { SHARE_DAILY_CAP, SHARE_TTL_DAYS } from "@repo/contracts/http/share";
import { Prisma } from "@repo/db";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** The live-share columns every answer needs (ShareDTO). */
export type ShareRow = { code: string; expiresAt: Date; showUsername: boolean; imageVersion: number };

export type CreateOutcome = "created" | "reused" | "capped";

export type CreateRow = Partial<ShareRow> & {
  outcome: CreateOutcome;
  /** `capped` only: the oldest share inside the 24 h window (retryAfterSec = it + 24 h − now). */
  oldestAt: Date | null;
  /** `capped` only: the database's now, so the retry time is computed against one clock. */
  nowAt: Date | null;
};

export type CreateArgs = {
  ownerId: bigint;
  gameId: bigint;
  /** The card's moment ply (offset from startPly), or null for a card without a moment. */
  ply: number | null;
  color: "w" | "b";
  showUsername: boolean;
  /** The validated ShareSnapshotV1 as JSON text. */
  snapshot: string;
  /** A fresh random code; a collision makes the statement return no row and the caller retries with another. */
  code: string;
};

/**
 * The per-owner lock that makes the daily cap durable under concurrent creates: the first statement of A10's
 * transaction, so createShareSql's count runs with a snapshot taken after every earlier create of this owner committed.
 * Without it several A10 calls sent at once at n = 19 all counted 19 and all inserted (regression:
 * share-cap-concurrent-creates, FIX-2). A lock inside the same statement would not do: a statement keeps the snapshot
 * it started with.
 */
export function shareCapLockSql(ownerId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`share-cap:${ownerId}`}::text, 0))) l`;
}

/**
 * A10 in one statement (after shareCapLockSql, in one transaction): the durable daily cap (`count(*)` over the owner's last 24 h of REVIEW shares, revoked ones
 * included), the reuse of an identical live share (same game, same toggle, same moment), and the insert when neither
 * applies. Exactly one row comes back: `reused`, `created` or `capped`; none when the random code collided.
 */
export function createShareSql(a: CreateArgs): Prisma.Sql {
  return Prisma.sql`
WITH cap AS (
  SELECT count(*)::int AS n, min("createdAt") AS oldest FROM shares
   WHERE "ownerId" = ${a.ownerId} AND kind = 'REVIEW' AND "createdAt" > ${NOW} - interval '1 day'
), reuse AS (
  SELECT code, "expiresAt", "showUsername", "imageVersion"::int AS "imageVersion" FROM shares
   WHERE "ownerId" = ${a.ownerId} AND kind = 'REVIEW' AND "gameId" = ${a.gameId} AND "revokedAt" IS NULL
     AND "expiresAt" > ${NOW} AND "showUsername" = ${a.showUsername}
     AND ply IS NOT DISTINCT FROM ${a.ply}::smallint
   ORDER BY "createdAt" DESC LIMIT 1
), ins AS (
  INSERT INTO shares (code, kind, "ownerId", "gameId", ply, color, "showUsername", snapshot, "imageVersion",
                      "expiresAt", "createdAt")
  SELECT ${a.code}, 'REVIEW', ${a.ownerId}, ${a.gameId}, ${a.ply}::smallint, ${a.color}, ${a.showUsername},
         ${a.snapshot}::jsonb, 1, ${NOW} + (${SHARE_TTL_DAYS}::int * interval '1 day'), ${NOW}
   WHERE NOT EXISTS (SELECT 1 FROM reuse) AND (SELECT n FROM cap) < ${SHARE_DAILY_CAP}
  ON CONFLICT (code) DO NOTHING
  RETURNING code, "expiresAt", "showUsername", "imageVersion"::int AS "imageVersion"
)
SELECT 'reused' AS outcome, code, "expiresAt", "showUsername", "imageVersion", NULL::timestamp AS "oldestAt",
       NULL::timestamp AS "nowAt" FROM reuse
UNION ALL
SELECT 'created', code, "expiresAt", "showUsername", "imageVersion", NULL, NULL FROM ins
UNION ALL
SELECT 'capped', NULL, NULL, NULL, NULL, cap.oldest, ${NOW} FROM cap
 WHERE NOT EXISTS (SELECT 1 FROM reuse) AND cap.n >= ${SHARE_DAILY_CAP}`;
}

/** The viewer's live REVIEW share of a game (the share page's seed), with the player check (no row → 404). */
export function activeShareSql(viewerId: bigint, ref: string): Prisma.Sql {
  return Prisma.sql`
SELECT s.code, s."expiresAt", s."showUsername", s."imageVersion"::int AS "imageVersion"
  FROM games g
  JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${viewerId}
  LEFT JOIN LATERAL (
    SELECT code, "expiresAt", "showUsername", "imageVersion" FROM shares
     WHERE "ownerId" = ${viewerId} AND kind = 'REVIEW' AND "gameId" = g.id AND "revokedAt" IS NULL
       AND "expiresAt" > ${NOW}
     ORDER BY "createdAt" DESC LIMIT 1) s ON true
 WHERE g."referenceId" = ${ref}`;
}

export type OwnedShareRow = ShareRow & {
  snapshot: unknown;
  revokedAt: Date | null;
  color: "w" | "b" | null;
  live: boolean;
  /** The sharer as the review shows them: users.name and their game_players.ratingBefore. */
  youName: string | null;
  ratingBefore: number | null;
};

/** A11's read: the owner's REVIEW share by code with what the username toggle recomputes. No row → 404. */
export function ownedShareSql(viewerId: bigint, code: string): Prisma.Sql {
  return Prisma.sql`
SELECT s.code, s."expiresAt", s."showUsername", s."imageVersion"::int AS "imageVersion", s.snapshot, s."revokedAt",
       s.color, (s."revokedAt" IS NULL AND s."expiresAt" > ${NOW}) AS live,
       u.name AS "youName", gp."ratingBefore"
  FROM shares s
  LEFT JOIN users u ON u.id = s."ownerId"
  LEFT JOIN game_players gp ON gp."gameId" = s."gameId" AND gp."userId" = s."ownerId"
 WHERE s.code = ${code} AND s."ownerId" = ${viewerId} AND s.kind = 'REVIEW'`;
}

/**
 * A11 PATCH: the toggle, the recomputed snapshot and `imageVersion + 1`, only while the link is live and still at the
 * version the caller read (a concurrent toggle or revoke makes it return no row).
 */
export function updateShareSql(a: {
  viewerId: bigint;
  code: string;
  showUsername: boolean;
  snapshot: string;
  seenVersion: number;
}): Prisma.Sql {
  return Prisma.sql`
UPDATE shares SET "showUsername" = ${a.showUsername}, snapshot = ${a.snapshot}::jsonb,
       "imageVersion" = "imageVersion" + 1
 WHERE code = ${a.code} AND "ownerId" = ${a.viewerId} AND kind = 'REVIEW' AND "revokedAt" IS NULL
   AND "expiresAt" > ${NOW} AND "imageVersion" = ${a.seenVersion}::smallint
RETURNING code, "expiresAt", "showUsername", "imageVersion"::int AS "imageVersion"`;
}

/** A11 DELETE: `revokedAt` once (a repeat keeps the first time). No row → 404 (not the owner, or no such code). */
export function revokeShareSql(viewerId: bigint, code: string): Prisma.Sql {
  return Prisma.sql`
UPDATE shares SET "revokedAt" = COALESCE("revokedAt", ${NOW})
 WHERE code = ${code} AND "ownerId" = ${viewerId} AND kind = 'REVIEW'
RETURNING code`;
}

export type PublicShareRow = {
  snapshot: unknown;
  kind: "POSITION" | "REVIEW";
  expiresAt: Date | null;
  revokedAt: Date | null;
  imageVersion: number;
  /** Evaluated by the database clock, like every other expiry in this file. */
  live: boolean;
};

/** `/r/<code>` and its image (A12): only these columns, by the unique code (§5.5). */
export function publicShareSql(code: string): Prisma.Sql {
  return Prisma.sql`
SELECT snapshot, kind::text AS kind, "expiresAt", "revokedAt", "imageVersion"::int AS "imageVersion",
       ("revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > ${NOW})) AS live
  FROM shares WHERE code = ${code}`;
}
