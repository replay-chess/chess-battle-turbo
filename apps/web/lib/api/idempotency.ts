// Header-key idempotency (api-design §2.8; phase-02 plan §7.1.1, §7.2). Server-only.
//
//   const out = await withIdempotency(prisma, { userId, key, route: "games.create", hash: requestHash(body), now },
//                                     async () => ({ status: 201, body: { game } }));
//   // out.replayed → answer with `Idempotent-Replayed: true`
//
// One row per (userId, key) in `idempotency_keys` (M2i), kept 24 h (the daily cron prunes older rows):
// 1. INSERT … ON CONFLICT DO NOTHING RETURNING 1. Inserted → run; on success store status 1 + the response; on a 4xx
//    ApiError store it too (the same request fails the same way); on a 5xx or any other error DELETE the row so the
//    client may retry.
// 2. Not inserted → read the row: a different route or body hash → 422 idempotency_key_reused; status 0 younger than
//    60 s → 409 in_flight (retryAfterSec 2); older → abandoned, take it over; status 1 → replay.
import { createHash } from "node:crypto";
import { Prisma } from "@repo/db";
import { ApiError, isApiError } from "./api-error";
import type { ErrorCode } from "@repo/contracts/http/codes";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotent-Replayed";
/** A running row older than this is treated as abandoned (the request died) and taken over. */
export const IDEMPOTENCY_IN_FLIGHT_MS = 60_000;
export const IDEMPOTENCY_RETRY_AFTER_SEC = 2;
/** Rows older than this are deleted by the daily cron (`idempotency-prune`). */
export const IDEMPOTENCY_TTL_HOURS = 24;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface IdempotencyDb {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
  $executeRaw(query: Prisma.Sql): PromiseLike<number>;
}

/**
 * The request's key (lower-cased), null when absent and optional. A malformed key, or a missing required one, is a
 * 400 validation_failed on the header.
 */
export function readIdempotencyKey(headers: Pick<Headers, "get">, options: { required: boolean }): string | null {
  const raw = headers.get(IDEMPOTENCY_KEY_HEADER)?.trim().toLowerCase();
  if (!raw) {
    if (!options.required) return null;
    throw new ApiError("validation_failed", {
      message: "An Idempotency-Key header is required.",
      fields: { [IDEMPOTENCY_KEY_HEADER]: "Required" },
    });
  }
  if (!UUID_V4.test(raw)) {
    throw new ApiError("validation_failed", {
      message: "The Idempotency-Key header must be a UUID v4.",
      fields: { [IDEMPOTENCY_KEY_HEADER]: "Must be a UUID v4" },
    });
  }
  return raw;
}

/** JSON with object keys sorted at every level (so key order never changes the hash). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** sha256 hex of the canonical JSON body. */
export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export type IdempotencyScope = {
  userId: bigint;
  key: string;
  /** The registry id ("games.create"), ≤ 64 chars. */
  route: string;
  hash: string;
  now: Date;
};

export type IdempotentResponse<T> = { status: number; body: T };
export type IdempotentOutcome<T> = IdempotentResponse<T> & { replayed: boolean };

type StoredError = { apiError: { code: ErrorCode; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } };

type Row = {
  route: string;
  requestHash: string;
  status: number;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
};

function isStoredError(body: unknown): body is StoredError {
  return !!body && typeof body === "object" && "apiError" in body;
}

function replay<T>(row: Row): IdempotentOutcome<T> {
  if (isStoredError(row.responseBody)) {
    const e = row.responseBody.apiError;
    throw new ApiError(e.code, { message: e.message, fields: e.fields, details: { ...e.details, replayed: true } });
  }
  return { status: row.responseStatus ?? 200, body: row.responseBody as T, replayed: true };
}

async function claim(db: IdempotencyDb, s: IdempotencyScope): Promise<boolean> {
  const rows = await db.$queryRaw<unknown[]>(Prisma.sql`
    INSERT INTO idempotency_keys ("userId", key, route, "requestHash", status, "createdAt")
    VALUES (${s.userId}, ${s.key}, ${s.route}, ${s.hash}, 0, ${s.now}::timestamp(3))
    ON CONFLICT ("userId", key) DO NOTHING
    RETURNING 1 AS claimed`);
  return rows.length > 0;
}

async function takeOver(db: IdempotencyDb, s: IdempotencyScope, seen: Date): Promise<boolean> {
  const n = await db.$executeRaw(Prisma.sql`
    UPDATE idempotency_keys SET "createdAt" = ${s.now}::timestamp(3)
     WHERE "userId" = ${s.userId} AND key = ${s.key} AND status = 0 AND "createdAt" = ${seen}::timestamp(3)`);
  return n === 1;
}

/** Runs `run` at most once per (user, key); replays its stored answer afterwards. */
export async function withIdempotency<T>(
  db: IdempotencyDb,
  scope: IdempotencyScope,
  run: () => Promise<IdempotentResponse<T>>,
): Promise<IdempotentOutcome<T>> {
  let owned = await claim(db, scope);
  if (!owned) {
    const rows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT route, "requestHash", status, "responseStatus", "responseBody", "createdAt"
        FROM idempotency_keys WHERE "userId" = ${scope.userId} AND key = ${scope.key}`);
    const row = rows[0];
    if (!row) {
      // Deleted between the insert and the read (a failed first attempt): claim again once.
      owned = await claim(db, scope);
      if (!owned) throw new ApiError("in_flight", { retryAfterSec: IDEMPOTENCY_RETRY_AFTER_SEC });
    } else {
      if (row.route !== scope.route || row.requestHash !== scope.hash) throw new ApiError("idempotency_key_reused");
      if (row.status === 1) return replay<T>(row);
      const age = scope.now.getTime() - new Date(row.createdAt).getTime();
      if (age < IDEMPOTENCY_IN_FLIGHT_MS || !(await takeOver(db, scope, new Date(row.createdAt)))) {
        throw new ApiError("in_flight", { retryAfterSec: IDEMPOTENCY_RETRY_AFTER_SEC });
      }
      owned = true;
    }
  }

  let result: IdempotentResponse<T>;
  try {
    result = await run();
  } catch (err) {
    if (isApiError(err) && err.status < 500) {
      const stored: StoredError = {
        apiError: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}) },
      };
      await store(db, scope, err.status, stored).catch(() => undefined);
    } else {
      await db
        .$executeRaw(Prisma.sql`DELETE FROM idempotency_keys WHERE "userId" = ${scope.userId} AND key = ${scope.key} AND status = 0`)
        .then(
          () => undefined,
          () => undefined,
        );
    }
    throw err;
  }
  await store(db, scope, result.status, result.body);
  return { ...result, replayed: false };
}

async function store(db: IdempotencyDb, s: IdempotencyScope, status: number, body: unknown): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    UPDATE idempotency_keys SET status = 1, "responseStatus" = ${status}::smallint, "responseBody" = ${JSON.stringify(body)}::jsonb
     WHERE "userId" = ${s.userId} AND key = ${s.key}`);
}

/** The daily prune (api-design §2.8 step 4): rows older than 24 h. */
export function pruneIdempotencyKeysSql(hours: number = IDEMPOTENCY_TTL_HOURS): Prisma.Sql {
  return Prisma.sql`DELETE FROM idempotency_keys WHERE "createdAt" < now() - (${hours}::int * interval '1 hour')`;
}
