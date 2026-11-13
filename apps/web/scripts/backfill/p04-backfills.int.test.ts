/**
 * The four Phase 4 backfills (phase-04 plan 6.6) on a real Postgres after `prisma migrate deploy`, against realistic
 * legacy rows: 1,150 users (three keyset batches of 500), legacy Chess.com profiles with every rating shape, onboarded
 * and fresh users, used trials (two accounts whose emails normalise alike), a verified Lichess link, entitled and
 * lapsed members, Clerk users with and without the claim, and seed users Clerk does not know.
 *
 * Each backfill: the dry run writes nothing and predicts the apply; the apply reaches the plan's verification; a second
 * apply changes nothing (idempotent); every apply writes exactly one `audit_logs` row.
 *
 * Isolation: the suite copies the tables it needs into its own schema (`CREATE TABLE … (LIKE public.… INCLUDING ALL)`:
 * columns, defaults, unique and partial indexes; the M4 enums stay in public) and runs every backfill in a transaction
 * with `SET LOCAL search_path = <schema>, public`, so the counts are exact even while other integration files write to
 * the same database. Skipped unless TEST_DATABASE_URL is set (a local Docker Postgres or the CI service; never Neon).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@repo/db";
import { isEntitled } from "../../lib/billing/entitlement-rules";
import { clerkHttpApi, runClerkOnboardedClaimsBackfill } from "./clerk-onboarded-claims";
import { runLinkedAccountsBackfill, type QueueImportDeps } from "./linked-accounts";
import { runOnboardingBackfill } from "./onboarding";
import { BATCH_SIZE, type BackfillDb } from "./p04-common";
import { runTrialLedgerBackfill, type LedgerHasher } from "./trial-ledger";

const url = process.env.TEST_DATABASE_URL;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const SCHEMA = `p04bf_${RUN}`;
const TABLES = ["users", "chess_com_profiles", "linked_accounts", "import_cursors", "import_runs", "trial_ledger", "audit_logs", "jobs"];
const N = 1_150;
const NOW = new Date("2026-11-12T10:00:00.000Z");

// ── The plan 8.4 hashes (WEB/lib/billing/trial-ledger.ts implements them; the CLI injects that module) ───────────
const PEPPER = "p04-backfill-int";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function normaliseEmail(e: string): string {
  const t = e.trim().toLowerCase();
  const at = t.lastIndexOf("@");
  let local = t.slice(0, at);
  let domain = t.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}
const HASHER: LedgerHasher = {
  emailHash: (e) => sha(`${PEPPER}\n${normaliseEmail(e)}`),
  handleHash: (p, u, v) => `${v ? "v:" : "u:"}${sha(`${PEPPER}\n${p}:${u}`)}`,
};

// ── The legacy data (plain SQL so the shape is visible) ────────────────────────────────────────────────────────
const SPECIAL = { gmailA: N - 3, gmailB: N - 2, lichess: N - 1, seed: N } as const;
const emailOf = (i: number) =>
  i === SPECIAL.gmailA ? `knight.owl.${RUN}+chess@gmail.com`
  : i === SPECIAL.gmailB ? `KnightOwl${RUN.toUpperCase()}@googlemail.com`
  : i === SPECIAL.lichess ? `sam-${RUN}@example.com`
  : `bf${i}-${RUN}@test.invalid`;
const isClerk = (i: number) => i % 50 !== 0;
const onboarded = (i: number) => i % 10 < 7;
const alreadyDone = (i: number) => onboarded(i) && i % 97 === 0;
const active = (i: number) => i % 113 !== 0;
const trial = (i: number) => i % 4 === 0 || i === SPECIAL.gmailA || i === SPECIAL.gmailB || i === SPECIAL.lichess;
const entitled = (i: number) => i % 8 === 0;
const lapsedSub = (i: number) => i % 8 === 4;
const hasProfile = (i: number) => i % 5 < 2;
const INVALID_HANDLE_USER = 5;
/** Clerk's view: 0 → the claim is there, 1 → metadata without it, 2 → Clerk does not know the user. */
const clerkState = (i: number) => i % 3;

const range = Array.from({ length: N }, (_, k) => k + 1);

