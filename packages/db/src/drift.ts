// Drift filter for `prisma migrate diff --from-migrations … --to-schema-datamodel … --script` (phase-02 plan 6.3).
//
// Prisma does not model partial indexes or storage parameters, so a raw `--exit-code` diff fails (or, depending on
// the Prisma version, silently ignores them) once the hand-written SQL in a migration exists. This filter drops the
// lines that are expected (DROP INDEX of a name in prisma/protected-indexes.txt, the storage-parameter statements
// Prisma could emit) and returns everything else as drift. Pure: no I/O. `scripts/db/check-drift.ts` is the CLI.

/** Reads protected-indexes.txt: one index name per line; `#` comments and blank lines ignored. */
export function parseProtectedIndexes(text: string): Set<string> {
  const names = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (line) names.add(line);
  }
  return names;
}

/** Splits a migration script into statements (comments removed). Good enough for Prisma's generated SQL. */
export function sqlStatements(script: string): string[] {
  const withoutComments = script
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const DROP_INDEX = /^DROP INDEX (?:CONCURRENTLY )?(?:IF EXISTS )?(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?$/i;
/** Storage parameters and column compression: Prisma does not model them (fillfactor, lz4). */
const STORAGE = [
  /^ALTER TABLE "?(?:public"?\.)?"?[A-Za-z0-9_]+"? (?:RE)?SET \(\s*fillfactor\b/i,
  /^ALTER TABLE "?(?:public"?\.)?"?[A-Za-z0-9_]+"? ALTER COLUMN "?[A-Za-z0-9_]+"? SET COMPRESSION\b/i,
];

export interface DriftReport {
  /** Statements that are drift (fail the check). */
  drift: string[];
  /** Statements ignored, with the reason. */
  ignored: { statement: string; reason: string }[];
}

export function filterDrift(script: string, protectedIndexes: ReadonlySet<string>): DriftReport {
  const report: DriftReport = { drift: [], ignored: [] };
  for (const statement of sqlStatements(script)) {
    const drop = DROP_INDEX.exec(statement);
    if (drop && protectedIndexes.has(drop[1]!)) {
      report.ignored.push({ statement, reason: `protected index ${drop[1]}` });
      continue;
    }
    if (STORAGE.some((re) => re.test(statement))) {
      report.ignored.push({ statement, reason: "storage parameter" });
      continue;
    }
    report.drift.push(statement);
  }
  return report;
}
