/**
 * The Phase 4 persona writers on a real Postgres after `prisma migrate deploy` (phase-04 plan 6.7; testing X4).
 * Skipped unless TEST_DATABASE_URL is set (a local Docker Postgres or the CI service; never Neon).
 *
 *   - every persona of plan 6.7 lands in the state it names (users columns, links, view status, runs, cursors, games);
 *   - a reset is exact: moving a pool user between personas leaves nothing of the previous one (links, cursors, runs,
 *     imported games, queued jobs, trial-ledger rows by email and by handle) and keeps the user's Replay games;
 *   - applying the same persona twice gives the same rows; two users can hold the same persona at once;
 *   - shared e2e letters are refused before any write.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { expectedLinkViewStatus, P04_PERSONA_STATES, type P04PersonaState } from "../seed/p04-persona-states";
import { clearP04State, fixtureGames, writeP04Persona, type LedgerKeys } from "../seed/p04-personas";
import { TEST_URL, assertLocalTestUrl, makeUser } from "./helpers";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const PEPPER = "p4-persona-int-pepper";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The plan 8.4 hashes (WEB/lib/billing/trial-ledger.ts implements the same rules; injected by the persona tool). */
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
const LEDGER: LedgerKeys = {
  emailHash: (e) => sha(`${PEPPER}\n${normaliseEmail(e)}`),
  handleHash: (p, u, v) => `${v ? "v:" : "u:"}${sha(`${PEPPER}\n${p}:${u}`)}`,
};
const OPTS = { now: NOW, ledger: LEDGER };

/**
 * One name per distinct state (a pool alias without overrides is the same object graph as its seed persona, unit
 * test p04-personas.test.ts): the pool names where they exist, so the registered names are the ones exercised. Fewer
 * writes also keep `game_players` churn low for the suites that EXPLAIN against the same database.
 */
const DISTINCT_STATES = [
  "onboarding-fresh",
  "new",
  "onboarding-plan",
  "onboarding-trial-used",
  "import-trial",
  "connected-both",
  "connected-syncfailed",
  "connected-privategames",
  "connected-none-member",
  "connected-nonmember",
] as const;

const CC_GAMES = fixtureGames("chesscom-knightowl_88").length;
const LI_GAMES = fixtureGames("lichess-knightowl88").length;

async function emailOf(db: PrismaClient, id: bigint): Promise<string> {
  const rows = await db.$queryRaw<{ email: string }[]>(Prisma.sql`SELECT email FROM users WHERE id = ${id}`);
  return rows[0]!.email;
}

interface LinkRow {
  id: bigint;
  provider: string;
  username: string;
  externalId: string;
  status: "ACTIVE" | "ERROR";
  importState: "IDLE" | "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "RATE_LIMITED" | "FAILED";
  importedCount: number;
  skippedCount: number;
  verified: boolean;
  nextAllowedSyncAt: Date | null;
  lastError: { code: string } | null;
  ratings: Record<string, unknown>;
  runStatus: string | null;
  runPhase: string | null;
  runImported: number | null;
  runTotal: number | null;
  runFirstGame: boolean | null;
  runError: { code: string } | null;
  cursorSeen: number | null;
  games: number;
}

