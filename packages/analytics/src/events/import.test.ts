// Import events (phase-04 plan 10.1): closed property sets, no usernames or refs, and the enums they repeat stay equal
// to the wire contracts. Drift guard only: the analytics package has no runtime dependency on the contracts package.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IMPORT_ERROR_CODES, IMPORT_TRIGGERS, PROVIDER_SLUGS } from "../../../contracts/src/http/p04-plain";
import { IMPORT_EVENT_CODES, IMPORT_EVENT_PROVIDERS, IMPORT_EVENT_TRIGGERS, importEvents, importServerEvents } from "./import";

describe("import events", () => {
  it("the enums it repeats equal the wire contracts (no drift)", () => {
    assert.deepEqual([...IMPORT_EVENT_CODES], [...IMPORT_ERROR_CODES]);
    assert.deepEqual([...IMPORT_EVENT_TRIGGERS], [...IMPORT_TRIGGERS]);
    assert.deepEqual([...IMPORT_EVENT_PROVIDERS], [...PROVIDER_SLUGS]);
  });

  it("accepts the documented shapes and refuses extra keys", () => {
    assert.ok(importServerEvents.import_started.safeParse({ provider: "chesscom", trigger: "initial" }).success);
    assert.equal(importServerEvents.import_started.safeParse({ provider: "chesscom", trigger: "initial", username: "x" }).success, false);
    const finished = {
      provider: "lichess",
      trigger: "daily",
      imported: 12,
      skipped: 1,
      total: 13,
      analysis_queued: 5,
      duration_ms: 4_000,
      reading_ms: 3_000,
      saving_ms: 1_000,
      first_chunk_ms: null,
      upstream_requests: 2,
      upstream_304_count: 1,
    };
    assert.ok(importServerEvents.import_finished.safeParse(finished).success);
    assert.equal(importServerEvents.import_finished.safeParse({ ...finished, gameRef: "cabc" }).success, false);
    assert.ok(importServerEvents.import_failed.safeParse({ provider: "chesscom", trigger: "retry", code: "not_found", attempts: 1 }).success);
    assert.equal(importServerEvents.import_failed.safeParse({ provider: "chesscom", trigger: "retry", code: "token_revoked", attempts: 1 }).success, false);
    assert.ok(importServerEvents.import_rate_limited.safeParse({ provider: "lichess", trigger: "manual", pause_sec: 60 }).success);
    assert.ok(importServerEvents.import_backlog_released.safeParse({ games: 150, slices: 7, trigger: "first_charge" }).success);
    assert.ok(importServerEvents.review_ready_after_import.safeParse({ provider: "chesscom", ms_since_entitled: 90_000 }).success);
    assert.ok(importServerEvents.account_purge_completed.safeParse({ provider: "chesscom", games: 0 }).success);
  });

  it("every import event is a server event", () => {
    assert.deepEqual(Object.keys(importEvents).sort(), Object.keys(importServerEvents).sort());
  });
});
