// The one place a PrismaClient is constructed (phase-02 plan 6.9). The web app wraps it with its timing
// extension (apps/web/lib/prisma.ts); the socket server and scripts create their own with their own URL.
import { PrismaClient, type Prisma } from "#generated";

export interface CreatePrismaClientOptions {
  /** Prisma log levels. Default: `["error", "warn"]` in development, `["error"]` otherwise. */
  log?: Prisma.LogLevel[];
  /** Overrides `DATABASE_URL` from the schema's datasource (scripts that target DIRECT_URL, tests). */
  datasourceUrl?: string;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const log = options.log ?? (process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]);
  return new PrismaClient({
    log,
    ...(options.datasourceUrl ? { datasourceUrl: options.datasourceUrl } : {}),
  });
}

/**
 * Dev-only global cache: a dev server that hot-reloads its modules reuses the client under `key` instead of
 * opening a new pool on every reload (https://pris.ly/d/help/next-js-best-practices). In production every call
 * runs `create` (module scope keeps one instance per process anyway).
 */
export function cachedPrismaClient<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, T | undefined>;
  const existing = store[key];
  if (existing) return existing;
  const client = create();
  if (process.env.NODE_ENV !== "production") store[key] = client;
  return client;
}
