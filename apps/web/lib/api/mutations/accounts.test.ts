// The pure cache writers of lib/api/mutations/accounts.ts and imports.ts (the hooks are exercised in the e2e suite).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import type { MeData } from "@repo/contracts/http/me";
import { meAfterLink, optimisticRun, patchAccount, prependRun, removeAccount, upsertAccount } from "./accounts";
import { markRunQueued } from "./imports";

const NOW = "2026-11-12T10:00:00.000Z";
const run = RunView.parse(optimisticRun("chesscom", NOW));
const account = (provider: "chesscom" | "lichess"): LinkedAccountView =>
  LinkedAccountView.parse({
    provider,
    username: "u",
    displayName: null,
    avatarUrl: null,
    title: null,
    ratings: {},
    headline: null,
    totalRatedGames: null,
    verified: provider === "lichess",
    status: "linked",
    autoImport: true,
    lastSyncAt: null,
    lastSyncOkAt: null,
    nextAllowedSyncAt: null,
    nextAutoSyncAt: null,
    importedCount: 0,
    skippedCount: 0,
    lastError: null,
    run: null,
  });

describe("account cache writers", () => {
  it("upsert keeps one account per provider in provider order; remove and patch", () => {
    let d = upsertAccount(undefined, account("lichess"));
    d = upsertAccount(d, account("chesscom"));
    d = upsertAccount(d, { ...account("chesscom"), username: "v" });
    assert.deepEqual(d.items.map((a) => [a.provider, a.username]), [["chesscom", "v"], ["lichess", "u"]]);
    assert.deepEqual(removeAccount(d, "chesscom")?.items.map((a) => a.provider), ["lichess"]);
    assert.equal(patchAccount(d, "lichess", { status: "syncing" })?.items[1]!.status, "syncing");
    assert.equal(removeAccount(undefined, "lichess"), undefined);
  });

  it("the optimistic run is a valid RunView; prependRun keeps ≤ 5 newest; markRunQueued clears the error", () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({ ...run, ref: `crun${String(i).padStart(22, "0")}` }));
    const d = prependRun({ runs, firstReview: null }, run)!;
    assert.equal(d.runs.length, 5);
    assert.equal(d.runs[0]!.ref, run.ref);
    const failed = { runs: [{ ...run, status: "failed" as const, error: { code: "upstream" as const, at: NOW, retryAt: null } }], firstReview: null };
    assert.deepEqual(markRunQueued(failed, run.ref)!.runs[0]!.status, "queued");
    assert.equal(markRunQueued(failed, run.ref)!.runs[0]!.error, null);
  });

  it("meAfterLink merges the account summary, the run and the onboarding state", () => {
    const me = { user: {}, entitlement: {}, flags: {}, buildId: "b", accounts: [{ provider: "lichess", username: "x", status: "linked", lastSyncAt: null }] } as unknown as MeData;
    const next = meAfterLink(me, { account: account("chesscom"), run, onboarding: null })!;
    assert.deepEqual(next.accounts?.map((a) => a.provider), ["lichess", "chesscom"]);
    assert.equal(next.import?.ref, run.ref);
    assert.equal(meAfterLink(undefined, { account: account("chesscom"), run: null, onboarding: null }), undefined);
  });
});
