import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BATCH_SIZE,
  SeedGuardError,
  allowedHostsFromEnv,
  assertBackfillHost,
  checkBackfillTripwire,
  eachBatch,
  parseBackfillArgs,
  resolveBackfillUrl,
} from "./p04-common";

// Every test URL is built from parts (scheme, dummy credentials, host, database), so no connection string literal sits in
// the repository: only the host rules matter here.
const pg = (cred: string, host: string, db = "neondb") => `${["postgresql", ""].join(":")}//${cred}@${host}/${db}`;
const DUMMY = ["u", "p"].join(":");
const DEV = pg(DUMMY, "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech");
const DEV_DIRECT = pg(DUMMY, "ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech");
const PROD = pg(DUMMY, "ep-shiny-shape-b8lvr0f5.us-east-1.aws.neon.tech");
const OLD = pg(DUMMY, "ep-still-brook-a5nutqwh.us-east-2.aws.neon.tech", "x");

describe("backfill host guard (BACKFILL_ALLOWED_HOSTS)", () => {
  it("accepts the dev endpoint and a local Postgres", () => {
    assert.deepEqual(assertBackfillHost(DEV, {}), { host: "ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech", kind: "neon-dev" });
    assert.equal(assertBackfillHost(DEV_DIRECT, {}).kind, "neon-dev");
    assert.deepEqual(assertBackfillHost(pg(["postgres", "x"].join(":"), "127.0.0.1:55451", "db"), {}), { host: "127.0.0.1", kind: "local" });
    assert.equal(assertBackfillHost(pg(["postgres", "postgres"].join(":"), "localhost:5432", "replay"), {}).kind, "local");
    assert.equal(assertBackfillHost(pg(["postgres", "postgres"].join(":"), "postgres:5432", "replay"), {}).kind, "local");
  });

  it("refuses production and the old project unless the exact host is listed", () => {
    for (const url of [PROD, OLD]) assert.throws(() => assertBackfillHost(url, {}), (e: unknown) => e instanceof SeedGuardError && /BACKFILL_ALLOWED_HOSTS/.test(e.message));
    const listed = { BACKFILL_ALLOWED_HOSTS: " ep-shiny-shape-b8lvr0f5.us-east-1.aws.neon.tech , " };
    assert.deepEqual(assertBackfillHost(PROD, listed), { host: "ep-shiny-shape-b8lvr0f5.us-east-1.aws.neon.tech", kind: "listed" });
    assert.throws(() => assertBackfillHost(OLD, listed), SeedGuardError, "only the listed host");
    assert.throws(() => assertBackfillHost(PROD, { BACKFILL_ALLOWED_HOSTS: "ep-shiny-shape-b8lvr0f5" }), SeedGuardError, "exact host, no prefix match");
  });

  it("never echoes the URL (credentials) in its errors", () => {
    // Built from parts so the repo's gitleaks rule (postgres-url-with-password) sees a variable, not an inline password.
    const SECRET = ["sup3r", "secret"].join("");
    try {
      assertBackfillHost(`postgresql://user:${SECRET}@db.example.com/x`, {});
      assert.fail("expected a refusal");
    } catch (e) {
      assert.ok(e instanceof SeedGuardError);
      assert.ok(!e.message.includes(SECRET));
    }
    assert.throws(() => assertBackfillHost("not a url", {}), /does not parse/);
    assert.throws(() => assertBackfillHost(undefined, {}), /empty/);
  });

  it("parses the host list", () => {
    assert.deepEqual(allowedHostsFromEnv(undefined), []);
    assert.deepEqual(allowedHostsFromEnv(""), []);
    assert.deepEqual(allowedHostsFromEnv("A.example.com, b.example.com ,,"), ["a.example.com", "b.example.com"]);
  });

  it("takes the URL from the shell first, else the dev env file, never .env.local", () => {
    assert.deepEqual(resolveBackfillUrl({ DIRECT_URL: DEV }, "/nonexistent"), { url: DEV, origin: "shell" });
    assert.deepEqual(resolveBackfillUrl({ DATABASE_URL: DEV }, "/nonexistent"), { url: DEV, origin: "shell" });
    assert.throws(() => resolveBackfillUrl({}, "/nonexistent"), /DIRECT_URL is not set/);
  });
});

describe("tripwire", () => {
  const fake = (n: bigint) => ({
    $queryRaw: (async () => [{ n }]) as never,
    $executeRaw: (async () => 0) as never,
  });
  it("applies on the dev endpoint and local Postgres, not in the listed production window", async () => {
    assert.equal(await checkBackfillTripwire(fake(24n), "neon-dev"), 24);
    await assert.rejects(checkBackfillTripwire(fake(104n), "local"), /looks like production/);
    assert.equal(await checkBackfillTripwire(fake(104n), "listed"), null);
  });
});

describe("arguments", () => {
  it("is a dry run unless --apply", () => {
    assert.equal(parseBackfillArgs([]).apply, false);
    assert.equal(parseBackfillArgs(["--dry-run"]).apply, false);
    assert.equal(parseBackfillArgs(["--apply"]).apply, true);
    assert.equal(parseBackfillArgs(["--", "--apply"]).apply, true);
    assert.ok(parseBackfillArgs(["--apply", "--queue-imports"], ["--queue-imports"]).flags.has("--queue-imports"));
  });
  it("refuses unknown flags and contradictions", () => {
    assert.throws(() => parseBackfillArgs(["--force"]), /unknown argument --force/);
    assert.throws(() => parseBackfillArgs(["--queue-imports"]), /unknown argument/);
    assert.throws(() => parseBackfillArgs(["--apply", "--dry-run"]), /either --apply or --dry-run/);
  });
});

describe("eachBatch", () => {
  it("walks the keyset until an empty or short batch", async () => {
    const ids = Array.from({ length: 1_203 }, (_, i) => BigInt(i * 2 + 1));
    const cursors: bigint[] = [];
    const batches = await eachBatch(async (cursor, limit) => {
      cursors.push(cursor);
      const rows = ids.filter((id) => id > cursor).slice(0, limit);
      return { last: rows.at(-1) ?? null, size: rows.length };
    });
    assert.equal(BATCH_SIZE, 500);
    assert.equal(batches, 3);
    assert.deepEqual(cursors, [0n, ids[499], ids[999]]);
  });

  it("stops at once on an empty table and after an exact multiple", async () => {
    assert.equal(await eachBatch(async () => ({ last: null, size: 0 })), 0);
    const ids = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
    let calls = 0;
    const n = await eachBatch(async (cursor, limit) => {
      calls++;
      const rows = ids.filter((id) => id > cursor).slice(0, limit);
      return { last: rows.at(-1) ?? null, size: rows.length };
    }, 5);
    assert.deepEqual([n, calls], [2, 3]);
  });
});