async function seedLegacy(db: BackfillDb): Promise<Map<number, bigint>> {
  const rows = range.map((i) => ({
    i,
    email: emailOf(i),
    googleId: isClerk(i) ? `user_${RUN}_${i}` : `seed_legend_${RUN}_${i}`,
    onboarded: onboarded(i),
    step: alreadyDone(i) ? "DONE" : "WELCOME",
    onboardedAt: alreadyDone(i) ? "2026-11-01T00:00:00.000Z" : null,
    isActive: active(i),
    updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    trialStartedAt: trial(i) ? new Date(Date.UTC(2026, 5, 1) + i * 60_000).toISOString() : null,
    status: entitled(i) ? "active" : lapsedSub(i) ? "expired" : null,
    periodEnd: entitled(i) ? "2026-12-12T00:00:00.000Z" : lapsedSub(i) ? "2026-10-01T00:00:00.000Z" : null,
  }));
  const ids = await db.$queryRaw<{ email: string; id: bigint }[]>(Prisma.sql`
    INSERT INTO users ("referenceId", code, "googleId", email, name, onboarded, "onboardingStep", "onboardedAt", "isActive",
                       "updatedAt", "trialStartedAt", "subscriptionId", "subscriptionStatus", "currentPeriodEnd")
    SELECT 'c' || substr(md5(${RUN} || r.i::text), 1, 24), 'bf-' || ${RUN} || '-' || r.i, r."googleId", r.email, 'User ' || r.i,
           r.onboarded, r.step::"OnboardingStep", (r."onboardedAt" AT TIME ZONE 'UTC'), r."isActive", (r."updatedAt" AT TIME ZONE 'UTC'),
           (r."trialStartedAt" AT TIME ZONE 'UTC'), CASE WHEN r.status IS NULL THEN NULL ELSE 'sub_' || ${RUN} || '_' || r.i END,
           r.status, (r."periodEnd" AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(i int, email text, "googleId" text, onboarded boolean, step text,
           "onboardedAt" timestamptz, "isActive" boolean, "updatedAt" timestamptz, "trialStartedAt" timestamptz, status text,
           "periodEnd" timestamptz)
    RETURNING email, id`);
  const iOfEmail = new Map(rows.map((r) => [r.email, r.i]));
  const byI = new Map(ids.map((r) => [iOfEmail.get(r.email)!, r.id]));

  const profiles = range.filter(hasProfile).map((i) => {
    const shape = i % 3;
    return {
      userId: String(byI.get(i)),
      handle: i === INVALID_HANDLE_USER ? "bad handle" : `cc${i}_${RUN}`.slice(0, 25),
      displayName: shape === 0 ? `Player ${i}` : shape === 1 ? "   " : null,
      avatar: shape === 0 ? `https://images.chesscomfiles.com/u/${i}.png` : shape === 1 ? `http://old.example/${i}.png` : null,
      title: i % 41 === 0 ? "GM" : i % 43 === 0 ? "CANDIDATE" : null,
      country: shape === 0 ? "https://api.chess.com/pub/country/IN" : shape === 1 ? "us" : "Nowhere",
      rapid: shape === 2 ? null : 900 + i,
      rapidBest: shape === 0 ? 1000 + i : null,
      blitz: shape === 1 ? null : 800 + (i % 400),
      daily: shape === 0 ? 1500 : null,
      wins: shape === 2 ? null : i % 30,
    };
  });
  await db.$executeRaw(Prisma.sql`
    INSERT INTO chess_com_profiles ("referenceId", "userId", "chessComHandle", "displayName", avatar, title, country, joined,
        "rapidRating", "rapidBestRating", "rapidWins", "rapidLosses", "rapidDraws", "blitzRating", "blitzWins", "blitzLosses",
        "dailyRating", "dailyWins", "lastSyncedAt", "createdAt", "updatedAt")
    SELECT 'cp' || substr(md5(${RUN} || p."userId"), 1, 23), p."userId", p.handle, p."displayName", p.avatar, p.title, p.country,
           TIMESTAMP '2020-01-01', p.rapid, p."rapidBest", p.wins, 7, 2, p.blitz, p.wins, 3, p.daily, 1,
           TIMESTAMP '2025-06-01', TIMESTAMP '2025-06-01', TIMESTAMP '2025-06-01'
      FROM jsonb_to_recordset(${JSON.stringify(profiles)}::jsonb) AS p("userId" bigint, handle text, "displayName" text, avatar text,
           title text, country text, rapid int, "rapidBest" int, blitz int, daily int, wins int)`);

  // A v3 link already made by the new flow (verified Lichess): B5 leaves it alone, B9 puts its v: hash in the row.
  await db.$executeRaw(Prisma.sql`
    INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "lastSyncAt",
                                 "importedCount", "updatedAt")
    VALUES (${byI.get(SPECIAL.lichess)}, 'LICHESS', ${`li${RUN}`}, ${`Li${RUN}`}, ${`li${RUN}`}, TIMESTAMP '2026-11-01',
            TIMESTAMP '2026-11-01', 12, TIMESTAMP '2026-11-01')`);
  return byI;
}

