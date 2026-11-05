import assert from "node:assert/strict";
import { test } from "node:test";
import { getEndpoint } from "@repo/contracts/http/registry";
import { ENDPOINT_IDS, endpoints } from "./endpoints";

test("every client path equals its registry entry's path", () => {
  for (const [name, id] of Object.entries(ENDPOINT_IDS)) {
    assert.equal(endpoints[name as keyof typeof endpoints], getEndpoint(id).path, name);
  }
});

test("every endpoints entry names a registry id", () => {
  assert.deepEqual(Object.keys(endpoints).sort(), Object.keys(ENDPOINT_IDS).sort());
});
