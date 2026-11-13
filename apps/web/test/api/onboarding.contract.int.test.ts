/**
 * ME-4 `PATCH /api/me/onboarding` contract (phase-04 plan §7.2, §11.1, §12.3): the real handler through route() on a
 * real Postgres after `prisma migrate deploy`, with the injected viewer. Responses parse with the CT schema; wire
 * values are lowercase (uppercase is a 400); the step is monotonic; `complete` is 409 `plan_required` for a
 * non-member and, for a member, writes DONE and sets the 120 s `rc_onb` cookie bound to the Clerk user; signed out
 * is a 401; the rate limit is the registry's `onboarding` 60/60 per user. Local Postgres only.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@repo/db";
import { PatchOnboardingData } from "@repo/contracts/http/onboarding";
import { ONBOARDING_LIMIT } from "@repo/contracts/http/registry/onboarding";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request, viewerFixture } from "../helpers/route-harness";
import { routeStatements } from "../helpers/query-counter";

const url = process.env.TEST_DATABASE_URL;
const COOKIE_SECRET = randomBytes(32).toString("hex");

function localOnly(u: string): void {
  const host = new URL(u).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) throw new Error(`refusing to run against ${host}: local Postgres only`);
}

describe("PATCH /api/me/onboarding (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  let PATCH: RouteHandler;
  let verifyClaimCookie: typeof import("@/lib/onboarding/claim-cookie").verifyClaimCookie;
  const run = Date.now().toString(36);
  const emails = [`onb-ct-a-${run}@example.test`, `onb-ct-b-${run}@example.test`, `onb-ct-c-${run}@example.test`];
  const ids: bigint[] = [];

  const patch = (body: unknown) =>
    PATCH(
      request("/api/me/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
      noParams(),
    );

  before(async () => {
    localOnly(url!);
    Object.assign(process.env, { DATABASE_URL: url, DIRECT_URL: url, SIGNED_COOKIE_SECRET: COOKIE_SECRET });
    db = new PrismaClient({ datasourceUrl: url });
    for (const [i, email] of emails.entries()) {
      const u = await db.user.create({
        data: { googleId: `user_onbct_${run}_${i}`, email, name: "Onb Contract", code: `${run.slice(-5).toUpperCase()}${i}`.padStart(6, "C") },
        select: { id: true },
      });
      ids.push(u.id);
    }
    ({ PATCH } = (await import("@/app/api/me/onboarding/route")) as unknown as { PATCH: RouteHandler });
    ({ verifyClaimCookie } = await import("@/lib/onboarding/claim-cookie"));
  });

  after(async () => {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  it("a step PATCH: 200, the CT shape, lowercase wire values, no cookie", async () => {
    const t = installTestDeps({ userId: `user_onbct_${run}_0`, viewer: viewerFixture({ id: ids[0]!, clerkUserId: `user_onbct_${run}_0` }) });
    try {
      const res = await patch({ step: "level", ratingBand: "r800_1200", ratingBandSource: "chesscom:rapid", initialRating: 1184, timeZone: "Asia/Kolkata" });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(res.headers.get("set-cookie"), null);
      const body = (await res.json()) as { data: unknown };
      const data = PatchOnboardingData.parse(body.data);
      assert.equal(data.onboarding.step, "level");
      assert.equal(data.onboarding.ratingBand, "r800_1200");
      assert.equal(data.onboarding.done, false);
      assert.equal(data.timeZone, "Asia/Kolkata");
      const spec = (PATCH as unknown as { spec: { rateLimit: unknown } }).spec;
      assert.deepEqual(spec.rateLimit, ONBOARDING_LIMIT);
    } finally {
      t.restore();
    }
  });

  it("regression: p04-statement-budgets — a step PATCH is one statement (plan §9.1 W1: 1 DB round trip)", async () => {
    const t = installTestDeps({ userId: `user_onbct_${run}_2`, viewer: viewerFixture({ id: ids[2]!, clerkUserId: `user_onbct_${run}_2` }) });
    try {
      const res = await patch({ step: "goals", ratingBand: "r1200_1600", ratingBandSource: "self", timeZone: "UTC" });
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(routeStatements(t.recorded), 1);
    } finally {
      t.restore();
    }
  });

  it("monotonic: an earlier step answers the stored later one", async () => {
    const t = installTestDeps({ userId: `user_onbct_${run}_0`, viewer: viewerFixture({ id: ids[0]!, clerkUserId: `user_onbct_${run}_0` }) });
    try {
      const res = await patch({ step: "link" });
      const data = PatchOnboardingData.parse(((await res.json()) as { data: unknown }).data);
      assert.equal(data.onboarding.step, "level");
      assert.equal(data.onboarding.ratingBand, "r800_1200");
    } finally {
      t.restore();
    }
  });

  it("uppercase wire values, an unknown zone, step + complete → 400 validation_failed", async () => {
    const t = installTestDeps({ userId: `user_onbct_${run}_0`, viewer: viewerFixture({ id: ids[0]!, clerkUserId: `user_onbct_${run}_0` }) });
    try {
      for (const bad of [{ step: "LEVEL" }, { ratingBand: "R800_1200" }, { goals: ["STOP_BLUNDERING"] }, { timeZone: "Mars/Olympus" }, { step: "goals", complete: true }, { step: "done" }]) {
        const res = await patch(bad);
        assert.equal(res.status, 400, JSON.stringify(bad));
        assert.equal(((await res.json()) as { error: { code: string } }).error.code, "validation_failed");
      }
    } finally {
      t.restore();
    }
  });

  it("complete as a non-member → 409 conflict plan_required, nothing written", async () => {
    const viewer = viewerFixture({
      id: ids[1]!,
      clerkUserId: `user_onbct_${run}_1`,
      entitlement: { member: false, entitled: false, state: "none" },
    });
    const t = installTestDeps({ userId: `user_onbct_${run}_1`, viewer });
    try {
      const res = await patch({ complete: true });
      assert.equal(res.status, 409);
      const err = ((await res.json()) as { error: { code: string; details?: { reason?: string } } }).error;
      assert.equal(err.code, "conflict");
      assert.equal(err.details?.reason, "plan_required");
      const row = await db.user.findUniqueOrThrow({ where: { id: ids[1]! }, select: { onboarded: true, onboardingStep: true } });
      assert.equal(row.onboarded, false);
      assert.equal(row.onboardingStep, "WELCOME");
    } finally {
      t.restore();
    }
  });

  it("complete as a member → 200 done, onboardedAt, and a valid rc_onb for this Clerk user only", async () => {
    const clerkUserId = `user_onbct_${run}_0`;
    const t = installTestDeps({ userId: clerkUserId, viewer: viewerFixture({ id: ids[0]!, clerkUserId }), clock: Date.now() });
    try {
      const res = await patch({ complete: true });
      assert.equal(res.status, 200);
      const data = PatchOnboardingData.parse(((await res.json()) as { data: unknown }).data);
      assert.equal(data.onboarding.done, true);
      assert.equal(data.onboarding.step, "done");
      assert.ok(data.onboarding.onboardedAt);
      const cookie = res.headers.get("set-cookie") ?? "";
      assert.match(cookie, /^rc_onb=[^;]+; Path=\/; Max-Age=120; HttpOnly; SameSite=Lax/);
      const value = cookie.split(";")[0]!.slice("rc_onb=".length);
      assert.equal(await verifyClaimCookie("onb", value, clerkUserId, Date.now(), COOKIE_SECRET), true);
      assert.equal(await verifyClaimCookie("onb", value, "user_someone_else", Date.now(), COOKIE_SECRET), false);
      const row = await db.user.findUniqueOrThrow({ where: { id: ids[0]! }, select: { onboarded: true, onboardingStep: true, onboardedAt: true } });
      assert.equal(row.onboarded, true);
      assert.equal(row.onboardingStep, "DONE");
      assert.ok(row.onboardedAt);
    } finally {
      t.restore();
    }
  });

  it("signed out → 401", async () => {
    const t = installTestDeps({ userId: null, viewer: null });
    try {
      const res = await patch({ step: "link" });
      assert.equal(res.status, 401);
    } finally {
      t.restore();
    }
  });
});