// ── A fake Clerk Backend API ───────────────────────────────────────────────────────────────────────────────────
interface FakeClerk {
  server: Server;
  base: string;
  users: Map<string, Record<string, unknown>>;
  gets: number;
  patches: string[];
}

async function startClerk(): Promise<FakeClerk> {
  const fake: FakeClerk = { server: null as unknown as Server, base: "", users: new Map(), gets: 0, patches: [] };
  for (const i of range) {
    if (!isClerk(i) || clerkState(i) === 2) continue;
    fake.users.set(`user_${RUN}_${i}`, clerkState(i) === 0 ? { v: 1, onboarded: true, entitled: false } : { other: "kept" });
  }
  fake.server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://clerk.test");
    if (req.headers.authorization !== "Bearer sk_test_fake") {
      res.writeHead(401).end("[]");
      return;
    }
    if (req.method === "GET" && u.pathname === "/v1/users") {
      fake.gets++;
      const ids = u.searchParams.getAll("user_id");
      const limit = Number(u.searchParams.get("limit"));
      assert.ok(ids.length <= 100 && limit === ids.length, "lookups of at most 100 ids");
      const out = ids.filter((id) => fake.users.has(id)).map((id) => ({ id, public_metadata: fake.users.get(id) }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      return;
    }
    const m = /^\/v1\/users\/([^/]+)\/metadata$/.exec(u.pathname);
    if (req.method === "PATCH" && m) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const id = decodeURIComponent(m[1]!);
        const md = (JSON.parse(body) as { public_metadata: Record<string, unknown> }).public_metadata;
        fake.patches.push(id);
        fake.users.set(id, { ...(fake.users.get(id) ?? {}), ...md });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  fake.base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/v1`;
  return fake;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
let db: PrismaClient;

/** Runs `fn` in a transaction that sees only the suite's schema copy (then public for the enums). */
function inSchema<T>(fn: (tx: BackfillDb) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}", public`);
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

const count = (sql: Prisma.Sql) => inSchema(async (tx) => (await tx.$queryRaw<{ n: number }[]>(sql))[0]!.n);

async function auditRows(action: string) {
  return inSchema((tx) =>
    tx.$queryRaw<{ category: string; actorKind: string; targetId: string | null; meta: Record<string, unknown> }[]>(Prisma.sql`
      SELECT category::text AS category, "actorKind"::text AS "actorKind", "targetId", meta FROM audit_logs WHERE action = ${action} ORDER BY id`),
  );
}

/** The plan 8.5.4 release statement (WEB/lib/jobs/import.ts `releaseWaitingImports`, WP-C), here as the fake dep. */
async function releaseWaitingImportsSpec(tx: BackfillDb, userId: bigint) {
  const rows = await tx.$queryRaw<{ released: number; queued: number }[]>(Prisma.sql`
    WITH rel AS (
      UPDATE import_runs SET status = 'QUEUED', "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "userId" = ${userId} AND status = 'WAITING_FOR_MEMBERSHIP'
      RETURNING id, "linkedAccountId", trigger),
    acc AS (
      UPDATE linked_accounts SET "importState" = 'QUEUED', "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id IN (SELECT "linkedAccountId" FROM rel) RETURNING id),
    j AS (
      INSERT INTO jobs (kind, status, priority, "dedupeKey", "userId", payload, "runAt", "createdAt")
      SELECT 'IMPORT_SYNC', 'QUEUED', 60, 'import:' || rel."linkedAccountId", ${userId},
             jsonb_build_object('v', 1, 'linkedAccountId', rel."linkedAccountId"::text, 'runId', rel.id::text, 'trigger', rel.trigger),
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      FROM rel
      ON CONFLICT ("dedupeKey") DO UPDATE SET status = 'QUEUED', "runAt" = EXCLUDED."runAt", priority = EXCLUDED.priority,
         payload = EXCLUDED.payload, attempts = 0 WHERE jobs.status <> 'RUNNING'
      RETURNING id)
    SELECT (SELECT count(*)::int FROM rel) AS released, (SELECT count(*)::int FROM j) AS queued`);
  return rows[0]!;
}

describe("P4 backfills (Postgres, realistic legacy rows)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let byI: Map<number, bigint>;
  let clerk: FakeClerk;
  const expected = {
    onboardingMatched: range.filter((i) => onboarded(i) && !alreadyDone(i)).length,
    profiles: range.filter(hasProfile).length,
    validProfiles: range.filter((i) => hasProfile(i) && i !== INVALID_HANDLE_USER).length,
    entitledLinked: range.filter((i) => hasProfile(i) && i !== INVALID_HANDLE_USER && entitled(i)).length,
    trialUsers: range.filter(trial).length,
    clerkToUpdate: range.filter((i) => onboarded(i) && active(i) && isClerk(i) && clerkState(i) === 1).length,
    clerkClaimed: range.filter((i) => onboarded(i) && active(i) && isClerk(i) && clerkState(i) === 0).length,
    clerkMissing: range.filter((i) => onboarded(i) && active(i) && isClerk(i) && clerkState(i) === 2).length,
    notClerk: range.filter((i) => onboarded(i) && active(i) && !isClerk(i)).length,
  };

  before(async () => {
    assert.ok(LOCAL.has(new URL(url!).hostname), "local Postgres only");
    db = new PrismaClient({ datasourceUrl: url });
    await db.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
    for (const t of TABLES) await db.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."${t}" (LIKE public."${t}" INCLUDING ALL)`);
    byI = await inSchema((tx) => seedLegacy(tx));
    clerk = await startClerk();
    assert.ok(expected.onboardingMatched > BATCH_SIZE, "B6 and B12 span more than one keyset batch of 500");
  });

  after(async () => {
    clerk?.server.close();
    if (db) {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await db.$disconnect();
    }
  });

  it("B6 onboarding: dry run, apply to 0 remaining, idempotent rerun, one audit row per apply", async () => {
    const dry = await inSchema((tx) => runOnboardingBackfill(tx, { apply: false }));
    assert.deepEqual([dry.matched, dry.updated, dry.remaining], [expected.onboardingMatched, 0, expected.onboardingMatched]);
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM users WHERE "onboardingStep" = 'DONE'`), range.filter(alreadyDone).length);

    const first = await inSchema((tx) => runOnboardingBackfill(tx, { apply: true }));
    assert.deepEqual([first.matched, first.updated, first.remaining, first.batches], [expected.onboardingMatched, expected.onboardingMatched, 0, 2]);
    const wrong = await count(Prisma.sql`
      SELECT count(*)::int AS n FROM users
       WHERE onboarded AND ("onboardingStep" <> 'DONE' OR "onboardedAt" IS NULL
             OR ("onboardedAt" <> "updatedAt" AND "onboardedAt" <> TIMESTAMP '2026-11-01'))`);
    assert.equal(wrong, 0, "onboardedAt = updatedAt; an existing onboardedAt is kept");
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM users WHERE NOT onboarded AND "onboardingStep" <> 'WELCOME'`), 0);

    const second = await inSchema((tx) => runOnboardingBackfill(tx, { apply: true }));
    assert.deepEqual([second.matched, second.updated, second.remaining], [0, 0, 0]);
    const audits = await auditRows("backfill.onboarding");
    assert.equal(audits.length, 2);
    assert.deepEqual(
      audits.map((a) => [a.category, a.actorKind, a.targetId, a.meta.updated]),
      [
        ["SYSTEM", "SYSTEM", "onboarding", expected.onboardingMatched],
        ["SYSTEM", "SYSTEM", "onboarding", 0],
      ],
    );
  });

  it("B5 linked accounts (+ --queue-imports): one link and cursor per valid profile, runs released for entitled users", async () => {
    const released: bigint[] = [];
    let kicks = 0;
    const sleeps: number[] = [];
    const deps: QueueImportDeps = {
      releaseWaitingImports: async (tx, userId) => {
        released.push(userId);
        return releaseWaitingImportsSpec(tx, userId);
      },
      kickImports: async () => void kicks++,
      isEntitled: (row, now) => isEntitled(row, now),
      sleep: async (ms) => void sleeps.push(ms),
      now: () => NOW,
    };

    const dry = await inSchema((tx) => runLinkedAccountsBackfill(tx, { apply: false, queueImports: true, deps }));
    assert.equal(dry.unlinkedBefore, expected.profiles);
    assert.equal(dry.linked, expected.validProfiles);
    assert.equal(dry.skipped.invalid_handle, 1);
    assert.deepEqual([dry.queue!.runs, dry.queue!.entitledUsers, dry.queue!.released], [expected.validProfiles, expected.entitledLinked, 0]);
    assert.equal(released.length, 0, "a dry run releases nothing");
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM linked_accounts WHERE provider = 'CHESSCOM'`), 0);

    const first = await inSchema((tx) => runLinkedAccountsBackfill(tx, { apply: true, queueImports: true, deps }));
    assert.deepEqual(
      [first.linked, first.cursors, first.unlinkedAfter, first.skipped.invalid_handle],
      [expected.validProfiles, expected.validProfiles, 1, 1],
    );
    assert.deepEqual([first.queue!.runs, first.queue!.entitledUsers, first.queue!.released, first.queue!.jobs], [
      expected.validProfiles,
      expected.entitledLinked,
      expected.entitledLinked,
      expected.entitledLinked,
    ]);
    assert.equal(kicks, expected.entitledLinked);
    assert.equal(sleeps.length, expected.entitledLinked - 1, "one user per second");
    assert.ok(sleeps.every((ms) => ms === 1_000));

    // One sample per profile shape.
    const sample = await inSchema((tx) =>
      tx.$queryRaw<{ i: number; username: string; externalId: string; displayName: string | null; avatarUrl: string | null; countryCode: string | null; ratings: unknown; total: number | null; verified: boolean; state: string; run: string | null }[]>(Prisma.sql`
        SELECT (regexp_match(la.username, '^cc(\\d+)_'))[1]::int AS i, la.username, la."externalId", la."displayName", la."avatarUrl",
               la."countryCode", la.ratings, la."totalRatedGames" AS total, la."verifiedAt" IS NOT NULL AS verified,
               la."importState"::text AS state, r.status::text AS run
          FROM linked_accounts la LEFT JOIN import_runs r ON r."linkedAccountId" = la.id
         WHERE la.provider = 'CHESSCOM' AND la.username IN (${`cc15_${RUN}`.slice(0, 25)}, ${`cc16_${RUN}`.slice(0, 25)}, ${`cc11_${RUN}`.slice(0, 25)}, ${`cc40_${RUN}`.slice(0, 25)})
         ORDER BY i`),
    );
    const s = Object.fromEntries(sample.map((r) => [r.i, r]));
    assert.deepEqual(s[15], {
      i: 15, username: `cc15_${RUN}`.slice(0, 25), externalId: `cc15_${RUN}`.slice(0, 25).toLowerCase(), displayName: "Player 15",
      avatarUrl: "https://images.chesscomfiles.com/u/15.png", countryCode: "IN",
      ratings: { v: 1, rapid: { rating: 915, best: 1015, games: 24 }, blitz: { rating: 815, best: null, games: 18 }, daily: { rating: 1500, best: null, games: 1 } },
      total: 43, verified: false, state: "WAITING_FOR_MEMBERSHIP", run: "WAITING_FOR_MEMBERSHIP",
    });
    assert.deepEqual([s[16]!.displayName, s[16]!.avatarUrl, s[16]!.countryCode, s[16]!.ratings, s[16]!.total], [
      null, null, "US", { v: 1, rapid: { rating: 916, best: null, games: 25 } }, 25,
    ]);
    assert.deepEqual([s[11]!.countryCode, s[11]!.ratings, s[11]!.total], [null, { v: 1, blitz: { rating: 811, best: null, games: 3 } }, 3]);
    assert.deepEqual([s[40]!.state, s[40]!.run], ["QUEUED", "QUEUED"], "entitled user: released");
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM jobs WHERE kind = 'IMPORT_SYNC' AND status = 'QUEUED'`), expected.entitledLinked);
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM linked_accounts WHERE provider = 'LICHESS' AND "importState" = 'IDLE'`), 1, "the v3 link is untouched");

    released.length = 0;
    const second = await inSchema((tx) => runLinkedAccountsBackfill(tx, { apply: true, queueImports: true, deps }));
    assert.deepEqual([second.unlinkedBefore, second.linked, second.cursors, second.unlinkedAfter], [1, 0, 0, 1]);
    assert.deepEqual([second.queue!.runs, second.queue!.entitledUsers, second.queue!.released], [0, 0, 0]);
    assert.equal(released.length, 0);
    assert.ok(second.queue!.waitingUsers > 0, "non-members keep waiting for the fan-out");
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM import_runs`), expected.validProfiles);

    const audits = await auditRows("backfill.linked_accounts");
    assert.deepEqual(audits.map((a) => [a.meta.linked, a.meta.runs, a.meta.released]), [
      [expected.validProfiles, expected.validProfiles, expected.entitledLinked],
      [0, 0, 0],
    ]);
  });

  it("B9 trial ledger: one row per normalised email with the users' handles, idempotent", async () => {
    const dry = await inSchema((tx) => runTrialLedgerBackfill(tx, { apply: false, hasher: HASHER }));
    assert.equal(dry.trialUsers, expected.trialUsers);
    assert.equal(dry.addresses, expected.trialUsers - 1, "the two gmail spellings share one row");
    assert.deepEqual([dry.missingBefore, dry.inserted], [expected.trialUsers - 1, 0]);
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM trial_ledger`), 0);

    const first = await inSchema((tx) => runTrialLedgerBackfill(tx, { apply: true, hasher: HASHER }));
    assert.deepEqual([first.inserted, first.missingAfter], [expected.trialUsers - 1, 0]);
    assert.equal(first.withHandles, range.filter((i) => trial(i) && ((hasProfile(i) && i !== INVALID_HANDLE_USER) || i === SPECIAL.lichess)).length);

    const rows = await inSchema((tx) =>
      tx.$queryRaw<{ h: string; handles: string[]; first: Date }[]>(Prisma.sql`
        SELECT "emailHash" AS h, "handleHashes" AS handles, ("firstTrialAt" AT TIME ZONE 'UTC') AS first FROM trial_ledger
         WHERE "emailHash" IN (${HASHER.emailHash(emailOf(SPECIAL.gmailA))}, ${HASHER.emailHash(emailOf(SPECIAL.lichess))},
                               ${HASHER.emailHash(emailOf(8))})`),
    );
    const byHash = new Map(rows.map((r) => [r.h, r]));
    assert.equal(HASHER.emailHash(emailOf(SPECIAL.gmailA)), HASHER.emailHash(emailOf(SPECIAL.gmailB)));
    assert.equal(
      byHash.get(HASHER.emailHash(emailOf(SPECIAL.gmailA)))!.first.getTime(),
      Date.UTC(2026, 5, 1) + SPECIAL.gmailA * 60_000,
      "the earlier of the two trials",
    );
    assert.deepEqual(byHash.get(HASHER.emailHash(emailOf(SPECIAL.lichess)))!.handles, [HASHER.handleHash("lichess", `li${RUN}`, true)]);
    assert.deepEqual(byHash.get(HASHER.emailHash(emailOf(8)))!.handles, [], "user 8 has no profile");
    const withCc = range.find((i) => trial(i) && hasProfile(i) && i !== INVALID_HANDLE_USER)!;
    const [cc] = await inSchema((tx) =>
      tx.$queryRaw<{ handles: string[] }[]>(Prisma.sql`
        SELECT "handleHashes" AS handles FROM trial_ledger WHERE "emailHash" = ${HASHER.emailHash(emailOf(withCc))}`),
    );
    assert.deepEqual(cc!.handles, [HASHER.handleHash("chesscom", `cc${withCc}_${RUN}`.slice(0, 25).toLowerCase(), false)]);
    for (const r of rows) {
      assert.match(r.h, /^[0-9a-f]{64}$/, "only hashes: no email in the ledger");
      for (const h of r.handles) assert.match(h, /^[uv]:[0-9a-f]{64}$/, "only hashes: no handle in the ledger");
    }

    const second = await inSchema((tx) => runTrialLedgerBackfill(tx, { apply: true, hasher: HASHER }));
    assert.deepEqual([second.missingBefore, second.inserted, second.missingAfter], [0, 0, 0]);
    const audits = await auditRows("backfill.trial_ledger");
    assert.deepEqual(audits.map((a) => [a.meta.inserted, a.meta.missingAfter]), [[expected.trialUsers - 1, 0], [0, 0]]);
    assert.ok(audits.every((a) => !JSON.stringify(a.meta).includes("@")));
  });

  it("B12 Clerk claims: the dry run only reads; the apply merges the claim where missing; the rerun writes nothing", async () => {
    const api = clerkHttpApi({ key: "sk_test_fake", baseUrl: clerk.base, spacingMs: 0 });
    const dry = await inSchema((tx) => runClerkOnboardedClaimsBackfill(tx, { apply: false, clerk: api, now: NOW }));
    const onboardedUsers = range.filter((i) => onboarded(i) && active(i)).length;
    assert.deepEqual(
      [dry.onboardedUsers, dry.notClerk, dry.alreadyClaimed, dry.missingInClerk, dry.toUpdate, dry.updated],
      [onboardedUsers, expected.notClerk, expected.clerkClaimed, expected.clerkMissing, expected.clerkToUpdate, 0],
    );
    assert.equal(clerk.patches.length, 0);
    assert.ok(clerk.gets >= 3);

    const first = await inSchema((tx) => runClerkOnboardedClaimsBackfill(tx, { apply: true, clerk: api, now: NOW }));
    assert.deepEqual([first.toUpdate, first.updated, first.failed], [expected.clerkToUpdate, expected.clerkToUpdate, 0]);
    assert.equal(clerk.patches.length, expected.clerkToUpdate);
    const sampleI = range.find((i) => onboarded(i) && active(i) && isClerk(i) && clerkState(i) === 1 && entitled(i))!;
    assert.deepEqual(clerk.users.get(`user_${RUN}_${sampleI}`), {
      other: "kept",
      v: 1,
      onboarded: true,
      entitled: true,
      lapsed: false,
      trialUsed: true,
      role: "USER",
    });
    const notOnboarded = range.find((i) => !onboarded(i) && isClerk(i) && clerkState(i) === 1)!;
    assert.deepEqual(clerk.users.get(`user_${RUN}_${notOnboarded}`), { other: "kept" }, "users who never onboarded are not touched");

    const second = await inSchema((tx) => runClerkOnboardedClaimsBackfill(tx, { apply: true, clerk: api, now: NOW }));
    assert.deepEqual([second.toUpdate, second.updated, second.alreadyClaimed], [0, 0, expected.clerkClaimed + expected.clerkToUpdate]);
    assert.equal(clerk.patches.length, expected.clerkToUpdate);
    const audits = await auditRows("backfill.clerk_onboarded_claims");
    assert.deepEqual(audits.map((a) => [a.meta.updated, a.meta.toUpdate]), [[expected.clerkToUpdate, expected.clerkToUpdate], [0, 0]]);
  });

  it("dry runs wrote no audit row; byI covers every seeded user", async () => {
    assert.equal(byI.size, N);
    assert.equal(await count(Prisma.sql`SELECT count(*)::int AS n FROM audit_logs`), 8, "four backfills × two applies");
  });
});
