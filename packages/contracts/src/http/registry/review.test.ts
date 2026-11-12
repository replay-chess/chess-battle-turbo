// The P3 review registry entries as phase-03 plan §7.2 declares them (A1–A9b): auth, cache tier, GET side effects,
// rate-limit buckets, success statuses and body limits.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROGRESS_BODY_MAX_BYTES } from "../review";
import { getEndpoint } from "./index";
import { reviewEndpoints } from "./review";

describe("review registry (phase-03 §7.2)", () => {
  it("reads are private-etag (A8 no-store); only A1/A2 may kick-CAS and only A2/A9 may write legend facts", () => {
    assert.equal(getEndpoint("review.get").cache, "private-etag");
    assert.deepEqual(getEndpoint("review.get").sideEffects, ["kick_cas"]);
    assert.deepEqual(getEndpoint("review.status").sideEffects, ["kick_cas", "legend_facts"]);
    assert.deepEqual(getEndpoint("review.legend").sideEffects, ["legend_facts"]);
    assert.equal(getEndpoint("review.pgn").cache, "no-store");
    assert.equal(getEndpoint("review.pgn").responseFormat, "text");
    for (const e of Object.values(reviewEndpoints)) {
      if (e.method !== "GET") assert.equal(e.cache, "no-store", e.id);
      if (!["review.get", "review.status", "review.legend"].includes(e.id)) assert.equal("sideEffects" in e, false, e.id);
    }
  });

  it("reads are auth user (the handler answers 402; review-lapsed-read), writes are member", () => {
    for (const e of Object.values(reviewEndpoints)) {
      assert.equal(e.auth, e.method === "GET" ? "user" : "member", e.id);
      if (e.method === "GET") assert.ok(e.errors?.includes("subscription_required"), e.id);
    }
  });

  it("buckets: review-analyse 10/60 s (A3, A4, A9b), review-write 120/60 s (A5, A6, A7)", () => {
    const analyse = { bucket: "review-analyse", limit: 10, windowSec: 60, by: "user" };
    const write = { bucket: "review-write", limit: 120, windowSec: 60, by: "user" };
    for (const id of ["review.analyse", "review.retry", "review.legend.compute"] as const) assert.deepEqual(getEndpoint(id).rateLimit, analyse);
    for (const id of ["review.progress", "review.moment", "review.complete"] as const) assert.deepEqual(getEndpoint(id).rateLimit, write);
  });

  it("statuses and limits: A3/A4/A9b 202, A5 204 with an 8 KB body, gone/conflict declared", () => {
    assert.equal(getEndpoint("review.analyse").status, 202);
    assert.equal(getEndpoint("review.retry").status, 202);
    assert.equal(getEndpoint("review.legend.compute").status, 202);
    assert.equal(getEndpoint("review.progress").status, 204);
    assert.equal(getEndpoint("review.progress").maxBodyBytes, PROGRESS_BODY_MAX_BYTES);
    for (const id of ["review.analyse", "review.retry", "review.legend.compute"] as const) {
      assert.ok(getEndpoint(id).errors?.includes("gone"), id);
      assert.ok(getEndpoint(id).errors?.includes("conflict"), id);
    }
  });

  it("empty bodies are accepted where the body is `{}` (Finish Review is a keepalive POST without one)", () => {
    assert.deepEqual(getEndpoint("review.complete").body.parse(undefined), {});
    assert.deepEqual(getEndpoint("review.retry").body.parse(undefined), {});
    assert.deepEqual(getEndpoint("review.legend.compute").body.parse(undefined), {});
    assert.deepEqual(getEndpoint("review.analyse").body.parse(undefined), { reason: "opened" });
    assert.throws(() => getEndpoint("review.complete").body.parse({ extra: 1 }));
  });
});