async function snapshot(db: PrismaClient, userId: bigint) {
  const [user] = await db.$queryRaw<
    {
      onboarded: boolean;
      step: string;
      onboardedAt: Date | null;
      band: string | null;
      bandSource: string | null;
      goals: string[];
      minutes: number | null;
      tz: string;
      status: string | null;
      trialStartedAt: Date | null;
      subscriptionId: string | null;
      dodo: string | null;
      pending: Date | null;
      version: number;
    }[]
  >(Prisma.sql`
    SELECT onboarded, "onboardingStep"::text AS step, ("onboardedAt" AT TIME ZONE 'UTC') AS "onboardedAt", "ratingBand"::text AS band,
           "ratingBandSource" AS "bandSource", goals::text[] AS goals, "dailyMinutes" AS minutes, "timeZone" AS tz,
           "subscriptionStatus" AS status, ("trialStartedAt" AT TIME ZONE 'UTC') AS "trialStartedAt", "subscriptionId",
           "dodoCustomerId" AS dodo, "pendingCheckoutAt" AS pending, "gamesVersion" AS version
      FROM users WHERE id = ${userId}`);
  const links = await db.$queryRaw<LinkRow[]>(Prisma.sql`
    SELECT la.id, la.provider::text AS provider, la.username, la."externalId", la.status::text AS status,
           la."importState"::text AS "importState", la."importedCount", la."skippedCount", la."verifiedAt" IS NOT NULL AS verified,
           (la."nextAllowedSyncAt" AT TIME ZONE 'UTC') AS "nextAllowedSyncAt", la."lastError", la.ratings,
           r.status::text AS "runStatus", r.phase AS "runPhase", r.imported AS "runImported", r.total AS "runTotal",
           r."firstGameId" IS NOT NULL AS "runFirstGame", r.error AS "runError", c.seen AS "cursorSeen",
           (SELECT count(*)::int FROM game_players gp WHERE gp."linkedAccountId" = la.id) AS games
      FROM linked_accounts la
      LEFT JOIN import_runs r ON r."linkedAccountId" = la.id
      LEFT JOIN import_cursors c ON c."linkedAccountId" = la.id
     WHERE la."userId" = ${userId}
     ORDER BY la.provider`);
  const [counts] = await db.$queryRaw<{ imported: number; replay: number; runs: number; queued: number }[]>(Prisma.sql`
    SELECT (SELECT count(*)::int FROM game_players WHERE "userId" = ${userId} AND source <> 'REPLAY') AS imported,
           (SELECT count(*)::int FROM game_players WHERE "userId" = ${userId} AND source = 'REPLAY') AS replay,
           (SELECT count(*)::int FROM import_runs WHERE "userId" = ${userId}) AS runs,
           (SELECT count(*)::int FROM jobs WHERE "userId" = ${userId} AND status = 'QUEUED') AS queued`);
  return { user: user!, links, counts: counts! };
}

async function ledgerRows(db: PrismaClient, hashes: { email: string; handles: string[] }) {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM trial_ledger WHERE "emailHash" = ${hashes.email} OR "handleHashes" && ${hashes.handles}::text[]`);
  return rows[0]!.n;
}

async function replayGame(db: PrismaClient, userId: bigint, tag: string): Promise<bigint> {
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
    INSERT INTO games ("referenceId", "creatorId", status, "startingFen", "initialTimeSeconds", "incrementSeconds",
                       "creatorTimeRemaining", "opponentTimeRemaining", "expiresAt", "updatedAt", mode, "whitePlayerId",
                       "plyCount", "completedAt")
    VALUES (${`cr${tag}`.padEnd(25, "0").slice(0, 25)}, ${userId}, 'COMPLETED',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 600, 0, 0, 0, now(), now(), 'BOT', ${userId}, 20, now())
    RETURNING id`);
  const id = rows[0]!.id;
  await db.$executeRaw(Prisma.sql`
    INSERT INTO game_players ("gameId", "userId", color, mode, source, "endedAt", "updatedAt")
    VALUES (${id}, ${userId}, 'w', 'BOT', 'REPLAY', now(), now())`);
  return id;
}

