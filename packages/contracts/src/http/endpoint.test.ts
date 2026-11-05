import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  defineEndpoint,
  endpointProblems,
  expectedErrorCodes,
  fillPath,
  pathParamNames,
  successStatusOf,
  type EndpointDef,
} from "./endpoint";

const base: EndpointDef = { id: "x.get", method: "GET", path: "/api/x", auth: "user" };

describe("defineEndpoint", () => {
  it("returns the definition unchanged", () => {
    const def = defineEndpoint({ ...base, response: z.object({ a: z.string() }) });
    assert.equal(def.id, "x.get");
  });

  it("rejects a public tier without auth public", () => {
    assert.throws(() => defineEndpoint({ ...base, cache: "public-short", publicShort: { tags: [] } }), /requires auth "public"/);
  });

  it("rejects public-static without publicStatic and public-immutable without versionParam", () => {
    assert.throws(() => defineEndpoint({ ...base, auth: "public", cache: "public-static" }), /requires publicStatic/);
    assert.throws(() => defineEndpoint({ ...base, auth: "public", cache: "public-immutable" }), /requires versionParam/);
    assert.doesNotThrow(() => defineEndpoint({ ...base, auth: "public", cache: "public-immutable", versionParam: "v" }));
  });

  it("rejects a burst limit over 300 s and accepts it as durable", () => {
    const rl = { bucket: "b", limit: 5, windowSec: 3600, by: "user" } as const;
    assert.throws(() => defineEndpoint({ ...base, rateLimit: rl }), /burst window/);
    assert.throws(() => defineEndpoint({ ...base, rateLimit: [{ ...rl, windowSec: 60 }, rl] }), /burst window/);
    assert.doesNotThrow(() => defineEndpoint({ ...base, rateLimit: { ...rl, store: "durable" } }));
  });

  it("rejects side effects on non-GETs and non-GET cron routes", () => {
    assert.throws(() => defineEndpoint({ ...base, method: "POST", sideEffects: ["cron"] }), /only for GET/);
    assert.throws(() => defineEndpoint({ ...base, method: "POST", path: "/api/cron/x", auth: "cron" }), /cron routes must be GET/);
  });

  it("rejects cached tiers on writes but allows sse on POST", () => {
    assert.throws(() => defineEndpoint({ ...base, method: "POST", cache: "private-etag" }), /only for GET/);
    assert.doesNotThrow(() => defineEndpoint({ ...base, method: "POST", cache: "sse" }));
  });

  it("checks path shape and path parameters", () => {
    assert.match(endpointProblems({ ...base, path: "/api/x/[id]" }).join(), /\{name\}/);
    assert.match(endpointProblems({ ...base, path: "/x" }).join(), /must start with \/api\//);
    assert.match(endpointProblems({ ...base, path: "/api/x/{ref}" }).join(), /needs a params schema/);
    assert.deepEqual(endpointProblems({ ...base, path: "/api/x/{ref}", params: z.object({ ref: z.string() }) }), []);
  });

  it("rejects a body on GET and a response on 204", () => {
    assert.match(endpointProblems({ ...base, body: z.object({}) }).join(), /must not declare a body/);
    assert.match(endpointProblems({ ...base, method: "POST", status: 204, response: z.null() }).join(), /204/);
  });
});

describe("helpers", () => {
  it("pathParamNames and fillPath", () => {
    assert.deepEqual(pathParamNames("/api/games/{ref}/moves/{ply}"), ["ref", "ply"]);
    assert.equal(fillPath("/api/games/{ref}/moves/{ply}", { ref: "a b", ply: 3 }), "/api/games/a%20b/moves/3");
    assert.equal(fillPath("/api/me"), "/api/me");
    assert.throws(() => fillPath("/api/games/{ref}"), /missing "ref"/);
  });

  it("successStatusOf", () => {
    assert.equal(successStatusOf(base), 204);
    assert.equal(successStatusOf({ ...base, response: z.null() }), 200);
    assert.equal(successStatusOf({ ...base, responseFormat: "text" }), 200);
    assert.equal(successStatusOf({ ...base, method: "POST", status: 201, response: z.null() }), 201);
  });

  it("expectedErrorCodes follows auth mode, schemas and rate limit", () => {
    assert.deepEqual(expectedErrorCodes({ ...base, auth: "public" }), ["internal"]);
    assert.deepEqual(expectedErrorCodes(base), ["unauthorized", "internal"]);
    assert.deepEqual(
      expectedErrorCodes({
        ...base,
        method: "POST",
        auth: "member",
        body: z.object({}),
        rateLimit: { bucket: "b", limit: 1, windowSec: 60, by: "user" },
        errors: ["conflict"],
      }),
      ["invalid_json", "validation_failed", "unauthorized", "subscription_required", "conflict", "payload_too_large", "rate_limited", "internal"],
    );
    assert.deepEqual(expectedErrorCodes({ ...base, auth: "admin" }), ["unauthorized", "forbidden", "internal"]);
    assert.deepEqual(expectedErrorCodes({ ...base, auth: "owner" }), ["unauthorized", "not_found", "internal"]);
  });
});
