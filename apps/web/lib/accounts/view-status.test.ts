// Plan §12.1 `WEB/lib/accounts/__tests__/view-status.test.ts`: the full product LinkStatus × ImportState ×
// (nextAllowedSyncAt past / future / null) against the §8.11 table.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LINK_VIEW_STATUSES } from "@repo/contracts/http/p04-plain";
import { IMPORT_STATES_DB, LINK_STATUSES_DB, linkViewStatus, type ImportStateDb } from "./view-status";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const PAST = new Date(NOW.getTime() - 1);
const FUTURE = new Date(NOW.getTime() + 30_000);

/** §8.11 (ACTIVE rows): importState → [limited, not limited]. */
const TABLE: Record<ImportStateDb, [string, string]> = {
  WAITING_FOR_MEMBERSHIP: ["waiting_for_membership", "waiting_for_membership"],
  QUEUED: ["queued", "queued"],
  RUNNING: ["syncing", "syncing"],
  RATE_LIMITED: ["rate_limited", "queued"],
  FAILED: ["error", "error"],
  IDLE: ["rate_limited", "linked"],
};

describe("linkViewStatus (§8.11)", () => {
  it("covers the full product", () => {
    let cases = 0;
    for (const status of LINK_STATUSES_DB) {
      for (const importState of IMPORT_STATES_DB) {
        for (const next of [null, PAST, FUTURE, NOW]) {
          const got = linkViewStatus({ status, importState, nextAllowedSyncAt: next }, NOW);
          assert.ok((LINK_VIEW_STATUSES as readonly string[]).includes(got));
          const limited = next === FUTURE;
          const want = status === "ACTIVE" ? TABLE[importState][limited ? 0 : 1] : "error";
          assert.equal(got, want, `${status} ${importState} ${next?.toISOString() ?? "null"}`);
          cases += 1;
        }
      }
    }
    assert.equal(cases, 3 * 6 * 4);
  });

  it("nextAllowedSyncAt exactly now is not limited", () => {
    assert.equal(linkViewStatus({ status: "ACTIVE", importState: "IDLE", nextAllowedSyncAt: NOW }, NOW), "linked");
  });
});
