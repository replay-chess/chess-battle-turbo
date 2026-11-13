// The P4 precondition check (phase-04 plan 2.3) is pure over a catalog snapshot, and the M4 migration's own DO-block
// guard names exactly the same M2/M3 objects, so the script and the deploy fail on the same gaps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type CatalogSnapshot, describeCheck, failingChecks, M4_OBJECTS, P4_PRECONDITIONS } from "./check-p4-preconditions";

const m4Sql = readFileSync(new URL("../prisma/migrations/20261112000100_m4_import_onboarding/migration.sql", import.meta.url), "utf8");

function empty(): CatalogSnapshot {
  return {
    columns: new Set(),
    enums: new Set(),
    indexes: new Map(),
    tables: new Set(),
    validatedFks: new Set(),
    reloptions: new Map(),
    compression: new Map(),
    functions: new Map(),
  };
}

function satisfying(checks: typeof P4_PRECONDITIONS): CatalogSnapshot {
  const s = empty();
  for (const c of checks) {
    if (c.kind === "column") s.columns.add(`${c.table}.${c.column}`);
    if (c.kind === "enum") s.enums.add(`${c.type}.${c.value}`);
    if (c.kind === "table") s.tables.add(c.name);
    if (c.kind === "fk_validated") s.validatedFks.add(c.name);
    if (c.kind === "reloption") s.reloptions.set(c.table, [c.option]);
    if (c.kind === "compression") s.compression.set(`${c.table}.${c.column}`, c.method);
    if (c.kind === "function") s.functions.set(c.signature, c.securityDefiner ?? false);
  }
  return s;
}

describe("check-p4-preconditions", () => {
  it("an empty catalog misses everything; a complete one misses nothing", () => {
    assert.equal(failingChecks(P4_PRECONDITIONS, empty()).length, P4_PRECONDITIONS.length);
    const full = satisfying(P4_PRECONDITIONS);
    full.indexes.set("games_source_externalId_key", 'CREATE UNIQUE INDEX "games_source_externalId_key" ON public.games USING btree (source, "externalId")');
    full.indexes.set("jobs_ready_idx", "CREATE INDEX jobs_ready_idx ON public.jobs USING btree (priority DESC) WHERE (status = 'QUEUED'::\"JobStatus\")");
    full.indexes.set("jobs_dedupeKey_key", 'CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON public.jobs USING btree ("dedupeKey")');
    assert.deepEqual(failingChecks(P4_PRECONDITIONS, full).map(describeCheck), []);
  });

  it("an index without its partial predicate fails", () => {
    const full = satisfying(M4_OBJECTS);
    for (const c of M4_OBJECTS) if (c.kind === "index") full.indexes.set(c.name, `CREATE INDEX ${c.name} ON t USING btree (x)`);
    const failing = failingChecks(M4_OBJECTS, full).map(describeCheck);
    assert.ok(failing.includes("index import_runs_one_active (with its predicate)"));
    assert.ok(failing.includes("index linked_accounts_verified_key (with its predicate)"));
    assert.ok(!failing.includes("index import_runs_referenceId_key"));
    // The purge function must exist AND be SECURITY DEFINER (the worker has no DELETE on games).
    full.functions.set('import_purge_batch(bigint,"GameSource",integer)', false);
    assert.ok(failingChecks(M4_OBJECTS, full).map(describeCheck).includes('function import_purge_batch(bigint,"GameSource",integer) (SECURITY DEFINER)'));
  });

  it("the migration guard checks every M2/M3 column and enum value the script checks", () => {
    const guard = m4Sql.slice(m4Sql.indexOf("DO $$\nDECLARE"), m4Sql.indexOf("-- CreateEnum"));
    for (const c of P4_PRECONDITIONS) {
      if (c.kind === "column") assert.ok(guard.includes(`('${c.table}', '${c.column}')`), describeCheck(c));
      if (c.kind === "enum" && c.value !== "REPLAY") assert.ok(guard.includes(`('${c.type}', '${c.value}')`), describeCheck(c));
      if (c.kind === "index") assert.ok(guard.includes(c.name), describeCheck(c));
    }
  });

  it("every protected M4 index is checked with its predicate after deploy", () => {
    const protectedText = readFileSync(new URL("../prisma/protected-indexes.txt", import.meta.url), "utf8");
    const m4Names = protectedText.slice(protectedText.indexOf("# M4")).split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(m4Names.sort(), ["game_players_linked_account_idx", "import_runs_one_active", "import_runs_waiting_idx", "linked_accounts_autosync_idx", "linked_accounts_verified_key"]);
    for (const name of m4Names) {
      const check = M4_OBJECTS.find((c) => c.kind === "index" && c.name === name);
      assert.ok(check && check.kind === "index" && check.predicate, name);
      assert.ok(m4Sql.includes(`CREATE ${name.endsWith("_key") || name.endsWith("_one_active") ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name}`), name);
    }
  });
});
