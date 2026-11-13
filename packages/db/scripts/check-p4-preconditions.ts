/**
 * Phase-04 plan 2.3 precondition check (WP-A's first task), read-only.
 *
 *   pnpm --filter @repo/db exec tsx scripts/check-p4-preconditions.ts [--url <postgres url>] [--expect-m4] [--json]
 *
 * Checks the M2/M3 objects P4 reads or writes (consistency R-01): GameSource and both `source` columns, games'
 * externalId/externalUrl and their unique index, the display-name/rating/title columns, GameMode.IMPORTED and
 * GameEndMethod.OTHER, ecoCode/openingName/analysisStatus, jobs."fairSeq"/"lastKickAt" with jobs_ready_idx and the
 * dedupe key, users."gamesVersion", and JobKind's IMPORT_SYNC/IMPORT_PURGE. With `--expect-m4` it also checks what
 * m4a/M4/m4v created (tables, enums, columns, every protected M4 index with its predicate, the validated FK, lz4 and
 * fillfactor): run it after `prisma migrate deploy` (INTEGRATE-1 on the Neon dev branch, CI on Docker).
 *
 * The URL comes from --url, else DIRECT_URL, else DATABASE_URL; only its host is printed. Read-only, but still refused
 * for any host that is neither local nor the Neon dev branch (seed-guards DEV_HOST_ALLOWLIST): it never touches the
 * production branch or the old project.
 *
 * Exit 0 = every check passed; 1 = something is missing (listed); 2 = setup error. The migration itself carries the
 * same precondition guard (20261112000100_m4_import_onboarding raises before any DDL), so a missing object fails
 * loudly on deploy too; this script reports it without attempting a migration.
 */
import { pathToFileURL } from "node:url";
import { Prisma } from "#generated";
import { createPrismaClient } from "../src/client";
import { hostOf, isDevHost, isLocalHost } from "../prisma/seed-guards";

export type Check =
  | { kind: "column"; table: string; column: string }
  | { kind: "enum"; type: string; value: string }
  | { kind: "index"; name: string; predicate?: RegExp }
  | { kind: "table"; name: string }
  | { kind: "fk_validated"; name: string }
  | { kind: "reloption"; table: string; option: string }
  | { kind: "compression"; table: string; column: string; method: "l" | "p" }
  /** `signature` as `regprocedure` prints it, e.g. `import_purge_batch(bigint,"GameSource",integer)`. */
  | { kind: "function"; signature: string; securityDefiner?: boolean };

const col = (table: string, column: string): Check => ({ kind: "column", table, column });
const en = (type: string, value: string): Check => ({ kind: "enum", type, value });

