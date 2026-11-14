import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearAfterExternalSignOut, clearLocalSession, signOutEverywhere, type SignOutDeps } from "./sign-out";

function recorder(current: string | null = null) {
  const steps: string[] = [];
  const deps: SignOutDeps = {
    setIntent: () => void steps.push("intent"),
    clearUserStore: () => void steps.push("store"),
    purgeCaches: async () => void steps.push("caches"),
    clearServerCache: async () => void steps.push("session/clear"),
    resetAnalytics: () => void steps.push("posthog"),
    resetSentryUser: () => void steps.push("sentry"),
    broadcast: () => void steps.push("broadcast"),
    flushAndClearOutbox: async (userRef: string) => void steps.push(`outbox:${userRef}`),
    clearOfflineStores: async (userRef: string | null) => void steps.push(`offline-clear:${userRef ?? "*"}`),
    currentUserRef: () => current,
    navigate: (url: string) => void steps.push(`navigate:${url}`),
  };
  const clerk = {
    signOut: async (callback: () => void, o: { redirectUrl: string }) => {
      steps.push(`clerk:${o.redirectUrl}`);
      callback();
    },
  };
  return { steps, deps, clerk };
}

describe("signOutEverywhere", () => {
  it("runs the plan §8.6 steps in order and ends with Clerk", async () => {
    const { steps, deps, clerk } = recorder();
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: { ref: "u1" } });
    await signOutEverywhere(clerk, { queryClient: qc, deps });
    // No member known to this tab: every member's offline keys go (FIX-2) before the server session.
    assert.deepEqual(steps, ["intent", "store", "caches", "offline-clear:*", "session/clear", "posthog", "sentry", "broadcast", "clerk:/", "navigate:/"]);
    assert.equal(qc.getQueryData(["me"]), undefined, "query cache cleared");
  });

  it("with the user's ref, the P5 outbox is flushed and cleared before the server session goes", async () => {
    const { steps, deps, clerk } = recorder();
    await signOutEverywhere(clerk, { queryClient: new QueryClient(), userRef: "u_ref", deps });
    assert.deepEqual(steps, [
      "intent",
      "store",
      "caches",
      "outbox:u_ref",
      "session/clear",
      "posthog",
      "sentry",
      "broadcast",
      "clerk:/",
      "navigate:/",
    ]);
  });

  it("a failing outbox flush never stops the sign-out", async () => {
    const { steps, deps, clerk } = recorder();
    await signOutEverywhere(clerk, {
      userRef: "u_ref",
      deps: { ...deps, flushAndClearOutbox: async () => Promise.reject(new Error("idb blocked")) },
    });
    assert.deepEqual(steps, ["intent", "store", "caches", "session/clear", "posthog", "sentry", "broadcast", "clerk:/", "navigate:/"]);
  });

  it("a failing step never stops the rest, and Clerk still signs out", async () => {
    const { steps, deps, clerk } = recorder();
    await signOutEverywhere(clerk, {
      redirectUrl: "/sign-in?redirect_url=%2Fplay",
      deps: {
        ...deps,
        clearServerCache: async () => {
          steps.push("session/clear");
          throw new Error("offline");
        },
        purgeCaches: async () => {
          throw new Error("no caches");
        },
      },
    });
    assert.deepEqual(steps, [
      "intent",
      "store",
      "offline-clear:*",
      "session/clear",
      "posthog",
      "sentry",
      "broadcast",
      "clerk:/sign-in?redirect_url=%2Fplay",
      "navigate:/sign-in?redirect_url=%2Fplay",
    ]);
  });
});

describe("clearLocalSession", () => {
  it("runs only the local steps: no intent, no server call, no broadcast, no Clerk", async () => {
    const { steps, deps } = recorder();
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: { ref: "u1" } });
    await clearLocalSession(qc, deps);
    assert.deepEqual(steps, ["offline-clear:*", "store", "caches", "posthog", "sentry"]);
    assert.equal(qc.getQueryData(["me"]), undefined);
  });
});

describe("clearAfterExternalSignOut", () => {
  it("the local steps plus POST /api/session/clear; no intent, no broadcast, no Clerk", async () => {
    const { steps, deps } = recorder();
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: { ref: "u1" } });
    await clearAfterExternalSignOut(qc, deps);
    assert.deepEqual(steps, ["offline-clear:*", "store", "caches", "posthog", "sentry", "session/clear"]);
    assert.equal(qc.getQueryData(["me"]), undefined);
  });
});

// FIX-1 (§11 Privacy): every sign-out path clears the member's rc-outbox and rc-offline, not only the account menu.
describe("the offline stores on every sign-out path", () => {
  it("\"Use a Different Account\" and onboarding's sign-out (no userRef given) flush and clear the tab's member", async () => {
    const { steps, deps, clerk } = recorder("u_tab");
    await signOutEverywhere(clerk, { queryClient: new QueryClient(), redirectUrl: "/sign-in", deps });
    assert.ok(steps.includes("outbox:u_tab"), steps.join(","));
    assert.ok(steps.indexOf("outbox:u_tab") < steps.indexOf("session/clear"), "before the server session goes");
  });

  it("another tab's local sign-out and an external sign-out clear the stores without a flush", async () => {
    for (const run of [clearLocalSession, clearAfterExternalSignOut]) {
      const { steps, deps } = recorder("u_tab");
      await run(new QueryClient(), deps);
      assert.equal(steps[0], "offline-clear:u_tab");
      assert.ok(!steps.some((s) => s.startsWith("outbox:")), "nothing is sent without a session");
    }
  });

  it("FIX-2: a tab that does not know whose stores it holds (a public page opened directly) clears every member's keys", async () => {
    for (const run of [clearLocalSession, clearAfterExternalSignOut]) {
      const { steps, deps } = recorder(null);
      await run(new QueryClient(), deps);
      assert.equal(steps[0], "offline-clear:*", steps.join(","));
    }
    const { steps, deps, clerk } = recorder(null);
    await signOutEverywhere(clerk, { queryClient: new QueryClient(), deps });
    assert.ok(steps.includes("offline-clear:*"), steps.join(","));
    assert.ok(!steps.some((s) => s.startsWith("outbox:")));
  });
});
