import * as Sentry from "@sentry/nextjs";
import { PrismaClient } from "../app/generated/prisma";
import { isWriteOperation, recordQuery } from "./api/timing";

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
// Learn more: https://pris.ly/d/help/next-js-best-practices

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
const globalForPrisma = global as unknown as { prismaRc?: PrismaClient };

export const prisma =
  globalForPrisma.prismaRc ||
  withTiming(
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    }),
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaRc = prisma;
