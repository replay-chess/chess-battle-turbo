// route() step 6b: the `etagProbe` hook (phase-03 plan §7 "ETag probe", task D2). With If-None-Match and a matching
// probe tag the wrapper answers 304 without running the handler (one probe statement in A1/A2); otherwise the handler
// runs and its own tag is sent. The probe never runs without If-None-Match, never on a non-ETag tier, and a null probe
// (unknown resource) falls through to the handler (which answers 404 itself).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { z } from "zod";
import type { EndpointDef } from "@repo/contracts/http/endpoint";
import { installTestDeps, noParams, request, viewerFixture } from "../../test/helpers/route-harness";
import { ApiError } from "./api-error";
import { respondWith } from "./respond";
import { route } from "./route";
import { recordQuery } from "./timing";

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function setup() {
  const t = installTestDeps({ userId: "user_1", viewer: viewerFixture() });
  restore = t.restore;
  return t.recorded;
}

const spec = {
  id: "test.probe",
  method: "GET",
  path: "/api/test/{ref}",
  auth: "user",
  cache: "private-etag",
  params: z.object({ ref: z.string() }),
  response: z.object({ n: z.number() }),
} as const satisfies EndpointDef;

function probed(tag: string | null, counters: { probe: number; handler: number }, handlerTag = tag ?? "r1-9") {
  return route(
    {
      ...spec,
      etagProbe: async () => {
        counters.probe += 1;
        recordQuery(0.1, false, "$queryRawUnsafe");
        return tag;
      },
    },
    async () => {
      counters.handler += 1;
      recordQuery(0.1, false, "$queryRawUnsafe");
      return respondWith({ n: 1 }, { etag: handlerTag });
    },
  );
}

const call = (handler: ReturnType<typeof probed>, headers: Record<string, string> = {}) =>
  handler(request("/api/test/x", { headers }), noParams({ ref: "x" }));

describe("route(): etagProbe (step 6b)", () => {
  it("a matching If-None-Match → 304 with the tier headers and the tag; the handler never runs", async () => {
    const recorded = setup();
    const counters = { probe: 0, handler: 0 };
    const res = await call(probed("r1-7", counters), { "if-none-match": '"r1-7"' });
    assert.equal(res.status, 304);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("etag"), '"r1-7"');
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    assert.ok(res.headers.get("x-request-id"));
    assert.deepEqual(counters, { probe: 1, handler: 0 });
    const line = recorded.logs.find((l) => l.message === "api");
    assert.equal(line?.context.dbStatements, 1, "the 304 path costs the probe's statement only");
  });

  it("a weak or listed If-None-Match matches too (RFC 9110 weak comparison)", async () => {
    setup();
    const counters = { probe: 0, handler: 0 };
    const res = await call(probed("r1-7", counters), { "if-none-match": 'W/"r0", W/"r1-7"' });
    assert.equal(res.status, 304);
    assert.equal(counters.handler, 0);
  });

  it("a stale If-None-Match runs the handler, which answers 200 with its own (equal) tag", async () => {
    setup();
    const counters = { probe: 0, handler: 0 };
    const res = await call(probed("r1-8", counters), { "if-none-match": '"r1-7"' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), '"r1-8"');
    assert.deepEqual(counters, { probe: 1, handler: 1 });
  });

  it("no If-None-Match: the probe does not run (a cold read is the payload statement only)", async () => {
    setup();
    const counters = { probe: 0, handler: 0 };
    const res = await call(probed("r1-7", counters));
    assert.equal(res.status, 200);
    assert.deepEqual(counters, { probe: 0, handler: 1 });
  });

  it("a null probe (unknown resource) falls through to the handler", async () => {
    setup();
    const counters = { probe: 0, handler: 0 };
    const res = await call(probed(null, counters, "r1-9"), { "if-none-match": '"r1-7"' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), '"r1-9"');
    assert.deepEqual(counters, { probe: 1, handler: 1 });
  });

  it("a probe that throws is the route's error (e.g. the 402 of a lapsed reader), in the envelope", async () => {
    setup();
    const handler = route(
      {
        ...spec,
        etagProbe: async () => {
          throw new ApiError("subscription_required", { details: { reason: "expired" } });
        },
      },
      async () => respondWith({ n: 1 }, { etag: "r1-7" }),
    );
    const res = await call(handler, { "if-none-match": '"r1-7"' });
    assert.equal(res.status, 402);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

  it("the hook is ignored on a tier without an ETag (no-store)", async () => {
    setup();
    const counters = { probe: 0, handler: 0 };
    const handler = route(
      {
        ...spec,
        cache: "no-store",
        etagProbe: async () => {
          counters.probe += 1;
          return "r1-7";
        },
      },
      async () => {
        counters.handler += 1;
        return { n: 1 };
      },
    );
    const res = await call(handler, { "if-none-match": '"r1-7"' });
    assert.equal(res.status, 200);
    assert.deepEqual(counters, { probe: 0, handler: 1 });
  });
});
