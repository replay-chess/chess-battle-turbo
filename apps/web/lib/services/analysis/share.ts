// Review shares (phase-03 plan §5.4, §5.5, §7.2 A10–A12, §7.3 createOrReuseShare / updateShare / revokeShare /
// getActiveShare / getPublicShare, §11.3). The RSC entry points with React cache() and the tagged ISR loader live in
// WEB/lib/data/share.ts; the statements in ./share-sql.ts; the masking in ./share-snapshot.ts.
//
// - A10 builds the snapshot from the review (one statement, the A1 read) and then runs ONE statement for the daily
//   cap, the reuse lookup and the insert, in a transaction behind a per-owner advisory lock (so concurrent creates
//   cannot all pass the cap). A random-code collision (40 bits) retries with a new code, at most 3 times.
// - A11 changes only the sharer's name in the frozen snapshot and bumps `imageVersion` (the image URL's `?v=`), or
//   sets `revokedAt`. Both purge the page and the image: `revalidateTag("share:<code>")` in the request (the ISR page
//   and its data-cache entry), then the CDN copy of the image by tag in `after()`.
// - getPublicShare reads only snapshot, kind, expiresAt, revokedAt and imageVersion (no joins), so later edits or
//   deletions of the game, the users or the analysis never reach a public page.
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import type { ReviewDTO } from "@repo/contracts/http/review";
import {
  encodeShareCode,
  shareCacheTag,
  shareImagePath,
  sharePagePath,
  ShareCode,
  type ShareCreateBody,
  type ShareDTO,
} from "@repo/contracts/http/share";
import { parseShareSnapshot, type ShareSnapshotV1 } from "@repo/db/json";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import type { GamesDb, SqlTransaction } from "@/lib/games/snapshot.server";
import { siteOrigin } from "@/lib/routes";
import { getReview } from "./read";
import {
  activeShareSql,
  createShareSql,
  ownedShareSql,
  publicShareSql,
  revokeShareSql,
  shareCapLockSql,
  updateShareSql,
  type CreateRow,
  type OwnedShareRow,
  type PublicShareRow,
  type ShareRow,
} from "./share-sql";
import { buildReviewSnapshot, UnknownMomentError, withSharerName } from "./share-snapshot";

type ViewerRef = Pick<Viewer, "id" | "role">;

/** A colliding random code is retried with a fresh one this many times in all. */
export const SHARE_CODE_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

// ── Purge (test seam) ────────────────────────────────────────────────────────────────────────────────────────────
export type SharePurger = {
  /** The ISR page and its data-cache entry (next/cache revalidateTag). Synchronous, inside the request. */
  page(tag: string): void;
  /** The CDN copy of the image (Vercel-Cache-Tag). A no-op outside Vercel. Run in after(). */
  cdn(tag: string): Promise<void>;
};

const defaultPurger: SharePurger = {
  page: (tag) => revalidateTag(tag),
  // Delete rather than invalidate: an invalidated entry is served stale once more while it revalidates, and a revoked
  // link or a hidden username must not reach even one more viewer (§11.3, R17). Hobby-safe: a no-op off Vercel.
  cdn: async (tag) => {
    const { dangerouslyDeleteByTag } = await import("@vercel/functions");
    await dangerouslyDeleteByTag(tag);
  },
};

let purger: SharePurger = defaultPurger;

/** Test seam: records purges instead of calling Next and Vercel; returns a restore function. */
export function setSharePurger(next: SharePurger): () => void {
  const previous = purger;
  purger = next;
  return () => {
    purger = previous;
  };
}

/** Purges a share's page now and its image after the response. Never throws into the request. */
export function purgeShare(ctx: { after(task: () => unknown): void }, code: string): void {
  const tag = shareCacheTag(code);
  purger.page(tag);
  ctx.after(() => purger.cdn(tag).catch(() => undefined));
}

