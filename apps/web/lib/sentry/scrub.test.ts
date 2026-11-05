import { test } from "node:test";
import assert from "node:assert/strict";
import { REDACTED, scrubEvent, sentryScrubOptions } from "./scrub";

const event = () => ({
  request: {
    url: "https://app.example/api/cron/tasks?task=reconcile&__clerk_db_jwt=abc&token=t",
    query_string: "task=reconcile&__clerk_db_jwt=abc&token=t",
    cookies: { __session: "jwt", __client_uat: "1" },
    data: { email: "a@b.c" },
    env: { REMOTE_ADDR: "1.2.3.4" },
    headers: {
      authorization: "Bearer cron-secret",
      cookie: "__session=jwt",
      "x-internal-token": "internal",
      "x-e2e-token": "e2e",
      "x-perf-token": "perf",
      "x-forwarded-for": "1.2.3.4",
      "User-Agent": "UA",
      "x-request-id": "rid",
      "content-type": "application/json",
    },
  },
  user: { id: "ref_1", ip_address: "1.2.3.4", email: "a@b.c" },
});

test("drops cookies, body, env and every credential header; keeps the allow-list", () => {
  const e = scrubEvent(event());
  assert.equal(e.request.cookies, undefined);
  assert.equal(e.request.data, undefined);
  assert.equal(e.request.env, undefined);
  assert.deepEqual(e.request.headers, { "User-Agent": "UA", "x-request-id": "rid", "content-type": "application/json" });
});

test("redacts secret query values in query_string and url", () => {
  const e = scrubEvent(event());
  const q = new URLSearchParams(e.request.query_string);
  assert.equal(q.get("task"), "reconcile");
  assert.equal(q.get("__clerk_db_jwt"), REDACTED);
  assert.equal(q.get("token"), REDACTED);
  assert.ok(!e.request.url.includes("abc"));
  assert.ok(e.request.url.startsWith("https://app.example/api/cron/tasks?"));
});

test("object and tuple query strings are redacted too", () => {
  const obj = scrubEvent({ request: { query_string: { ticket: "x", page: "2" } } });
  assert.deepEqual(obj.request.query_string, { ticket: REDACTED, page: "2" });
  const tuples = scrubEvent({ request: { query_string: [["secret", "x"], ["page", "2"]] } });
  assert.deepEqual(tuples.request.query_string, [["secret", REDACTED], ["page", "2"]]);
});

test("removes the IP and email from user, keeps the reference id", () => {
  const e = scrubEvent(event());
  assert.deepEqual(e.user, { id: "ref_1" });
});

test("events without a request pass through", () => {
  assert.deepEqual(scrubEvent({ user: null }), { user: null });
  assert.deepEqual(sentryScrubOptions.beforeSendTransaction({}), {});
});
