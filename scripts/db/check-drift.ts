/**
 * Migration drift check (phase-02 plan 6.3, 6.5 step 3). Replaces P1's raw `prisma migrate diff --exit-code` CI
 * step, which cannot tell a hand-written partial index from drift.
 *
 *   pnpm tsx scripts/db/check-drift.ts --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres
 *   SHADOW_DATABASE_URL=… pnpm tsx scripts/db/check-drift.ts [--verbose]
 *
 * Replays packages/db/prisma/migrations into the SHADOW database (Prisma wipes it first), diffs the result against
 * packages/db/prisma/schema.prisma, and fails on any statement except a DROP INDEX of a name listed in
 * packages/db/prisma/protected-indexes.txt and the storage-parameter lines (fillfactor, lz4) Prisma does not model.
 *
 * Safety: the shadow database is reset, so only a local host is accepted (localhost, 127.0.0.1, ::1, or a CI
 * service named `postgres`). Never a Neon URL.
 *
 * Exit 0 = no drift; 1 = drift (statements printed); 2 = setup error.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filterDrift, parseProtectedIndexes } from "../../packages/db/src/drift";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB_DIR = path.join(ROOT, "packages/db");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

function shadowUrl(argv: string[]): string {
  const i = argv.indexOf("--shadow-database-url");
  const url = (i >= 0 ? argv[i + 1] : undefined) ?? process.env.SHADOW_DATABASE_URL;
  if (!url) {
    console.error("check-drift: pass --shadow-database-url <local postgres URL> or set SHADOW_DATABASE_URL");
    process.exit(2);
  }
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    console.error("check-drift: the shadow database URL does not parse (value not printed)");
    process.exit(2);
  }
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`check-drift: refusing shadow host ${host}: Prisma resets the shadow database; use a local Postgres`);
    process.exit(2);
  }
  return url;
}

function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.includes("--verbose");
  const shadow = shadowUrl(argv);
  const prisma = path.join(DB_DIR, "node_modules/.bin/prisma");
  let script: string;
  try {
    script = execFileSync(
      prisma,
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--shadow-database-url",
        shadow,
        "--script",
      ],
      {
        cwd: DB_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        // schema.prisma reads these even for a diff; nothing connects to them.
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? shadow, DIRECT_URL: process.env.DIRECT_URL ?? shadow },
      },
    );
  } catch (error) {
    console.error("check-drift: prisma migrate diff failed", (error as Error).message);
    process.exit(2);
  }
  const protectedIndexes = parseProtectedIndexes(readFileSync(path.join(DB_DIR, "prisma/protected-indexes.txt"), "utf8"));
  const report = filterDrift(script, protectedIndexes);
  if (verbose || report.ignored.length > 0) {
    for (const i of report.ignored) console.log(`ignored (${i.reason}): ${i.statement}`);
  }
  if (report.drift.length > 0) {
    console.error(`check-drift: ${report.drift.length} statement(s) of drift between the migrations and schema.prisma:`);
    for (const s of report.drift) console.error(`  ${s};`);
    console.error("Write a migration for the schema change (packages/db/prisma/migrations), never `prisma db push`.");
    process.exit(1);
  }
  console.log(`check-drift: no drift (${protectedIndexes.size} protected indexes, ${report.ignored.length} ignored)`);
}

main();