// ── DTO ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function shareDtoOf(row: ShareRow, origin: string = siteOrigin()): ShareDTO {
  return {
    code: row.code,
    url: `${origin}${sharePagePath(row.code)}`,
    imageUrl: `${origin}${shareImagePath(row.code, row.imageVersion)}`,
    expiresAt: new Date(row.expiresAt).toISOString(),
    showUsername: row.showUsername,
  };
}

/** The review payload's `share` block for the same row (ReviewDTO.share, `qk.review.detail`). */
export function reviewShareOf(dto: ShareDTO): NonNullable<ReviewDTO["share"]> {
  return { code: dto.code, url: dto.url, expiresAt: dto.expiresAt, showUsername: dto.showUsername };
}

// ── A10 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CreateResult = { status: 200 | 201; dto: ShareDTO } | "admin_noop";

export type CreateOptions = {
  nowMs: number;
  /** Runs the per-owner cap lock and the A10 statement in one transaction (rawTransaction(prisma) in the route). */
  transaction: SqlTransaction;
  /** Injected in tests to force collisions; defaults to crypto.randomBytes. */
  random?: (n: number) => Uint8Array;
};

/** `retryAfterSec` of the daily cap: the oldest share in the window + 24 h − now (at least 1 s). */
export function dailyCapRetryAfterSec(oldestAt: Date, nowAt: Date): number {
  const ms = new Date(oldestAt).getTime() + DAY_MS - new Date(nowAt).getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

/** The fields that make two create requests "the same link" (also the Idempotency-Key request hash). */
export function shareCreateIdentity(body: Pick<ShareCreateBody, "showUsername" | "momentPly">) {
  return { showUsername: body.showUsername, momentPly: body.momentPly ?? null };
}

/**
 * A10: a new 30-day link (201) or the identical live one (200). 404 for an unknown game or a non-player, 409
 * `analysis_not_done` before the review exists, 400 for a `momentPly` that is not shareable, 429 at the daily cap.
 * A non-player admin is a no-op (the route answers 204).
 */
export async function createOrReuseShare(
  db: GamesDb,
  viewer: ViewerRef,
  ref: string,
  body: Pick<ShareCreateBody, "showUsername" | "momentPly">,
  opts: CreateOptions,
): Promise<CreateResult> {
  const read = await getReview(db, viewer, ref, opts.nowMs);
  if (!read.row.isPlayer) return "admin_noop";
  const review = read.dto;
  if (review.status !== "done" || !review.review || !review.analysis) {
    throw new DataError("conflict", { details: { reason: "analysis_not_done" } });
  }
  let snapshot: ShareSnapshotV1;
  try {
    snapshot = buildReviewSnapshot(review, { showUsername: body.showUsername, momentPly: body.momentPly });
  } catch (err) {
    if (err instanceof UnknownMomentError) {
      throw new ApiError("validation_failed", { fields: { momentPly: "Not a key moment of this review" } });
    }
    throw err;
  }
  const random = opts.random ?? ((n: number) => randomBytes(n));
  const text = JSON.stringify(snapshot);
  for (let attempt = 0; attempt < SHARE_CODE_ATTEMPTS; attempt++) {
    const code = encodeShareCode(random(5));
    const [, rows] = await opts.transaction([
      shareCapLockSql(viewer.id),
      createShareSql({
        ownerId: viewer.id,
        gameId: read.row.gameId,
        ply: snapshot.moment?.ply ?? null,
        color: read.row.color,
        showUsername: body.showUsername,
        snapshot: text,
        code,
      }),
    ]);
    const row = (rows as CreateRow[] | undefined)?.[0];
    if (!row) continue; // the random code already exists: try another
    if (row.outcome === "capped") {
      throw new ApiError("rate_limited", {
        retryAfterSec: dailyCapRetryAfterSec(row.oldestAt ?? new Date(opts.nowMs), row.nowAt ?? new Date(opts.nowMs)),
        details: { bucket: "share-daily" },
      });
    }
    return { status: row.outcome === "created" ? 201 : 200, dto: shareDtoOf(row as ShareRow) };
  }
  throw new Error(`createOrReuseShare: ${SHARE_CODE_ATTEMPTS} share codes in a row collided`);
}

// ── A11 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function readOwned(db: GamesDb, viewer: ViewerRef, code: string): Promise<OwnedShareRow> {
  const rows = await db.$queryRaw<OwnedShareRow[]>(ownedShareSql(viewer.id, code));
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  return row;
}

