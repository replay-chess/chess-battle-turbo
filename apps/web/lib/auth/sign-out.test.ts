import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearLocalSession, signOutEverywhere, type SignOutDeps } from "./sign-out";

function recorder() {
  const steps: string[] = [];
  const deps: SignOutDeps = {
    setIntent: () => void steps.push("intent"),
    clearUserStore: () => void steps.push("store"),
    purgeCaches: async () => void steps.push("caches"),
    clearServerCache: async () => void steps.push("session/clear"),
    resetAnalytics: () => void steps.push("posthog"),
    resetSentryUser: () => void steps.push("sentry"),
    broadcast: () => void steps.push("broadcast"),
  };
  const clerk = {
    signOut: async (o: { redirectUrl: string }) => {
      steps.push(`clerk:${o.redirectUrl}`);
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
    assert.deepEqual(steps, ["intent", "store", "caches", "session/clear", "posthog", "sentry", "broadcast", "clerk:/"]);
    assert.equal(qc.getQueryData(["me"]), undefined, "query cache cleared");
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
    assert.deepEqual(steps, ["intent", "store", "session/clear", "posthog", "sentry", "broadcast", "clerk:/sign-in?redirect_url=%2Fplay"]);
  });
});

describe("clearLocalSession", () => {
  it("runs only the local steps: no intent, no server call, no broadcast, no Clerk", async () => {
    const { steps, deps } = recorder();
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: { ref: "u1" } });
    await clearLocalSession(qc, deps);
    assert.deepEqual(steps, ["store", "caches", "posthog", "sentry"]);
    assert.equal(qc.getQueryData(["me"]), undefined);
  });
});
