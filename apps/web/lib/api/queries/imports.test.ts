// regression: p04-request-budget — a page whose RSC seeded qk.imports() makes no GET /api/import/status on mount
// (plan §5.9), while an older copy (a client navigation back to the page, a long-lived tab) is still revalidated.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IMPORT_LIVE_CATCHUP_MS, IMPORT_SEED_FRESH_MS, importCatchUpDue, importStatusQuery, refetchImportsOnMount } from "./imports";

describe("import status: mount refetch", () => {
  const now = 1_800_000_000_000;
  it("skips the mount fetch for a copy seeded a moment ago", () => {
    assert.equal(refetchImportsOnMount({ state: { dataUpdatedAt: now - 300 } }, now), false);
    assert.equal(refetchImportsOnMount({ state: { dataUpdatedAt: now - IMPORT_SEED_FRESH_MS } }, now), false);
  });
  it("revalidates an older copy and an empty cache", () => {
    assert.equal(refetchImportsOnMount({ state: { dataUpdatedAt: now - IMPORT_SEED_FRESH_MS - 1 } }, now), true);
    assert.equal(refetchImportsOnMount({ state: { dataUpdatedAt: 0 } }, now), true);
  });
  it("keeps staleTime 0 and the focus refetch (plan §9.3)", () => {
    const q = importStatusQuery();
    assert.equal(q.staleTime, 0);
    assert.equal(q.refetchOnWindowFocus, true);
    assert.equal(typeof q.refetchOnMount, "function");
  });
});

describe("import status catch-up after the socket goes live (FIX-1)", () => {
  const active = { runs: [{ status: "running" }] } as unknown as Parameters<typeof importCatchUpDue>[0]["data"];
  const done = { runs: [{ status: "done" }] } as unknown as Parameters<typeof importCatchUpDue>[0]["data"];
  it("regression: import-card-stuck-reading: an active run with no update since the socket went live is fetched once", () => {
    const liveAt = 1_000_000;
    assert.equal(importCatchUpDue({ liveAt, nowMs: liveAt + IMPORT_LIVE_CATCHUP_MS, dataUpdatedAt: liveAt - 5_000, data: active }), true);
    assert.equal(importCatchUpDue({ liveAt, nowMs: liveAt + IMPORT_LIVE_CATCHUP_MS, dataUpdatedAt: liveAt + 2_000, data: active }), false, "events kept it fresh");
    assert.equal(importCatchUpDue({ liveAt, nowMs: liveAt + IMPORT_LIVE_CATCHUP_MS, dataUpdatedAt: liveAt - 5_000, data: done }), false, "nothing moving");
    assert.equal(importCatchUpDue({ liveAt, nowMs: liveAt + 3_000, dataUpdatedAt: liveAt - 5_000, data: active }), false, "not yet");
  });
});
