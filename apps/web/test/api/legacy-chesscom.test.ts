// The legacy Chess.com endpoints (phase-04 plan §3 rows 179-180, §7.12, §11.1, §11.2), FIX-2.
// regression: legacy-chesscom-profile-bypasses-plan-required (review round 2, FIX-1 #21 half fixed): with
// `onboarding-v3` on, POST /api/user/chess-com-profile still wrote `users.onboarded = true` for a non-member, so the
// next claims sync let them past the paid-only onboarding. regression: legacy-preview-unthrottled: the preview looped
// Chess.com lookups with no rate limit and no flag gate.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { beforeEach, describe, it } from "node:test";

type World = {
  flags: { "onboarding-v3": boolean; "import-v3": boolean };
  allowed: boolean;
  writes: unknown[][];
  upstream: string[];
  limits: unknown[];
};
const g = globalThis as { __legacyWorld?: World };
const world = (): World => g.__legacyWorld!;

const mod = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FAKES: Record<string, string> = {
  "server-only": mod("export {}"),
  "@clerk/nextjs/server": mod(`export async function auth() { return { userId: "user_nonmember" }; }`),
  "@/lib/logger": mod(`export const logger = { debug() {}, info() {}, warn() {}, error() {} };`),
  "@/lib/auth/viewer": mod(`export async function getViewer() { return { id: 41n, clerkUserId: "user_nonmember" }; }`),
  "@/lib/flags": mod(`export async function getFlags() { return { ...globalThis.__legacyWorld.flags }; }`),
  "@/lib/rate-limit-db": mod(`export function clientIpFrom(h) { return h.get("x-forwarded-for"); }
export async function checkRateLimit(specs, subject) {
  globalThis.__legacyWorld.limits.push({ buckets: specs.map((s) => s.bucket), subject });
  return globalThis.__legacyWorld.allowed ? { allowed: true, retryAfterSec: 0 } : { allowed: false, retryAfterSec: 42, bucket: specs[0].bucket };
}`),
  "@/lib/chess-com": mod(`const w = () => globalThis.__legacyWorld;
export async function fetchChessComProfile(h) { w().upstream.push("profile:" + h); return { name: "x" }; }
export async function fetchChessComStats(h) { w().upstream.push("stats:" + h); return {}; }
export async function fetchChessComPreview(h) { w().upstream.push("preview:" + h); return { username: h }; }
export function extractCountryCode() { return null; }`),
  "@/lib/prisma": mod(`const w = () => globalThis.__legacyWorld;
const user = { id: 41n, referenceId: "uref41", onboarded: false, chessComProfile: null };
const tx = {
  chessComProfile: { async upsert(a) { w().writes.push(["chessComProfile.upsert", String(a.where.userId)]); return { referenceId: "p1", chessComHandle: "x", rapidRating: null, blitzRating: null }; } },
  user: { async update(a) { w().writes.push(["user.update", a.data]); return { id: 41n }; } },
};
export const prisma = { user: { async findUnique() { return user; } }, async $transaction(fn) { return fn(tx); } };`),
};
nodeModule.registerHooks({
  resolve: (specifier, context, next) => (FAKES[specifier] ? { url: FAKES[specifier]!, shortCircuit: true } : next(specifier, context)),
});

const { POST: profilePOST } = await import("@/app/api/user/chess-com-profile/route");
const { POST: previewPOST } = await import("@/app/api/user/chess-com-profile/preview/route");
const { legacyChessComDecision } = await import("@/lib/onboarding/legacy-chesscom");
const { NextRequest } = await import("next/server");

const post = (path: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify({ chessComHandle: "Somebody" }),
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
  });

beforeEach(() => {
  g.__legacyWorld = { flags: { "onboarding-v3": true, "import-v3": true }, allowed: true, writes: [], upstream: [], limits: [] };
});

describe("legacy Chess.com endpoints (plan §7.12)", () => {
  it("the decision: 404 once neither caller is served; onboarded only for the legacy onboarding page", () => {
    assert.deepEqual(legacyChessComDecision({ "onboarding-v3": true, "import-v3": true }), { kind: "not_found" });
    assert.deepEqual(legacyChessComDecision({ "onboarding-v3": true, "import-v3": false }), { kind: "serve", markOnboarded: false });
    assert.deepEqual(legacyChessComDecision({ "onboarding-v3": false, "import-v3": true }), { kind: "serve", markOnboarded: true });
    assert.deepEqual(legacyChessComDecision({ "onboarding-v3": false, "import-v3": false }), { kind: "serve", markOnboarded: true });
  });

  it("regression: legacy-chesscom-profile-bypasses-plan-required: both v3 flags on → 404, nothing written, no upstream call", async () => {
    const res = await profilePOST(post("/api/user/chess-com-profile"));
    assert.equal(res.status, 404);
    assert.deepEqual(world().writes, []);
    assert.deepEqual(world().upstream, []);
    assert.deepEqual(world().limits, []);
  });

  it("onboarding-v3 on, import-v3 off (the profile modal): links the profile and never finishes onboarding", async () => {
    world().flags = { "onboarding-v3": true, "import-v3": false };
    const res = await profilePOST(post("/api/user/chess-com-profile"));
    assert.equal(res.status, 201);
    assert.deepEqual(world().writes, [["chessComProfile.upsert", "41"]]);
    assert.equal(world().writes.some((w) => w[0] === "user.update"), false, "no onboarded write while v3 onboarding is on");
  });

  it("the legacy onboarding page (onboarding-v3 off) keeps its own rule until the parity check", async () => {
    world().flags = { "onboarding-v3": false, "import-v3": false };
    const res = await profilePOST(post("/api/user/chess-com-profile"));
    assert.equal(res.status, 201);
    assert.deepEqual(world().writes, [["chessComProfile.upsert", "41"], ["user.update", { onboarded: true }]]);
  });

  it("every served request spends the lookup buckets first; a denial is a 429 with Retry-After and no upstream call", async () => {
    world().flags = { "onboarding-v3": false, "import-v3": false };
    world().allowed = false;
    const res = await profilePOST(post("/api/user/chess-com-profile"));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "42");
    assert.deepEqual(world().upstream, []);
    assert.deepEqual(world().writes, []);
    assert.deepEqual(world().limits, [
      { buckets: ["lookup", "lookup-ip"], subject: { clerkUserId: "user_nonmember", ip: "198.51.100.7" } },
    ]);
  });

  it("regression: legacy-preview-unthrottled: the preview is 404 with v3 on, and rate limited while served", async () => {
    let res = await previewPOST(post("/api/user/chess-com-profile/preview"));
    assert.equal(res.status, 404);
    assert.deepEqual(world().upstream, []);

    world().flags = { "onboarding-v3": false, "import-v3": false };
    res = await previewPOST(post("/api/user/chess-com-profile/preview"));
    assert.equal(res.status, 200);
    assert.deepEqual(world().upstream, ["preview:somebody"]);
    assert.equal(world().limits.length, 1);

    world().allowed = false;
    res = await previewPOST(post("/api/user/chess-com-profile/preview"));
    assert.equal(res.status, 429);
    assert.deepEqual(world().upstream, ["preview:somebody"], "a denied lookup never reaches Chess.com");
  });
});
