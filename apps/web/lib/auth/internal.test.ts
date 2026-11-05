import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INTERNAL_ROUTE_IDS, verifyInternalRequest } from "./internal";

const req = (token?: string) => ({ headers: new Headers(token === undefined ? {} : { "x-internal-token": token }) });
const env = { INTERNAL_API_SECRET: "s3cret-internal" };

describe("verifyInternalRequest (P1-21)", () => {
  it("accepts the token only on listed ids", () => {
    for (const id of INTERNAL_ROUTE_IDS) assert.equal(verifyInternalRequest(req("s3cret-internal"), id, env), true, id);
    assert.equal(verifyInternalRequest(req("s3cret-internal"), "me.get", env), false);
  });
  it("rejects a wrong, shorter, longer or missing token, and an unset secret", () => {
    assert.equal(verifyInternalRequest(req("s3cret-internaX"), "chess.move", env), false);
    assert.equal(verifyInternalRequest(req("s3cret"), "chess.move", env), false);
    assert.equal(verifyInternalRequest(req("s3cret-internal-more"), "chess.move", env), false);
    assert.equal(verifyInternalRequest(req(), "chess.move", env), false);
    assert.equal(verifyInternalRequest(req(""), "chess.move", {}), false);
  });
});
