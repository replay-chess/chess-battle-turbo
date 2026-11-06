import * as Sentry from "@sentry/nextjs";
import { cachedPrismaClient, createPrismaClient, type PrismaClient } from "@repo/db";
import { isWriteOperation, recordQuery } from "./api/timing";

// The schema, migrations and client live in @repo/db (phase-02 plan 6.9). The client is attached to the global
// object in development (cachedPrismaClient) so hot reloads do not exhaust the connection limit.

/**
 * Query extension (plan §7.2 steps 8 and 11, OPT §9.1): every statement is timed into the request's
 * AsyncLocalStorage store (lib/api/timing.ts), so route() knows the DB time, statement count and write count
 * (GET purity), and gets one Sentry `db` span when a request span is active (never a new root transaction).
 * Outside a route() request the store is absent and only the span logic runs.
 */
function withTiming(base: PrismaClient): PrismaClient {
  const extended = base.$extends({
    name: "rc-timing",
    query: {
      async $allOperations({ model, operation, args, query }) {
        const write = isWriteOperation(operation, args);
        const name = model ? `${model}.${operation}` : operation;
        const started = performance.now();
        try {
          return await Sentry.startSpan(
            {
              name,
              op: "db",
              onlyIfParent: true,
              attributes: { "db.system": "postgresql", "db.operation": operation, ...(model ? { "db.model": model } : {}) },
            },
            () => query(args),
          );
        } finally {
          recordQuery(performance.now() - started, write, name);
        }
      },
    },
  });
  // A query-only extension leaves the client API unchanged, so callers keep the PrismaClient type
  // (Prisma.TransactionClient, functions typed with PrismaClient, …).
  return extended as unknown as PrismaClient;
}

// `prismaRc` (not `prisma`): a dev server that hot-reloads this file picks up the timing extension instead of
// reusing a client created before it existed.
export const prisma: PrismaClient = cachedPrismaClient("prismaRc", () => withTiming(createPrismaClient()));