/**
 * A11 PATCH: shows or hides the sharer's name (set semantics: the same value is answered without a write). 404 for a
 * code the viewer does not own, 410 for a revoked or expired link. `changed` tells the route to purge.
 */
export async function updateShare(
  db: GamesDb,
  viewer: ViewerRef,
  code: string,
  showUsername: boolean,
): Promise<{ dto: ShareDTO; changed: boolean }> {
  const row = await readOwned(db, viewer, code);
  if (!row.live) throw new ApiError("gone");
  if (row.showUsername === showUsername) return { dto: shareDtoOf(row), changed: false };
  const snapshot = parseShareSnapshot(row.snapshot);
  if (!snapshot || (row.color !== "w" && row.color !== "b")) throw new ApiError("gone");
  const next = withSharerName(snapshot, row.color, { name: row.youName ?? "", rating: row.ratingBefore }, showUsername);
  const updated = await db.$queryRaw<ShareRow[]>(
    updateShareSql({ viewerId: viewer.id, code, showUsername, snapshot: JSON.stringify(next), seenVersion: row.imageVersion }),
  );
  const out = updated[0];
  if (out) return { dto: shareDtoOf(out), changed: true };
  // Revoked, expired or toggled by another request between the read and the write: answer what is there now.
  const now = await readOwned(db, viewer, code);
  if (!now.live) throw new ApiError("gone");
  return { dto: shareDtoOf(now), changed: true };
}

/** A11 DELETE: revokes (idempotent). 404 for a code the viewer does not own. */
export async function revokeShare(db: GamesDb, viewer: ViewerRef, code: string): Promise<void> {
  const rows = await db.$queryRaw<{ code: string }[]>(revokeShareSql(viewer.id, code));
  if (!rows[0]) throw new DataError("not_found");
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The share page's seed: the viewer's live link for the game, or null. 404 for an unknown game or a non-player. */
export async function getActiveShare(db: GamesDb, viewer: ViewerRef, ref: string): Promise<ShareDTO | null> {
  const rows = await db.$queryRaw<(Partial<ShareRow> & { code: string | null })[]>(activeShareSql(viewer.id, ref));
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  return row.code ? shareDtoOf(row as ShareRow) : null;
}

/**
 * What `/r/<code>` and its image may show. Plain data (ISO strings, no Date), because the page caches it with
 * unstable_cache. `gone` = revoked, expired, a POSITION share (served at `/s/` from P9) or a snapshot this build cannot
 * read: the page shows the gone view and the image the generic card.
 */
export type PublicShare =
  | { state: "ok"; code: string; snapshot: ShareSnapshotV1; imageVersion: number; expiresAt: string | null }
  | { state: "gone"; code: string }
  | { state: "not_found"; code: string };

export async function getPublicShare(db: GamesDb, code: string): Promise<PublicShare> {
  if (!ShareCode.safeParse(code).success) return { state: "not_found", code };
  const rows = await db.$queryRaw<PublicShareRow[]>(publicShareSql(code));
  const row = rows[0];
  if (!row) return { state: "not_found", code };
  if (row.kind !== "REVIEW" || !row.live) return { state: "gone", code };
  const snapshot = parseShareSnapshot(row.snapshot);
  if (!snapshot) return { state: "gone", code };
  return {
    state: "ok",
    code,
    snapshot,
    imageVersion: row.imageVersion,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  };
}
