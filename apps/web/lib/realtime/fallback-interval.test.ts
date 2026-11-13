// Plan §12.1 `fallback-interval.test.ts`: a re-created hook (new render) keeps the module-scoped start time and stops
// after `stopAfterMs` (api-perf AP-20); the schedule steps per finished poll; inactive resets.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACCOUNTS_FALLBACK, IMPORT_STATUS_FALLBACK, fallbackExpired, fallbackInterval } from "./fallback-interval";

const query = () => ({ state: { dataUpdatedAt: 0, errorUpdatedAt: 0 } });

describe("fallbackInterval", () => {
  it("import status: grace, then 3 s × 10, then 10 s", () => {
    const q = query();
    let now = 1_000;
    const seen: (number | false)[] = [fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, now)];
    for (let i = 1; i <= 12; i++) {
      now += 3_000;
      q.state.dataUpdatedAt = now; // a poll finished
      seen.push(fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, now));
    }
    assert.deepEqual(seen, [5_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 10_000, 10_000]);
  });

  it("accounts: 3, 3, 5, then 10 s", () => {
    const q = query();
    const seen: (number | false)[] = [fallbackInterval(q, ACCOUNTS_FALLBACK, true, 0)];
    for (let i = 1; i <= 5; i++) {
      q.state.errorUpdatedAt = i; // an errored poll counts too
      seen.push(fallbackInterval(q, ACCOUNTS_FALLBACK, true, i * 1_000));
    }
    assert.deepEqual(seen, [5_000, 3_000, 3_000, 5_000, 10_000, 10_000]);
  });

  it("re-evaluating without a finished poll (a re-render) keeps the step and the start time", () => {
    const q = query();
    fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, 0);
    for (let render = 0; render < 20; render++) assert.equal(fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, 100 + render), 3_000);
  });

  it("stops after stopAfterMs and reports expiry; inactive resets the schedule", () => {
    const q = query();
    fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, 0);
    q.state.dataUpdatedAt = 1;
    assert.equal(fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, IMPORT_STATUS_FALLBACK.stopAfterMs - 1), 3_000);
    assert.equal(fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, IMPORT_STATUS_FALLBACK.stopAfterMs), false);
    assert.equal(fallbackExpired(q, IMPORT_STATUS_FALLBACK, IMPORT_STATUS_FALLBACK.stopAfterMs), true);
    assert.equal(fallbackInterval(q, IMPORT_STATUS_FALLBACK, false, IMPORT_STATUS_FALLBACK.stopAfterMs + 1), false);
    assert.equal(fallbackExpired(q, IMPORT_STATUS_FALLBACK, IMPORT_STATUS_FALLBACK.stopAfterMs + 1), false);
    assert.equal(fallbackInterval(q, IMPORT_STATUS_FALLBACK, true, IMPORT_STATUS_FALLBACK.stopAfterMs + 2), 5_000, "a new outage starts over");
  });

  it("each query has its own schedule", () => {
    const a = query();
    const b = query();
    fallbackInterval(a, ACCOUNTS_FALLBACK, true, 0);
    a.state.dataUpdatedAt = 1;
    fallbackInterval(a, ACCOUNTS_FALLBACK, true, 1);
    assert.equal(fallbackInterval(b, ACCOUNTS_FALLBACK, true, 2), 5_000);
  });
});
