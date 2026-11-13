/**
 * API contract of the P4 accounts and import routes ACC-1…ACC-8 and OAU-1/2 against a real Postgres after
 * `prisma migrate deploy` (phase-04 plan §12.3, §11.1, §8.15). Every 2xx body parses with its CT schema; every error
 * has the envelope, its code's status and a known conflict reason. The Lichess callback is driven through every path,
 * and on every path that obtained a token the fake Lichess records exactly one `DELETE /api/token` with that token,
 * and the token appears in no row (D4-21). Plus: the job and run rows each write leaves (priorities from JOB_PRIORITY),
 * idempotent link replays, the release of waiting runs (§8.5.4, re-sent safely), the kick CAS of ACC-7 (ten parallel
 * GETs → one kick), the flag gate, the scoped limits and the import-prune task.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { AccountsData, LinkData, LinkedAccountView, LookupData, SyncData, UnlinkData } from "@repo/contracts/http/accounts";
import { CONFLICT_REASONS } from "@repo/contracts/http/codes";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { ImportStatusData, RetryImportData } from "@repo/contracts/http/import";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { jsonOf } from "../helpers/route-harness";
import { accountsWorld, CC_HANDLE, CC_PROFILE, LI_ACCOUNT, SECRET, type Handlers } from "./accounts-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

async function errorOf(res: Response, status: number, code: string) {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = ErrorEnvelope.parse(await jsonOf(res));
  assert.equal(body.error.code, code);
  assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  const reason = (body.error.details as { reason?: string } | undefined)?.reason;
  if (code === "conflict") assert.ok((CONFLICT_REASONS as readonly string[]).includes(reason ?? ""), `conflict reason ${reason}`);
  return { reason, details: body.error.details as Record<string, unknown> | undefined, retryAfterSec: body.error.retryAfterSec };
}

const uuid = () => globalThis.crypto.randomUUID();

describe("P4 accounts and import routes: contract (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = accountsWorld(url ?? "");
  const H = {} as Record<"list" | "lookup" | "link" | "provider" | "sync" | "start" | "callback" | "status" | "retry", Handlers>;

  before(async () => {
    await w.setup();
    H.list = await import("@/app/api/accounts/route");
    H.lookup = await import("@/app/api/accounts/chesscom/lookup/route");
    // PATCH / DELETE in this module are plain delegates to ../[provider] (no `.spec`); they are callable the same way.
    H.link = (await import("@/app/api/accounts/chesscom/route")) as unknown as Handlers;
    H.provider = await import("@/app/api/accounts/[provider]/route");
    H.sync = await import("@/app/api/accounts/[provider]/sync/route");
    H.start = await import("@/app/api/accounts/lichess/start/route");
    H.callback = await import("@/app/api/accounts/lichess/callback/route");
    H.status = await import("@/app/api/import/status/route");
    H.retry = await import("@/app/api/import/[ref]/retry/route");
  });
  after(() => w.teardown());
  beforeEach(async () => {
    for (const who of ["m", "o", "n", "l"] as const) await w.reset(who);
    w.kicks.length = 0;
    w.lichessCalls.length = 0;
    w.lichess.token.status = 200;
    w.lichess.account.status = 200;
    w.lichess.account.body = { ...LI_ACCOUNT, count: { rated: 340 } };
    w.lichess.revoke.status = 204;
  });

  const link = (who: "m" | "o" | "n" | "l", username = CC_HANDLE, context: "onboarding" | "settings" = "settings", key = uuid()) =>
    w.call(H.link, "POST", "/api/accounts/chesscom", who, { body: { username, context }, headers: { "idempotency-key": key } });

  async function linkedAccountId(who: "m" | "o" | "n" | "l", provider: "CHESSCOM" | "LICHESS" = "CHESSCOM"): Promise<bigint> {
    const rows = await w.db.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM linked_accounts WHERE "userId" = $1::bigint AND provider = $2::"ChessProvider"`,
      w.users[who].id.toString(),
      provider,
    );
    return rows[0]!.id;
  }

  async function jobOf(accountId: bigint) {
    const rows = await w.db.$queryRawUnsafe<{ status: string; priority: number; payload: Record<string, unknown>; runAt: Date }[]>(
      `SELECT status::text AS status, priority, payload, "runAt" FROM jobs WHERE "dedupeKey" = $1`,
      `import:${accountId}`,
    );
    return rows[0] ?? null;
  }

  // ── ACC-1 ────────────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-1: empty list, then the linked account; private-etag with a 304 on revalidation", async () => {
    const empty = await w.call(H.list, "GET", "/api/accounts", "m");
    assert.equal(empty.res.status, 200);
    assert.deepEqual(ok(AccountsData).parse(await jsonOf(empty.res)).data, { items: [] });
    await link("m");
    const listed = await w.call(H.list, "GET", "/api/accounts", "m");
    assert.equal(listed.res.headers.get("cache-control"), "private, no-cache");
    const data = ok(AccountsData).parse(await jsonOf(listed.res)).data;
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]!.provider, "chesscom");
    assert.equal(data.items[0]!.verified, false);
    assert.equal(data.items[0]!.status, "queued");
    assert.equal(data.items[0]!.run?.trigger, "initial");
    const etag = listed.res.headers.get("etag")!;
    const again = await w.call(H.list, "GET", "/api/accounts", "m", { headers: { "if-none-match": etag } });
    assert.equal(again.res.status, 304);
    // Another member sees nothing of M's.
    assert.deepEqual(ok(AccountsData).parse(await jsonOf((await w.call(H.list, "GET", "/api/accounts", "o")).res)).data, { items: [] });
  });

  it("import-v3 off → 404 on every route; signed out → 401 (or the sign-in redirect for the OAuth start)", async () => {
    const { setImportFlag } = await import("@/lib/accounts/flag");
    const restore = setImportFlag(async () => false);
    try {
      await errorOf((await w.call(H.list, "GET", "/api/accounts", "m")).res, 404, "not_found");
      await errorOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "m", { body: { username: CC_HANDLE } })).res, 404, "not_found");
      await errorOf((await link("m")).res, 404, "not_found");
      await errorOf((await w.call(H.status, "GET", "/api/import/status", "m")).res, 404, "not_found");
      await errorOf((await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", { body: {}, params: { provider: "chesscom" } })).res, 404, "not_found");
      await errorOf((await w.call(H.start, "GET", "/api/accounts/lichess/start", "m")).res, 404, "not_found");
      // regression: lichess-callback-flag-off-cookie (FIX-2): the callback's 404 clears the PKCE cookie too.
      const cb = await w.call(H.callback, "GET", "/api/accounts/lichess/callback?code=abc&state=xyz", "m", {
        headers: { cookie: "rc_lichess_pkce=stale.value" },
      });
      assert.match(cb.res.headers.get("set-cookie") ?? "", /rc_lichess_pkce=;.*Max-Age=0/i);
      await errorOf(cb.res, 404, "not_found");
      assert.equal(w.lichessCalls.length, 0, "no call to Lichess with the flag off");
    } finally {
      restore();
    }
    await errorOf((await w.call(H.list, "GET", "/api/accounts", null)).res, 401, "unauthorized");
    const start = await w.call(H.start, "GET", "/api/accounts/lichess/start?returnTo=/onboarding/link", null);
    assert.equal(start.res.status, 302);
    assert.equal(start.res.headers.get("location"), "http://localhost:3000/sign-in?redirect_url=%2Fonboarding%2Flink");
  });

  // ── ACC-2 ────────────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-2: found / not_found / private / linked_elsewhere", async () => {
    const found = await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "n", { body: { username: `@${CC_HANDLE.toUpperCase()}` } });
    assert.equal(found.res.status, 200);
    assert.equal(found.res.headers.get("cache-control"), "private, no-store");
    const data = ok(LookupData).parse(await jsonOf(found.res)).data;
    assert.equal(data.status, "found");
    assert.equal(data.profile.username, CC_HANDLE);
    assert.ok(data.totalRatedGames > 0);
    assert.ok(data.headline);
    assert.ok(JSON.stringify(data).length <= 1_536, "LookupData ≤ 1.5 KB (§9.6)");
    await errorOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "n", { body: { username: "nosuchplayer" } })).res, 404, "not_found");
    const closed = ok(LookupData).parse(await jsonOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "n", { body: { username: "closed_one" } })).res)).data;
    assert.equal(closed.status, "private");
    await errorOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "n", { body: { username: "bad name!" } })).res, 400, "validation_failed");
    // O holds a VERIFIED link to the same player id → N gets 409 linked_elsewhere (D4-10).
    await w.db.$executeRawUnsafe(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "updatedAt")
       VALUES ($1::bigint, 'CHESSCOM', $2, $3, $4, now(), now())`,
      w.users.o.id.toString(),
      String(CC_PROFILE.player_id),
      CC_HANDLE.toUpperCase(),
      CC_HANDLE,
    );
    const { reason } = await errorOf((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "n", { body: { username: CC_HANDLE } })).res, 409, "conflict");
    assert.equal(reason, "linked_elsewhere");
  });

  // ── ACC-3 ────────────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-3 member, onboarding: 201, run + job at IMPORT_SYNC_INITIAL, step LEVEL with the band; effects after the response", async () => {
    const { res, recorded } = await link("m", CC_HANDLE.toUpperCase(), "onboarding");
    assert.equal(res.status, 201, await res.clone().text());
    const data = ok(LinkData).parse(await jsonOf(res)).data;
    assert.equal(data.account.status, "queued");
    assert.equal(data.run?.status, "queued");
    assert.equal(data.onboarding?.step, "level");
    assert.match(data.onboarding?.ratingBandSource ?? "", /^chesscom:(bullet|blitz|rapid|daily)$/);
    assert.ok(data.onboarding?.ratingBand);
    const id = await linkedAccountId("m");
    const job = await jobOf(id);
    assert.equal(job?.status, "QUEUED");
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL);
    assert.deepEqual(job?.payload, { v: 1, linkedAccountId: id.toString(), runId: job?.payload.runId, trigger: "INITIAL" });
    assert.equal(w.kicks.length, 0, "the kick runs after the response");
    const effects = await w.runAfter(recorded);
    assert.deepEqual(effects.exceptions, []);
    assert.equal(w.kicks.length, 1);
    assert.deepEqual((w.kicks[0] as { kinds: string[] }).kinds, ["IMPORT_SYNC", "IMPORT_PURGE"]);
    const audit = await w.db.$queryRawUnsafe<{ action: string; meta: unknown }[]>(
      `SELECT action, meta FROM audit_logs WHERE "actorUserId" = $1::bigint ORDER BY id`,
      w.users.m.id.toString(),
    );
    assert.deepEqual(audit.map((a) => a.action), ["account.linked"]);
    const legacy = await w.db.chessComProfile.findUnique({ where: { userId: w.users.m.id } });
    assert.equal(legacy?.chessComHandle, CC_HANDLE);
    assert.ok(w.tags.includes(`chesscom:${CC_HANDLE}`));
  });

  it("ACC-3 idempotency: replay → 200 Idempotent-Replayed; the same handle again → 200; another handle → 409 already_linked", async () => {
    const key = uuid();
    assert.equal((await link("m", CC_HANDLE, "settings", key)).res.status, 201);
    const replay = await link("m", CC_HANDLE, "settings", key);
    assert.equal(replay.res.status, 201);
    assert.equal(replay.res.headers.get("idempotent-replayed"), "true");
    const same = await link("m", CC_HANDLE.toUpperCase());
    assert.equal(same.res.status, 200);
    ok(LinkData).parse(await jsonOf(same.res));
    const runs = await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM import_runs WHERE "userId" = $1::bigint`, w.users.m.id.toString());
    assert.equal(runs.length, 1, "no second run");
    assert.equal((await errorOf((await link("m", "other_handle")).res, 409, "conflict")).reason, "already_linked");
    await errorOf(
      (await w.call(H.link, "POST", "/api/accounts/chesscom", "m", { body: { username: CC_HANDLE, context: "settings" } })).res,
      400,
      "validation_failed",
    );
    assert.equal((await errorOf((await link("n", "closed_one")).res, 409, "conflict")).reason, "profile_closed");
    await errorOf((await link("n", "nosuchplayer")).res, 404, "not_found");
  });

  it("regression: p04-statement-budgets — §9.4: a warm-cache link transaction is ≤ 7 statements; a replay costs no more", async () => {
    // Warm the lookup cache first (the link reuses the lookup's 600 s profile), as the onboarding does.
    assert.equal((await w.call(H.lookup, "POST", "/api/accounts/chesscom/lookup", "m", { body: { username: CC_HANDLE } })).res.status, 200);
    const key = uuid();
    const first = await link("m", CC_HANDLE, "onboarding", key);
    assert.equal(first.res.status, 201);
    const { routeStatements } = await import("../helpers/query-counter");
    // The route adds 3 statements around the transaction: the idempotency claim, the account re-read after the commit
    // and the idempotency store (the viewer is the harness's). The transaction itself is the plan's ≤ 7 (§9.1, §9.4).
    const statements = routeStatements(first.recorded);
    assert.ok(statements - 3 <= 7, `link transaction: ${statements - 3} statements (route total ${statements}; budget 7)`);
    const replay = await link("m", CC_HANDLE, "onboarding", key);
    assert.equal(replay.res.headers.get("idempotent-replayed"), "true");
    assert.ok(routeStatements(replay.recorded) <= statements, "a replay never costs more than the link");
  });

  it("ACC-3 co-claim: an unverified link elsewhere is allowed and audited (D4-10)", async () => {
    assert.equal((await link("o")).res.status, 201);
    const { res, recorded } = await link("m");
    assert.equal(res.status, 201);
    await w.runAfter(recorded);
    const audit = await w.db.$queryRawUnsafe<{ action: string }[]>(
      `SELECT action FROM audit_logs WHERE "actorUserId" = $1::bigint ORDER BY id`,
      w.users.m.id.toString(),
    );
    assert.deepEqual(audit.map((a) => a.action), ["account.linked", "account.link_coclaim"]);
  });

  it("ACC-3 non-member: the run waits, no job, no kick; the entitlement release queues it once (§8.5.4)", async () => {
    const { res, recorded } = await link("n");
    assert.equal(res.status, 201);
    const data = ok(LinkData).parse(await jsonOf(res)).data;
    assert.equal(data.run?.status, "waiting_for_membership");
    assert.equal(data.account.status, "waiting_for_membership");
    const id = await linkedAccountId("n");
    assert.equal(await jobOf(id), null);
    await w.runAfter(recorded);
    assert.equal(w.kicks.length, 0);
    const { releaseWaitingImports } = await import("@/lib/jobs/import");
    const { rawDb } = await import("@/lib/games/snapshot.server");
    const { prisma } = await import("@/lib/prisma");
    assert.deepEqual(await releaseWaitingImports(rawDb(prisma), w.users.n.id), { released: 1, queued: 1 });
    const job = await jobOf(id);
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL);
    assert.equal(job?.payload.trigger, "INITIAL");
    assert.deepEqual(await releaseWaitingImports(rawDb(prisma), w.users.n.id), { released: 0, queued: 0 }, "a re-send releases nothing");
    const state = await w.db.$queryRawUnsafe<{ importState: string }[]>(`SELECT "importState"::text AS "importState" FROM linked_accounts WHERE id = $1::bigint`, id.toString());
    assert.equal(state[0]!.importState, "QUEUED");
  });

  it("regression: parked-import-no-backstop (FIX-1): a member's status read releases a run the lost fan-out left WAITING", async () => {
    // Linked while not a member → parked; the payment's fan-out release never ran.
    const parked = await link("n");
    assert.equal(parked.res.status, 201, await parked.res.clone().text());
    const id = await linkedAccountId("n");
    assert.equal(await jobOf(id), null);
    // Still not a member: the status read releases nothing.
    const before = await w.call(H.status, "GET", "/api/import/status", "n");
    assert.equal(before.recorded.afterTasks.length, 0);
    // Now a member (the webhook applied the row, its after() fan-out was lost): the read queues the release + kick.
    w.kicks.length = 0;
    const member = w.viewerOf("n", { entitlement: { member: true, entitled: true, state: "member" } });
    const read = await w.call(H.status, "GET", "/api/import/status", "n", { viewer: member });
    assert.equal(ok(ImportStatusData).parse(await jsonOf(read.res)).data.runs[0]!.status, "waiting_for_membership");
    await w.runAfter(read.recorded);
    const job = await jobOf(id);
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_INITIAL);
    assert.equal(job?.payload.trigger, "INITIAL");
    assert.equal(w.kicks.length, 1);
    const after = ok(ImportStatusData).parse(await jsonOf((await w.call(H.status, "GET", "/api/import/status", "n", { viewer: member })).res)).data;
    assert.equal(after.runs[0]!.status, "queued");
  });

  it("release: a returning member's auto-import account not synced for 12 h gets a DAILY sync", async () => {
    await link("l");
    const id = await linkedAccountId("l");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'DONE', "finishedAt" = now() WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(`UPDATE linked_accounts SET "importState" = 'IDLE', "lastSyncOkAt" = now() - interval '2 days' WHERE id = $1::bigint`, id.toString());
    const { releaseWaitingImports } = await import("@/lib/jobs/import");
    const { rawDb } = await import("@/lib/games/snapshot.server");
    const { prisma } = await import("@/lib/prisma");
    assert.deepEqual(await releaseWaitingImports(rawDb(prisma), w.users.l.id), { released: 0, queued: 1 });
    const job = await jobOf(id);
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_DAILY);
    assert.deepEqual(job?.payload, { v: 1, linkedAccountId: id.toString(), runId: null, trigger: "DAILY" });
    assert.deepEqual(await releaseWaitingImports(rawDb(prisma), w.users.l.id), { released: 0, queued: 0 });
  });

  // ── ACC-4 ────────────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-4: 202 MANUAL run at IMPORT_SYNC_MANUAL; an active run → 409 sync_running; RUNNING job → 409 and no run", async () => {
    await link("m");
    const id = await linkedAccountId("m");
    // A second sync while the INITIAL run is active.
    const busy = await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", { body: {}, params: { provider: "chesscom" } });
    assert.equal((await errorOf(busy.res, 409, "conflict")).reason, "sync_running");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'DONE', "finishedAt" = now() WHERE "linkedAccountId" = $1::bigint`, id.toString());
    const { res, recorded } = await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", { body: {}, params: { provider: "chesscom" } });
    assert.equal(res.status, 202, await res.clone().text());
    const run = ok(SyncData).parse(await jsonOf(res)).data.run;
    assert.equal(run.trigger, "manual");
    assert.equal(run.status, "queued");
    const job = await jobOf(id);
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_MANUAL);
    assert.equal(job?.payload.trigger, "MANUAL");
    await w.runAfter(recorded);
    assert.equal(w.kicks.length, 1);
    // The job is RUNNING (a worker holds it): the run insert rolls back.
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'DONE', "finishedAt" = now() WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(`UPDATE jobs SET status = 'RUNNING', "lockedBy" = 'w1' WHERE "dedupeKey" = $1`, `import:${id}`);
    const before = await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM import_runs WHERE "linkedAccountId" = $1::bigint`, id.toString());
    const running = await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", { body: {}, params: { provider: "chesscom" } });
    assert.equal((await errorOf(running.res, 409, "conflict")).reason, "sync_running");
    const afterRows = await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM import_runs WHERE "linkedAccountId" = $1::bigint`, id.toString());
    assert.equal(afterRows.length, before.length, "the transaction rolled the run back");
  });

  it("ACC-4: provider back-off → 429 source chesscom; the per-provider limit → 429 source replay; 402 / 404", async () => {
    await link("m");
    const id = await linkedAccountId("m");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'DONE', "finishedAt" = now() WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(`UPDATE linked_accounts SET "nextAllowedSyncAt" = now() + interval '45 seconds' WHERE id = $1::bigint`, id.toString());
    const paused = await errorOf((await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", { body: {}, params: { provider: "chesscom" } })).res, 429, "rate_limited");
    assert.deepEqual(paused.details, { source: "chesscom" });
    assert.ok(paused.retryAfterSec! >= 40 && paused.retryAfterSec! <= 46);
    await w.db.$executeRawUnsafe(`UPDATE linked_accounts SET "nextAllowedSyncAt" = NULL WHERE id = $1::bigint`, id.toString());
    const limited = await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "m", {
      body: {},
      params: { provider: "chesscom" },
      rateLimit: { allowed: false, retryAfterSec: 27, bucket: "sync" },
    });
    const replay = await errorOf(limited.res, 429, "rate_limited");
    assert.deepEqual(replay.details, { source: "replay" });
    assert.equal(limited.res.headers.get("retry-after"), "27");
    const subject = limited.recorded.rateLimitCalls[0]!.subject as { clerkUserId: string };
    assert.equal(subject.clerkUserId, `${w.users.m.clerk}:chesscom`);
    const denied = await errorOf((await w.call(H.sync, "POST", "/api/accounts/chesscom/sync", "n", { body: {}, params: { provider: "chesscom" } })).res, 402, "subscription_required");
    assert.equal(denied.reason, "trial_available");
    await errorOf((await w.call(H.sync, "POST", "/api/accounts/lichess/sync", "m", { body: {}, params: { provider: "lichess" } })).res, 404, "not_found");
  });

  // ── ACC-7 / ACC-8 ────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-7: runs newest first; a run QUEUED > 30 s heals once across 10 parallel GETs (kick CAS)", async () => {
    await link("m");
    const id = await linkedAccountId("m");
    const first = await w.call(H.status, "GET", "/api/import/status", "m");
    assert.equal(first.res.status, 200);
    assert.equal(first.res.headers.get("cache-control"), "private, no-cache");
    const data = ok(ImportStatusData).parse(await jsonOf(first.res)).data;
    assert.equal(data.runs.length, 1);
    assert.equal(data.firstReview, null);
    assert.equal(first.recorded.afterTasks.length, 0, "a fresh QUEUED run needs no heal");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET "updatedAt" = now() - interval '2 minutes' WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(`UPDATE jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '2 minutes', "lastKickAt" = NULL WHERE "dedupeKey" = $1`, `import:${id}`);
    const calls = await Promise.all(Array.from({ length: 10 }, () => w.call(H.status, "GET", "/api/import/status", "m")));
    for (const c of calls) assert.equal(c.res.status, 200);
    w.kicks.length = 0;
    await Promise.all(calls.map((c) => w.runAfter(c.recorded)));
    assert.equal(w.kicks.length, 1, "exactly one kick");
    const etag = calls[0]!.res.headers.get("etag")!;
    assert.equal((await w.call(H.status, "GET", "/api/import/status", "m", { headers: { "if-none-match": etag } })).res.status, 304);
  });

  it("ACC-8: FAILED → 202 RETRY; not failed → 409 not_failed; another member's ref → 404; another active run → 409 sync_running", async () => {
    await link("m");
    const id = await linkedAccountId("m");
    const [run] = await w.db.$queryRawUnsafe<{ referenceId: string }[]>(`SELECT "referenceId" FROM import_runs WHERE "linkedAccountId" = $1::bigint`, id.toString());
    const ref = run!.referenceId;
    const notFailed = await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "m", { body: {}, params: { ref } });
    assert.equal((await errorOf(notFailed.res, 409, "conflict")).reason, "not_failed");
    await w.db.$executeRawUnsafe(
      `UPDATE import_runs SET status = 'FAILED', "finishedAt" = now(), error = '{"v":1,"code":"upstream","message":"x","at":"2026-11-12T00:00:00.000Z"}' WHERE "referenceId" = $1`,
      ref,
    );
    await errorOf((await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "o", { body: {}, params: { ref } })).res, 404, "not_found");
    const { res, recorded } = await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "m", { body: {}, params: { ref } });
    assert.equal(res.status, 202, await res.clone().text());
    const out = ok(RetryImportData).parse(await jsonOf(res)).data.run;
    assert.deepEqual([out.status, out.trigger, out.error], ["queued", "retry", null]);
    assert.equal((await jobOf(id))?.payload.trigger, "RETRY");
    await w.runAfter(recorded);
    assert.equal((w.kicks.at(-1) as { reason: string }).reason, "import_retry");
    // FAILED again while a MANUAL run is active → sync_running.
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'FAILED' WHERE "referenceId" = $1`, ref);
    await w.db.$executeRawUnsafe(
      `INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
       VALUES ($1, $2::bigint, $3::bigint, 'CHESSCOM', 'MANUAL', 'QUEUED', now())`,
      `cretryother${w.run}`.padEnd(25, "0").slice(0, 25),
      w.users.m.id.toString(),
      id.toString(),
    );
    const busy = await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "m", { body: {}, params: { ref } });
    assert.equal((await errorOf(busy.res, 409, "conflict")).reason, "sync_running");
    await errorOf((await w.call(H.retry, "POST", `/api/import/${ref}/retry`, "n", { body: {}, params: { ref } })).res, 402, "subscription_required");
  });

  // ── ACC-5 / ACC-6 ────────────────────────────────────────────────────────────────────────────────────────────
  it("ACC-5 (through /api/accounts/chesscom): off deletes the queued DAILY job; on writes the zone and the 03:00 slot", async () => {
    await link("m");
    const id = await linkedAccountId("m");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET status = 'DONE', "finishedAt" = now() WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(
      `UPDATE jobs SET payload = jsonb_set(payload, '{trigger}', '"DAILY"'), "runAt" = (now() AT TIME ZONE 'UTC') + interval '5 hours' WHERE "dedupeKey" = $1`,
      `import:${id}`,
    );
    const off = await w.call(H.link, "PATCH", "/api/accounts/chesscom", "m", { body: { autoImport: false } });
    assert.equal(off.res.status, 200, await off.res.clone().text());
    const view = ok(LinkedAccountView).parse(await jsonOf(off.res)).data;
    assert.equal(view.autoImport, false);
    assert.equal(view.nextAutoSyncAt, null);
    assert.equal(await jobOf(id), null, "the queued DAILY job is gone");
    const on = await w.call(H.link, "PATCH", "/api/accounts/chesscom", "n", { body: { autoImport: true } });
    await errorOf(on.res, 404, "not_found");
    const onM = await w.call(H.link, "PATCH", "/api/accounts/chesscom", "m", { body: { autoImport: true, timeZone: "Asia/Kolkata" } });
    const v2 = ok(LinkedAccountView).parse(await jsonOf(onM.res)).data;
    assert.equal(v2.autoImport, true);
    assert.ok(v2.nextAutoSyncAt);
    assert.match(v2.nextAutoSyncAt!, /T\d{2}:05:00\.000Z$/, "snapped to HH:05 UTC");
    const tz = await w.db.$queryRawUnsafe<{ timeZone: string }[]>(`SELECT "timeZone" FROM users WHERE id = $1::bigint`, w.users.m.id.toString());
    assert.equal(tz[0]!.timeZone, "Asia/Kolkata");
    const job = await jobOf(id);
    assert.equal(job?.priority, JOB_PRIORITY.IMPORT_SYNC_DAILY);
    assert.equal(new Date(job!.runAt).toISOString().slice(0, 16), v2.nextAutoSyncAt!.slice(0, 16));
    await errorOf((await w.call(H.provider, "PATCH", "/api/accounts/lichess", "m", { body: { autoImport: true, timeZone: "Mars/Olympus" }, params: { provider: "lichess" } })).res, 400, "validation_failed");
  });

  it("ACC-6: unlink with deleteGames=1 queues IMPORT_PURGE and removes link, runs, job and the legacy profile; again → 404", async () => {
    const { recorded } = await link("m");
    await w.runAfter(recorded);
    const id = await linkedAccountId("m");
    // regression: D2 (m4s): one game this link imported and one an earlier unlink kept (linkedAccountId NULL). Only the
    // link's row is marked for the purge, and the answer counts only it.
    const importedGame = async (tag: string, linked: bigint | null) => {
      const endedAt = new Date("2026-10-01T10:00:00Z");
      const g = await w.db.game.create({
        data: {
          creatorId: w.users.m.id, opponentId: null, status: "COMPLETED", startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          startPly: 0, initialTimeSeconds: 300, incrementSeconds: 0, creatorTimeRemaining: 0, opponentTimeRemaining: 0, expiresAt: endedAt,
          mode: "IMPORTED", timeClass: "BLITZ", whitePlayerId: w.users.m.id, blackPlayerId: null, moves: "e2e4 e7e5", plyCount: 2,
          fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", outcome: "DRAW", endMethod: "OTHER", completedAt: endedAt,
          analysisStatus: "NONE", source: "CHESSCOM", externalId: `d2-${tag}-${id}`, whiteName: "me", blackName: "opp",
        },
        select: { id: true },
      });
      await w.db.gamePlayer.create({
        data: { gameId: g.id, userId: w.users.m.id, color: "w", mode: "IMPORTED", timeClass: "BLITZ", result: "DRAW", endedAt, source: "CHESSCOM", opponentName: "opp", linkedAccountId: linked },
      });
      return g.id;
    };
    const ownGame = await importedGame("own", id);
    const keptGame = await importedGame("kept", null);
    const { res, recorded: r2 } = await w.call(H.link, "DELETE", "/api/accounts/chesscom?deleteGames=1", "m");
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(ok(UnlinkData).parse(await jsonOf(res)).data, { removed: true, purge: { games: 1 } }, "only the link's own game");
    const marks = await w.db.$queryRawUnsafe<{ gameId: bigint; purgeLinkId: bigint | null; linkedAccountId: bigint | null }[]>(
      `SELECT "gameId", "purgeLinkId", "linkedAccountId" FROM game_players WHERE "gameId" = ANY($1::bigint[])`,
      [ownGame, keptGame],
    );
    const markOf = (g: bigint) => marks.find((m) => m.gameId === g);
    assert.equal(markOf(ownGame)?.purgeLinkId?.toString(), id.toString(), "the link's row is marked for its purge");
    assert.equal(markOf(ownGame)?.linkedAccountId, null, "the FK cleared the link id as before");
    assert.equal(markOf(keptGame)?.purgeLinkId, null, "a kept game is never marked");
    const left = await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM linked_accounts WHERE id = $1::bigint`, id.toString());
    assert.equal(left.length, 0);
    assert.equal((await w.db.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM import_runs WHERE "linkedAccountId" = $1::bigint`, id.toString())).length, 0);
    assert.equal(await jobOf(id), null);
    assert.equal(await w.db.chessComProfile.findUnique({ where: { userId: w.users.m.id } }), null);
    const purge = await w.db.$queryRawUnsafe<{ priority: number; payload: Record<string, unknown> }[]>(
      `SELECT priority, payload FROM jobs WHERE "dedupeKey" = $1`,
      `importpurge:${w.users.m.id}:chesscom`,
    );
    assert.equal(purge[0]?.priority, JOB_PRIORITY.IMPORT_PURGE);
    assert.equal(purge[0]?.payload.provider, "CHESSCOM");
    assert.equal(purge[0]?.payload.linkedAccountId, id.toString(), "the purge is for this link only (D2)");
    await w.db.$executeRawUnsafe(`DELETE FROM games WHERE id = ANY($1::bigint[])`, [ownGame, keptGame]);
    await w.runAfter(r2);
    assert.ok(w.kicks.length >= 1);
    await errorOf((await w.call(H.provider, "DELETE", "/api/accounts/lichess", "m", { params: { provider: "lichess" } })).res, 404, "not_found");
    // deleteGames=0: no purge.
    await link("m");
    const kept = await w.call(H.link, "DELETE", "/api/accounts/chesscom", "m");
    assert.deepEqual(ok(UnlinkData).parse(await jsonOf(kept.res)).data, { removed: true, purge: null });
  });

  // ── OAU-1 / OAU-2 ────────────────────────────────────────────────────────────────────────────────────────────
  async function startCookie(who: "m" | "n" | "o", returnTo = "/settings/connected") {
    const { res } = await w.call(H.start, "GET", `/api/accounts/lichess/start?returnTo=${encodeURIComponent(returnTo)}`, who);
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location")!);
    const cookie = res.headers.get("set-cookie")!;
    return { location, cookie: cookie.split(";")[0]!, raw: cookie, state: location.searchParams.get("state")! };
  }

  const callback = (who: "m" | "n" | "o" | null, query: string, cookie: string | null) =>
    w.call(H.callback, "GET", `/api/accounts/lichess/callback?${query}`, who, { headers: cookie ? { cookie } : {} });

  const revokes = () => w.lichessCalls.filter((c) => c.method === "DELETE" && c.path === "/api/token");

  it("OAU-1: PKCE S256, state, no scope, signed cookie on the callback path; the link limit → 302 rate_limited", async () => {
    const { location, raw, state } = await startCookie("m");
    assert.equal(location.origin + location.pathname, "http://upstream.test/lichess/oauth");
    assert.equal(location.searchParams.get("response_type"), "code");
    assert.equal(location.searchParams.get("client_id"), "replay-chess-test");
    assert.equal(location.searchParams.get("redirect_uri"), "http://localhost:3000/api/accounts/lichess/callback");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.match(location.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.equal(location.searchParams.has("scope"), false);
    assert.equal(state.length, 32);
    assert.match(raw, /^rc_lichess_pkce=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/api\/accounts\/lichess; Max-Age=600; HttpOnly; SameSite=Lax$/);
    const limited = await w.call(H.start, "GET", "/api/accounts/lichess/start?returnTo=/onboarding/link", "m", {
      rateLimit: { allowed: false, retryAfterSec: 30, bucket: "link" },
    });
    assert.equal(limited.res.status, 302);
    assert.equal(limited.res.headers.get("location"), "http://localhost:3000/onboarding/link?lichess=error&reason=rate_limited");
    assert.equal(limited.res.headers.get("set-cookie"), null);
    await errorOf((await w.call(H.start, "GET", "/api/accounts/lichess/start?returnTo=https://evil.test", "m")).res, 400, "validation_failed");
  });

  it("OAU-2 success (settings): verified link, run, one revoke with that token, no token at rest", async () => {
    const { cookie, state } = await startCookie("m");
    const { res, recorded } = await callback("m", `code=abc123&state=${state}`, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=linked");
    assert.match(res.headers.get("set-cookie") ?? "", /^rc_lichess_pkce=; Path=\/api\/accounts\/lichess; Max-Age=0/);
    const tokenCall = w.lichessCalls.find((c) => c.method === "POST")!;
    const form = new URLSearchParams(tokenCall.body!);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "abc123");
    assert.match(form.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{64}$/);
    const token = `lio_secret_${w.run}_${w.lichess.issued}`;
    assert.deepEqual(revokes().map((c) => c.auth), [`Bearer ${token}`]);
    const accountCall = w.lichessCalls.find((c) => c.path === "/api/account")!;
    assert.equal(accountCall.auth, `Bearer ${token}`);
    const rows = await w.db.$queryRawUnsafe<{ verified: boolean; externalId: string; total: number }[]>(
      `SELECT ("verifiedAt" IS NOT NULL) AS verified, "externalId", "totalRatedGames" AS total FROM linked_accounts WHERE "userId" = $1::bigint AND provider = 'LICHESS'`,
      w.users.m.id.toString(),
    );
    assert.deepEqual(rows, [{ verified: true, externalId: LI_ACCOUNT.id, total: 340 }]);
    await w.runAfter(recorded);
    const leak = await w.db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT (SELECT count(*) FROM linked_accounts WHERE row_to_json(linked_accounts)::text LIKE $1)
            + (SELECT count(*) FROM import_runs WHERE row_to_json(import_runs)::text LIKE $1)
            + (SELECT count(*) FROM audit_logs WHERE row_to_json(audit_logs)::text LIKE $1)
            + (SELECT count(*) FROM jobs WHERE row_to_json(jobs)::text LIKE $1) AS n`,
      `%lio_secret_%`,
    );
    assert.equal(Number(leak[0]!.n), 0, "the token is in no row");
    assert.ok(!JSON.stringify(recorded.logs).includes("lio_secret"), "nor in a log line");
    // The same account again: success, ratings refreshed, still one revoke per token.
    const again = await startCookie("m");
    const second = await callback("m", `code=again&state=${again.state}`, again.cookie);
    assert.equal(second.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=linked");
    assert.equal(revokes().length, 2);
  });

  it("OAU-2 success (onboarding): → /onboarding/confirm?provider=lichess and the step moves to CONFIRM", async () => {
    const { cookie, state } = await startCookie("n", "/onboarding/link");
    const { res } = await callback("n", `code=x&state=${state}`, cookie);
    assert.equal(res.headers.get("location"), "http://localhost:3000/onboarding/confirm?provider=lichess");
    const step = await w.db.$queryRawUnsafe<{ s: string }[]>(`SELECT "onboardingStep"::text AS s FROM users WHERE id = $1::bigint`, w.users.n.id.toString());
    assert.equal(step[0]!.s, "CONFIRM");
    assert.equal(revokes().length, 1);
  });

  it("OAU-2 state failures: bad state, missing / expired / foreign cookie → reason=state, no token requested", async () => {
    const { cookie } = await startCookie("m");
    const bad = await callback("m", `code=x&state=${"z".repeat(32)}`, cookie);
    assert.equal(bad.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=state");
    const none = await callback("m", `code=x&state=${"z".repeat(32)}`, null);
    assert.equal(none.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=state");
    const foreign = await startCookie("o");
    const stolen = await callback("m", `code=x&state=${foreign.state}`, foreign.cookie);
    assert.equal(stolen.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=state");
    const { signCookieValue } = await import("@/lib/crypto/signed-cookie");
    const expired = await signCookieValue(
      { v: 1, exp: Date.now() - 1, sub: w.users.m.clerk, verifier: "v".repeat(64), state: "s".repeat(32), returnTo: "/settings/connected" },
      SECRET,
    );
    const late = await callback("m", `code=x&state=${"s".repeat(32)}`, `rc_lichess_pkce=${expired}`);
    assert.equal(late.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=state");
    // regression: lichess-callback-malformed (FIX-1): a malformed query is a 302 to the cookie's returnTo with the
    // single-use cookie cleared, never a raw 400 that leaves it set.
    for (const query of ["state=x", "", "code=abc&state=short", `error=${"e".repeat(80)}`]) {
      const s = await startCookie("m", "/onboarding/link");
      const r = await callback("m", query, s.cookie);
      assert.equal(r.res.status, 302, query);
      assert.equal(r.res.headers.get("location"), "http://localhost:3000/onboarding/link?lichess=error&reason=state", query);
      assert.match(r.res.headers.get("set-cookie") ?? "", /rc_lichess_pkce=;.*Max-Age=0/i, query);
    }
    assert.equal(w.lichessCalls.length, 0, "no call to Lichess at all");
  });

  it("OAU-2 access_denied → lichess=denied; another error → upstream; token exchange failure → upstream, nothing to revoke", async () => {
    const a = await startCookie("m", "/onboarding/link");
    const denied = await callback("m", `error=access_denied&state=${a.state}`, a.cookie);
    assert.equal(denied.res.headers.get("location"), "http://localhost:3000/onboarding/link?lichess=denied");
    const b = await startCookie("m");
    const other = await callback("m", `error=server_error&state=${b.state}`, b.cookie);
    assert.equal(other.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=upstream");
    w.lichess.token.status = 400;
    const c = await startCookie("m");
    const failed = await callback("m", `code=x&state=${c.state}`, c.cookie);
    assert.equal(failed.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=upstream");
    assert.equal(revokes().length, 0);
  });

  it("OAU-2 revoke on every path that obtained a token: account read failure, linked elsewhere, already linked, DB error", async () => {
    // 1. /api/account fails.
    w.lichess.account.status = 500;
    let s = await startCookie("m");
    let r = await callback("m", `code=x&state=${s.state}`, s.cookie);
    assert.equal(r.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=upstream");
    assert.equal(revokes().length, 1);
    assert.equal(revokes()[0]!.auth, `Bearer lio_secret_${w.run}_${w.lichess.issued}`);
    w.lichess.account.status = 200;
    // 2. O holds the verified Lichess link.
    s = await startCookie("o");
    assert.equal((await callback("o", `code=x&state=${s.state}`, s.cookie)).res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=linked");
    s = await startCookie("m");
    r = await callback("m", `code=x&state=${s.state}`, s.cookie);
    assert.equal(r.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=linked_elsewhere");
    assert.equal(revokes().length, 3);
    // 3. M already has another Lichess account.
    await w.db.$executeRawUnsafe(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "updatedAt")
       VALUES ($1::bigint, 'LICHESS', 'someoneelse', 'SomeoneElse', 'someoneelse', now(), now())`,
      w.users.m.id.toString(),
    );
    s = await startCookie("m");
    r = await callback("m", `code=x&state=${s.state}`, s.cookie);
    assert.equal(r.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=already_linked");
    assert.equal(revokes().length, 4);
    // 4. The link transaction throws.
    const { setLinkDeps } = await import("@/lib/accounts/link-service");
    const restore = setLinkDeps({
      transaction: async () => {
        throw new Error("db down");
      },
      db: async () => {
        throw new Error("db down");
      },
    });
    try {
      s = await startCookie("n");
      r = await callback("n", `code=x&state=${s.state}`, s.cookie);
      assert.equal(r.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=error&reason=upstream");
      assert.equal(r.recorded.exceptions.length, 1);
      assert.ok(!JSON.stringify(r.recorded.exceptions).includes("lio_secret"));
    } finally {
      restore();
    }
    assert.equal(revokes().length, 5);
    // 5. The revoke itself fails twice: retried once, then a Sentry warning; the redirect still goes out.
    w.lichess.revoke.status = 500;
    await w.reset("n");
    await w.reset("o");
    s = await startCookie("n");
    r = await callback("n", `code=x&state=${s.state}`, s.cookie);
    assert.equal(r.res.headers.get("location"), "http://localhost:3000/settings/connected?lichess=linked");
    assert.equal(revokes().length, 7);
    assert.ok(r.recorded.messages.some((m) => m.message === "lichess.revoke_failed"));
  });

  // ── import-prune (CRON-1) ────────────────────────────────────────────────────────────────────────────────────
  it("import-prune: P23 cancels a 31-day-old waiting run and idles its account; P22 deletes old finished runs", async () => {
    await link("n");
    const id = await linkedAccountId("n");
    await w.db.$executeRawUnsafe(`UPDATE import_runs SET "createdAt" = now() - interval '31 days' WHERE "linkedAccountId" = $1::bigint`, id.toString());
    await w.db.$executeRawUnsafe(
      `INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "finishedAt", "updatedAt")
       VALUES ($1, $2::bigint, $3::bigint, 'CHESSCOM', 'MANUAL', 'DONE', now() - interval '40 days', now()),
              ($4, $2::bigint, $3::bigint, 'CHESSCOM', 'MANUAL', 'FAILED', now() - interval '40 days', now())`,
      `cprunedone${w.run}`.padEnd(25, "0").slice(0, 25),
      w.users.n.id.toString(),
      id.toString(),
      `cprunefail${w.run}`.padEnd(25, "0").slice(0, 25),
    );
    const { createImportPrune } = await import("@/lib/cron/tasks/import-prune");
    const task = createImportPrune(async (sql) => w.db.$queryRawUnsafe<{ n: number }[]>(sql.text, ...sql.values));
    const out = await task.run({ now: new Date() } as never);
    assert.ok((out.detail?.cancelled ?? 0) >= 1);
    assert.ok((out.detail?.deleted ?? 0) >= 1);
    const rows = await w.db.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status::text AS status FROM import_runs WHERE "linkedAccountId" = $1::bigint ORDER BY status`,
      id.toString(),
    );
    assert.deepEqual(rows.map((r) => r.status), ["CANCELLED", "FAILED"], "DONE (40 d) deleted, FAILED (40 d < 90 d) kept");
    const state = await w.db.$queryRawUnsafe<{ s: string }[]>(`SELECT "importState"::text AS s FROM linked_accounts WHERE id = $1::bigint`, id.toString());
    assert.equal(state[0]!.s, "IDLE");
  });
});