/** What M2/M3 must have shipped before M4 (plan 2.3). The M4 migration's DO-block guard checks the same list. */
export const P4_PRECONDITIONS: readonly Check[] = [
  en("GameSource", "REPLAY"),
  en("GameSource", "CHESSCOM"),
  en("GameSource", "LICHESS"),
  col("games", "source"),
  col("game_players", "source"),
  col("games", "externalId"),
  col("games", "externalUrl"),
  { kind: "index", name: "games_source_externalId_key" },
  col("games", "whiteName"),
  col("games", "blackName"),
  col("games", "whiteRating"),
  col("games", "blackRating"),
  col("games", "whiteTitle"),
  col("games", "blackTitle"),
  en("GameMode", "IMPORTED"),
  en("GameEndMethod", "OTHER"),
  col("games", "ecoCode"),
  col("games", "openingName"),
  col("games", "analysisStatus"),
  col("game_players", "ecoCode"),
  col("jobs", "fairSeq"),
  col("jobs", "lastKickAt"),
  { kind: "index", name: "jobs_ready_idx", predicate: /WHERE \(status = 'QUEUED'/ },
  { kind: "index", name: "jobs_dedupeKey_key" },
  col("users", "gamesVersion"),
  en("JobKind", "IMPORT_SYNC"),
  en("JobKind", "IMPORT_PURGE"),
];

const M4_USER_COLUMNS = [
  "onboardingStep", "onboardedAt", "ratingBand", "ratingBandSource", "initialRating", "goals", "dailyMinutes",
  "signupSource", "timeZone", "trialOfferedAt", "pendingCheckoutSessionId", "pendingCheckoutPlan", "pendingCheckoutAt",
  "lastCheckoutSource", "membershipEndedAt", "lastPaymentFailedAt", "lastPaymentFailureReason",
];

/** What m4a + M4 + m4v create (plan 6.1-6.5). */
export const M4_OBJECTS: readonly Check[] = [
  ...["linked_accounts", "import_cursors", "import_runs", "trial_ledger", "audit_logs"].map((name): Check => ({ kind: "table", name })),
  ...["CHESSCOM", "LICHESS"].map((v) => en("ChessProvider", v)),
  ...["ACTIVE", "ERROR", "RELINK_REQUIRED"].map((v) => en("LinkStatus", v)),
  ...["IDLE", "WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING", "RATE_LIMITED", "FAILED"].map((v) => en("ImportState", v)),
  ...["WAITING_FOR_MEMBERSHIP", "QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"].map((v) => en("ImportRunStatus", v)),
  ...["INITIAL", "MANUAL", "DAILY", "RETRY"].map((v) => en("ImportTrigger", v)),
  ...["WELCOME", "LINK", "CONFIRM", "LEVEL", "GOALS", "PLAN", "ACTIVATING", "DONE"].map((v) => en("OnboardingStep", v)),
  ...["NEW_TO_CHESS", "UNDER_800", "R800_1200", "R1200_1600", "R1600_2000", "R2000_PLUS"].map((v) => en("RatingBand", v)),
  ...["STOP_BLUNDERING", "LEARN_OPENINGS", "IMPROVE_ENDGAMES", "STUDY_LEGENDS", "PLAY_FRIENDS"].map((v) => en("OnboardingGoal", v)),
  ...["ACCOUNT", "BILLING", "ADMIN", "CONTENT", "TOURNAMENT", "MODERATION", "SYSTEM"].map((v) => en("AuditCategory", v)),
  ...["USER", "ADMIN", "SYSTEM", "WORKER", "WEBHOOK"].map((v) => en("AuditActor", v)),
  ...M4_USER_COLUMNS.map((c) => col("users", c)),
  col("game_players", "linkedAccountId"),
  { kind: "index", name: "game_players_linked_account_idx", predicate: /WHERE \("linkedAccountId" IS NOT NULL\)/ },
  { kind: "index", name: "linked_accounts_verified_key", predicate: /^CREATE UNIQUE INDEX .* WHERE \("verifiedAt" IS NOT NULL\)/ },
  { kind: "index", name: "linked_accounts_autosync_idx", predicate: /WHERE \("autoImport" AND \(status = 'ACTIVE'/ },
  { kind: "index", name: "import_runs_one_active", predicate: /^CREATE UNIQUE INDEX .*WAITING_FOR_MEMBERSHIP.*QUEUED.*RUNNING/ },
  { kind: "index", name: "import_runs_waiting_idx", predicate: /WHERE \(status = 'WAITING_FOR_MEMBERSHIP'/ },
  { kind: "index", name: "linked_accounts_userId_provider_key" },
  { kind: "index", name: "linked_accounts_provider_usernameLower_idx" },
  { kind: "index", name: "import_runs_referenceId_key" },
  { kind: "index", name: "import_runs_userId_createdAt_idx" },
  { kind: "index", name: "import_runs_linkedAccountId_createdAt_idx" },
  { kind: "index", name: "audit_logs_category_at_idx" },
  { kind: "index", name: "audit_logs_targetType_targetId_idx" },
  { kind: "fk_validated", name: "game_players_linkedAccountId_fkey" },
  { kind: "reloption", table: "linked_accounts", option: "fillfactor=85" },
  { kind: "compression", table: "import_cursors", column: "archives", method: "l" },
  { kind: "function", signature: 'import_purge_batch(bigint,"GameSource",integer)', securityDefiner: true },
];

export interface CatalogSnapshot {
  columns: Set<string>; // "table.column"
  enums: Set<string>; // "Type.VALUE"
  indexes: Map<string, string>; // name → indexdef
  tables: Set<string>;
  validatedFks: Set<string>;
  reloptions: Map<string, string[]>;
  compression: Map<string, string>; // "table.column" → attcompression
  functions: Map<string, boolean>; // regprocedure text → SECURITY DEFINER
}

export function describeCheck(c: Check): string {
  switch (c.kind) {
    case "column":
      return `column ${c.table}.${c.column}`;
    case "enum":
      return `enum ${c.type}.${c.value}`;
    case "index":
      return `index ${c.name}${c.predicate ? " (with its predicate)" : ""}`;
    case "table":
      return `table ${c.name}`;
    case "fk_validated":
      return `validated FK ${c.name}`;
    case "reloption":
      return `${c.table} ${c.option}`;
    case "compression":
      return `${c.table}.${c.column} compression ${c.method === "l" ? "lz4" : "pglz"}`;
    case "function":
      return `function ${c.signature}${c.securityDefiner ? " (SECURITY DEFINER)" : ""}`;
  }
}

/** The checks that fail against a catalog snapshot (pure; unit-tested). */
export function failingChecks(checks: readonly Check[], snap: CatalogSnapshot): Check[] {
  return checks.filter((c) => {
    switch (c.kind) {
      case "column":
        return !snap.columns.has(`${c.table}.${c.column}`);
      case "enum":
        return !snap.enums.has(`${c.type}.${c.value}`);
      case "index": {
        const def = snap.indexes.get(c.name);
        return def === undefined || (c.predicate !== undefined && !c.predicate.test(def));
      }
      case "table":
        return !snap.tables.has(c.name);
      case "fk_validated":
        return !snap.validatedFks.has(c.name);
      case "reloption":
        return !(snap.reloptions.get(c.table) ?? []).includes(c.option);
      case "compression":
        return snap.compression.get(`${c.table}.${c.column}`) !== c.method;
      case "function": {
        const definer = snap.functions.get(c.signature);
        return definer === undefined || (c.securityDefiner === true && !definer);
      }
    }
  });
}

type Db = ReturnType<typeof createPrismaClient>;

export async function readCatalog(db: Db): Promise<CatalogSnapshot> {
  const [columns, enums, indexes, tables, fks, rel, comp, fns] = await Promise.all([
    db.$queryRaw<{ k: string }[]>(Prisma.sql`
      SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema = current_schema()`),
    db.$queryRaw<{ k: string }[]>(Prisma.sql`
      SELECT t.typname || '.' || e.enumlabel AS k FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = current_schema()`),
    db.$queryRaw<{ name: string; def: string }[]>(Prisma.sql`
      SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = current_schema()`),
    db.$queryRaw<{ k: string }[]>(Prisma.sql`
      SELECT table_name AS k FROM information_schema.tables WHERE table_schema = current_schema()`),
    db.$queryRaw<{ k: string }[]>(Prisma.sql`
      SELECT c.conname AS k FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = current_schema() AND c.contype = 'f' AND c.convalidated`),
    db.$queryRaw<{ k: string; o: string[] | null }[]>(Prisma.sql`
      SELECT c.relname AS k, c.reloptions AS o FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind = 'r'`),
    db.$queryRaw<{ k: string; m: string }[]>(Prisma.sql`
      SELECT c.relname || '.' || a.attname AS k, a.attcompression::text AS m
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind = 'r' AND a.attnum > 0 AND a.attcompression <> ''`),
    db.$queryRaw<{ k: string; d: boolean }[]>(Prisma.sql`
      SELECT p.oid::regprocedure::text AS k, p.prosecdef AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = current_schema()`),
  ]);
  return {
    columns: new Set(columns.map((r) => r.k)),
    enums: new Set(enums.map((r) => r.k)),
    indexes: new Map(indexes.map((r) => [r.name, r.def])),
    tables: new Set(tables.map((r) => r.k)),
    validatedFks: new Set(fks.map((r) => r.k)),
    reloptions: new Map(rel.map((r) => [r.k, r.o ?? []])),
    compression: new Map(comp.map((r) => [r.k, r.m])),
    functions: new Map(fns.map((r) => [r.k, r.d])),
  };
}

function urlFrom(argv: string[]): string | undefined {
  const i = argv.indexOf("--url");
  return (i >= 0 ? argv[i + 1] : undefined) ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const url = urlFrom(argv);
  if (!url) {
    console.error("check-p4-preconditions: pass --url or set DIRECT_URL / DATABASE_URL");
    return 2;
  }
  let host: string;
  try {
    host = hostOf(url);
  } catch {
    console.error("check-p4-preconditions: the URL does not parse (value not printed)");
    return 2;
  }
  // `postgres` = the CI service container's host name.
  if (!isLocalHost(host) && host !== "postgres" && !isDevHost(host)) {
    console.error(`check-p4-preconditions: refusing host ${host}: only a local Postgres or the Neon dev branch`);
    return 2;
  }
  const expectM4 = argv.includes("--expect-m4");
  const db = createPrismaClient({ datasourceUrl: url });
  try {
    const snap = await readCatalog(db);
    const pre = failingChecks(P4_PRECONDITIONS, snap);
    const m4 = expectM4 ? failingChecks(M4_OBJECTS, snap) : [];
    const report = {
      host,
      preconditions: { checked: P4_PRECONDITIONS.length, missing: pre.map(describeCheck) },
      ...(expectM4 ? { m4: { checked: M4_OBJECTS.length, missing: m4.map(describeCheck) } } : {}),
    };
    if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`host ${host}`);
      console.log(`P4 preconditions (plan 2.3): ${P4_PRECONDITIONS.length - pre.length}/${P4_PRECONDITIONS.length} present`);
      for (const c of pre) console.log(`  MISSING ${describeCheck(c)}`);
      if (expectM4) {
        console.log(`M4 objects (m4a/M4/m4v): ${M4_OBJECTS.length - m4.length}/${M4_OBJECTS.length} present`);
        for (const c of m4) console.log(`  MISSING ${describeCheck(c)}`);
      }
    }
    return pre.length + m4.length === 0 ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error("check-p4-preconditions: failed:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>") : "unknown error");
      process.exit(2);
    },
  );
}
