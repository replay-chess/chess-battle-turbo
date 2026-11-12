// The P3 registry entries beyond the review routes (phase-03 plan §7.2 A10, A11, G1, PR1), plus the P3-wide lints
// of task D6: every P3 route is private (no public tier, so no per-user response can carry a max-age, AP-04), the
// only GET side effects are A1/A2 `kick_cas` and A2/A9 `legend_facts` (P3-D23), and the buckets are the plan's.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRIVATE_CACHE_TIERS, expectedErrorCodes } from "../endpoint";
import { ShareCreateBody } from "../share";
import { archiveEndpoints } from "./archive";
import { getEndpoint } from "./index";
import { practiceEndpoints } from "./practice";
import { reviewEndpoints } from "./review";
import { shareEndpoints } from "./share";

const P3 = [
  ...Object.values(reviewEndpoints),
  ...Object.values(shareEndpoints),
  ...Object.values(archiveEndpoints),
  ...Object.values(practiceEndpoints),
];

describe("P3 registry lint (task D6)", () => {
  it("every P3 route is private: a private tier, never public-*, never auth public", () => {
    for (const e of P3) {
      const tier = e.cache ?? "no-store";
      assert.ok((PRIVATE_CACHE_TIERS as readonly string[]).includes(tier), `${e.id}: ${tier}`);
      assert.notEqual(e.auth, "public", e.id);
    }
  });

  it("GET side effects are exactly the declared kick CAS (A1, A2) and lazy legend facts (A2, A9)", () => {
    const declared = Object.fromEntries(P3.filter((e) => "sideEffects" in e).map((e) => [e.id, e.sideEffects]));
    assert.deepEqual(declared, {
      "review.get": ["kick_cas"],
      "review.status": ["kick_cas", "legend_facts"],
      "review.legend": ["legend_facts"],
    });
  });

  it("every P3 GET that returns JSON revalidates with a strong ETag (private-etag), downloads are no-store", () => {
    for (const e of P3) {
      if (e.method !== "GET") continue;
      const expected = e.id === "review.pgn" ? "no-store" : "private-etag";
      assert.equal(e.cache, expected, e.id);
    }
  });

  it("rate-limit buckets: share-create 5/60 s, share-edit 10/60 s, all per user", () => {
    assert.deepEqual(getEndpoint("share.create").rateLimit, { bucket: "share-create", limit: 5, windowSec: 60, by: "user" });
    assert.deepEqual(getEndpoint("share.update").rateLimit, { bucket: "share-edit", limit: 10, windowSec: 60, by: "user" });
    assert.deepEqual(getEndpoint("share.revoke").rateLimit, { bucket: "share-edit", limit: 10, windowSec: 60, by: "user" });
    assert.equal("rateLimit" in getEndpoint("me.games"), false);
    assert.equal("rateLimit" in getEndpoint("practice.context"), false);
  });
});

describe("A10 / A11 (share)", () => {
  it("A10: member, POST under the review, 201, the idempotency and conflict errors declared", () => {
    const create = getEndpoint("share.create");
    assert.equal(create.path, "/api/review/{ref}/share");
    assert.equal(create.auth, "member");
    assert.equal(create.status, 201);
    for (const code of ["conflict", "idempotency_key_reused", "in_flight", "rate_limited", "subscription_required", "not_found"] as const) {
      assert.ok(expectedErrorCodes(create).includes(code), code);
    }
  });

  it("A10 body: showUsername defaults on, `from` defaults to review_menu, unknown `from` is a 400", () => {
    assert.deepEqual(ShareCreateBody.parse({}), { showUsername: true, from: "review_menu" });
    assert.deepEqual(ShareCreateBody.parse({ showUsername: false, momentPly: 36, from: "complete" }), {
      showUsername: false,
      momentPly: 36,
      from: "complete",
    });
    assert.throws(() => ShareCreateBody.parse({ from: "home" }));
  });

  it("A11: PATCH answers ShareDTO (410 gone declared), DELETE is a 204 with no body; both owner-scoped by code", () => {
    const update = getEndpoint("share.update");
    const revoke = getEndpoint("share.revoke");
    assert.equal(update.path, "/api/share/{code}");
    assert.equal(revoke.path, "/api/share/{code}");
    assert.ok(update.errors?.includes("gone"));
    assert.equal(revoke.status, 204);
    assert.equal("response" in revoke, false);
    assert.throws(() => update.params.parse({ code: "8KQ2XH4M" }), "codes are lowercase");
    assert.throws(() => update.params.parse({ code: "8kq2xh4u" }), "no u in Crockford base32");
    assert.throws(() => update.body.parse({ showUsername: true, extra: 1 }), "strict body");
  });

  // regression: lapsed-owner-cannot-revoke (FIX-1). A11 was member-only, so an owner whose membership lapsed could
  // not turn off or anonymise the public page of their game for up to 30 days.
  it("A11 is open to any signed-in owner (auth user); A10 stays member", () => {
    assert.equal(getEndpoint("share.update").auth, "user");
    assert.equal(getEndpoint("share.revoke").auth, "user");
    assert.equal(getEndpoint("share.create").auth, "member");
  });
});

describe("G1 and PR1", () => {
  it("G1: GET /api/me/games, auth user (the handler answers 402; review-lapsed-read), private-etag, limit 0..30", () => {
    const list = getEndpoint("me.games");
    assert.equal(list.path, "/api/me/games");
    assert.equal(list.auth, "user");
    assert.ok(list.errors?.includes("subscription_required"));
    assert.equal(list.query.parse({}).limit, 30);
    assert.equal(list.query.parse({ limit: "0" }).limit, 0);
    assert.throws(() => list.query.parse({ limit: "31" }));
    assert.equal(list.query.parse({ moments: "0" }).moments, false, "never Boolean('0')");
    assert.throws(() => list.query.parse({ cursor: "not a cursor!" }));
  });

  it("PR1: GET /api/practice/context, member, exactly one source", () => {
    const ctx = getEndpoint("practice.context");
    assert.equal(ctx.auth, "member");
    assert.equal(ctx.cache, "private-etag");
    assert.ok(expectedErrorCodes(ctx).includes("not_found"));
    assert.ok(ctx.query.safeParse({ game: "c0123456789abcdefghijkl", ply: "4" }).success);
    assert.equal(ctx.query.safeParse({}).success, false);
    assert.equal(ctx.query.safeParse({ fen: "8/8/8/8/8/8/8/K6k w - - 0 1", position: "c0123456789abcdefghijkl" }).success, false);
  });
});
