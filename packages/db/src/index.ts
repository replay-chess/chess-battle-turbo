// @repo/db: the Prisma schema, migrations, seeds and client (phase-02 plan 6.9).
// Re-exports the generated client (PrismaClient, Prisma namespace, enums, model types). Run
// `pnpm --filter @repo/db generate` after install or after a schema change.
export * from "#generated";
export { createPrismaClient, cachedPrismaClient, type CreatePrismaClientOptions } from "./client";