describe("P4 persona writers (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;

  before(() => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
  });
  after(async () => {
    await db?.$disconnect();
  });

  /**
   * After a test's writes: refresh the planner statistics of the tables it churned (what autovacuum does later), so a
   * concurrent suite that EXPLAINs against the same database (test/seeds.int.test.ts, the P3 hot-query gates) never
   * plans on stale page counts.
   */
  async function settle() {
    await db.$executeRawUnsafe("ANALYZE games, game_players, linked_accounts, import_runs");
  }

  it("every persona lands in the state of plan 6.7", async () => {
    const u = await makeUser(db, "p4persona");
    const email = await emailOf(db, u.id);
    const covered = new Set(DISTINCT_STATES.map((n) => P04_PERSONA_STATES[n]!.seed));
    assert.deepEqual([...covered].sort(), ["member", "new", "onbplan", "onbused", "privategames", "syncfailed", "trial"], "every seed state");
    for (const name of DISTINCT_STATES) {
      const state: P04PersonaState = P04_PERSONA_STATES[name]!;
      const report = await writeP04Persona(db, email, name, OPTS);
      const s = await snapshot(db, u.id);
      const specLinks = state.links(NOW);
      const o = state.onboarding;
      const b = state.billing(NOW);

      assert.equal(s.user.step, o.step, name);
      assert.equal(s.user.onboarded, o.step === "DONE", name);
      assert.equal(s.user.onboardedAt === null, o.step !== "DONE", name);
      assert.equal(s.user.band, o.ratingBand, name);
      assert.equal(s.user.bandSource, o.ratingBandSource, name);
      assert.deepEqual(s.user.goals, [...o.goals], name);
      assert.equal(s.user.minutes, o.dailyMinutes, name);
      assert.equal(s.user.tz, o.timeZone, name);
      assert.equal(s.user.status, b.subscriptionStatus, name);
      assert.equal(s.user.subscriptionId === null, !b.hasSubscription, name);
      assert.equal(s.user.trialStartedAt?.getTime() ?? null, b.trialStartedAt?.getTime() ?? null, name);
      assert.equal(s.user.dodo, null, name);
      assert.equal(s.user.pending, null, name);

      assert.equal(s.links.length, specLinks.length, name);
      assert.equal(s.counts.runs, specLinks.filter((l) => l.run).length, name);
      assert.equal(s.counts.queued, 0, `${name}: the seed creates no job`);
      let gamesExpected = 0;
      for (const spec of specLinks) {
        const row = s.links.find((l) => l.provider === spec.provider)!;
        assert.ok(row, `${name} ${spec.provider}`);
        assert.equal(row.username, spec.username);
        assert.ok(row.externalId.startsWith("p4seed:"), "never the fixture account's real id");
        assert.equal(row.verified, spec.verified);
        assert.equal(row.importedCount, spec.importedCount);
        assert.equal(row.skippedCount, spec.skippedCount);
        assert.equal(row.ratings.v, 1);
        assert.equal(row.lastError?.code ?? null, spec.lastError?.code ?? null);
        assert.equal(
          expectedLinkViewStatus(row, row.nextAllowedSyncAt, NOW),
          expectedLinkViewStatus(spec, spec.nextAllowedSyncInSec === null ? null : new Date(NOW.getTime() + spec.nextAllowedSyncInSec * 1000), NOW),
          `${name} ${spec.provider} view status`,
        );
        assert.equal(row.runStatus, spec.run?.status ?? null);
        assert.equal(row.runPhase, spec.run?.phase ?? null);
        assert.equal(row.runImported, spec.run?.imported ?? null);
        assert.equal(row.runTotal, spec.run?.total ?? null);
        assert.equal(row.runError?.code ?? null, spec.run?.error?.code ?? null);
        const games = spec.games === null ? 0 : spec.games === "chesscom-knightowl_88" ? CC_GAMES : LI_GAMES;
        assert.equal(row.games, games, `${name} ${spec.provider} games`);
        assert.equal(row.cursorSeen, games);
        if (spec.run && games > 0) assert.equal(row.runFirstGame, true, "the run points at the newest game");
        gamesExpected += games;
      }
      assert.equal(s.counts.imported, gamesExpected, `${name}: imported game rows`);
      assert.deepEqual(
        report.links.map((l) => [l.provider, l.games]),
        specLinks.map((l) => [l.provider, l.games === null ? 0 : l.games === "chesscom-knightowl_88" ? CC_GAMES : LI_GAMES]),
      );
    }
    await settle();
  });

  it("the plan's Connected and Done states come out of the persona rows", async () => {
    const u = await makeUser(db, "p4states");
    const email = await emailOf(db, u.id);
    const view = async (name: string) => {
      await writeP04Persona(db, email, name, OPTS);
      const s = await snapshot(db, u.id);
      return s.links.map((l) => `${l.provider}:${expectedLinkViewStatus(l, l.nextAllowedSyncAt, NOW)}:${l.runStatus}`);
    };
    // The game-bearing personas were written in the test above; here their rows are read back as board states.
    assert.deepEqual(await view("connected-syncfailed"), ["CHESSCOM:error:FAILED", "LICHESS:rate_limited:DONE"]);
    assert.deepEqual(await view("onboarding-plan"), ["CHESSCOM:waiting_for_membership:WAITING_FOR_MEMBERSHIP"]);
    assert.deepEqual(await view("connected-none-member"), []);
    assert.deepEqual(await view("onboarding-fresh"), []);
    const fresh = await snapshot(db, u.id);
    assert.deepEqual([fresh.user.step, fresh.user.onboarded, fresh.user.tz, fresh.user.status], ["WELCOME", false, "UTC", null]);
    await settle();
  });

  it("a reset is exact: nothing of the previous persona survives, Replay games stay", async () => {
    const u = await makeUser(db, "p4reset");
    const email = await emailOf(db, u.id);
    const replay = await replayGame(db, u.id, `p4r${u.id}`);
    await writeP04Persona(db, email, "connected-both", OPTS);
    const before = await snapshot(db, u.id);
    assert.equal(before.counts.imported, CC_GAMES + LI_GAMES);
    const linkIds = before.links.map((l) => l.id);

    // What a spec leaves behind: a queued import job, a queued analysis, a ledger row from a trial (email + handles).
    await db.$executeRaw(Prisma.sql`
      INSERT INTO jobs (kind, status, priority, "dedupeKey", "userId", payload, "runAt", "createdAt")
      VALUES ('IMPORT_SYNC', 'QUEUED', 100, ${`import:${linkIds[0]}`}, ${u.id},
              ${JSON.stringify({ v: 1, linkedAccountId: String(linkIds[0]), runId: null, trigger: "MANUAL" })}::jsonb, now(), now())`);
    const handles = [LEDGER.handleHash("lichess", "knightowl88", true), LEDGER.handleHash("chesscom", "knightowl_88", false)];
    await db.$executeRaw(Prisma.sql`
      INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES (${LEDGER.emailHash(email)}, ${handles}::text[])`);
    const elsewhere = sha(`another-user-${u.id}`);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO trial_ledger ("emailHash", "handleHashes") VALUES (${elsewhere}, ${[LEDGER.handleHash("lichess", "knightowl88", true)]}::text[])`);

    const report = await writeP04Persona(db, email, "onboarding-fresh", OPTS);
    assert.deepEqual(
      [report.cleared.links, report.cleared.purgedGames, report.cleared.jobs, report.cleared.ledgerRows],
      [2, CC_GAMES + LI_GAMES, 1, 2],
    );
    const s = await snapshot(db, u.id);
    assert.deepEqual([s.links.length, s.counts.imported, s.counts.runs, s.counts.queued, s.counts.replay], [0, 0, 0, 0, 1]);
    const [orphans] = await db.$queryRaw<{ cursors: number; games: number }[]>(Prisma.sql`
      SELECT (SELECT count(*)::int FROM import_cursors WHERE "linkedAccountId" = ANY(${linkIds}::bigint[])) AS cursors,
             (SELECT count(*)::int FROM games WHERE "creatorId" = ${u.id} AND source <> 'REPLAY') AS games`);
    assert.deepEqual(orphans, { cursors: 0, games: 0 });
    assert.equal(await ledgerRows(db, { email: LEDGER.emailHash(email), handles }), 0, "trial eligible again");
    const [kept] = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM games WHERE id = ${replay}`);
    assert.equal(kept!.n, 1);
    assert.ok(s.user.version > before.user.version, "gamesVersion bumped (archive ETag)");
    await settle();
  });

  it("onbused writes the user's own ledger row; the next reset removes it", async () => {
    const u = await makeUser(db, "p4ledger");
    const email = await emailOf(db, u.id);
    const keys = { email: LEDGER.emailHash(email), handles: [] as string[] };
    await writeP04Persona(db, email, "onboarding-trial-used", OPTS);
    assert.equal(await ledgerRows(db, keys), 1);
    const [row] = await db.$queryRaw<{ first: Date }[]>(Prisma.sql`
      SELECT ("firstTrialAt" AT TIME ZONE 'UTC') AS first FROM trial_ledger WHERE "emailHash" = ${keys.email}`);
    assert.equal(row!.first.getTime(), NOW.getTime() - 60 * 86_400_000);
    await writeP04Persona(db, email, "onboarding-plan", OPTS);
    assert.equal(await ledgerRows(db, keys), 0);
  });

  it("is idempotent, and two users can hold the same persona at once", async () => {
    const a = await makeUser(db, "p4twice");
    const b = await makeUser(db, "p4twice");
    const ea = await emailOf(db, a.id);
    const eb = await emailOf(db, b.id);
    const first = await writeP04Persona(db, ea, "connected-both", OPTS);
    const second = await writeP04Persona(db, ea, "connected-both", OPTS);
    assert.deepEqual(
      second.links.map((l) => [l.provider, l.runRef, l.games, l.firstGameRef]),
      first.links.map((l) => [l.provider, l.runRef, l.games, l.firstGameRef]),
      "same refs and counts",
    );
    assert.equal(second.cleared.purgedGames, CC_GAMES + LI_GAMES);
    await writeP04Persona(db, eb, "connected-both", OPTS);
    const sa = await snapshot(db, a.id);
    const sb = await snapshot(db, b.id);
    assert.equal(sa.counts.imported, CC_GAMES + LI_GAMES);
    assert.equal(sb.counts.imported, CC_GAMES + LI_GAMES);
    assert.equal(sa.links.filter((l) => l.verified).length, 1);
    assert.equal(sb.links.filter((l) => l.verified).length, 1);
    // Leave nothing behind: the next suites see an archive-sized game_players again.
    await clearP04State(db, ea, OPTS);
    await clearP04State(db, eb, OPTS);
    await settle();
  });

  it("clearP04State removes the P4 rows and leaves the columns", async () => {
    const u = await makeUser(db, "p4clear");
    const email = await emailOf(db, u.id);
    await writeP04Persona(db, email, "import-trial", OPTS);
    const cleared = await clearP04State(db, email, OPTS);
    assert.deepEqual([cleared.links, cleared.purgedGames], [1, CC_GAMES]);
    const s = await snapshot(db, u.id);
    assert.deepEqual([s.links.length, s.counts.imported, s.counts.runs], [0, 0, 0]);
    assert.equal(s.user.step, "DONE", "columns are the next persona's business");
    await settle();
  });

  it("refuses the shared e2e letters and unknown users before writing", async () => {
    await assert.rejects(writeP04Persona(db, "e2e-playera+clerk_test@chessbattle.dev", "connected-both", OPTS), /shared e2e user/);
    await assert.rejects(clearP04State(db, "E2E-PLAYERR+clerk_test@chessbattle.dev", OPTS), /shared e2e user/);
    await assert.rejects(writeP04Persona(db, "nobody-p4@test.invalid", "connected-both", OPTS), /no users row/);
    await assert.rejects(writeP04Persona(db, "nobody-p4@test.invalid", "no-such-persona", OPTS), /unknown P4 persona/);
  });
});
