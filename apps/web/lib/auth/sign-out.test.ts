import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  CLERK_BEFOREUNLOAD_EVENT,
  clearAfterExternalSignOut,
  clearLocalSession,
  leavePage,
  signOutEverywhere,
  type SignOutDeps,
} from "./sign-out";

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
    assert.deepEqual(steps, ["intent", "store", "caches", "session/clear", "posthog", "sentry", "broadcast", "clerk:/", "navigate:/"]);
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
    assert.deepEqual(steps, [
      "intent",
      "store",
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
    assert.deepEqual(steps, ["store", "caches", "posthog", "sentry"]);
    assert.equal(qc.getQueryData(["me"]), undefined);
  });
});

describe("clearAfterExternalSignOut", () => {
  it("the local steps plus POST /api/session/clear; no intent, no broadcast, no Clerk", async () => {
    const { steps, deps } = recorder();
    const qc = new QueryClient();
    qc.setQueryData(["me"], { user: { ref: "u1" } });
    await clearAfterExternalSignOut(qc, deps);
    assert.deepEqual(steps, ["store", "caches", "posthog", "sentry", "session/clear"]);
    assert.equal(qc.getQueryData(["me"]), undefined);
  });
});

// clerk-js 5.x signOut(callback): the callback runs inside a before-unload tracker (window `beforeunload` or
// `clerk:beforeunload`); when the page is not unloading by the time it returns, Clerk emits the signed-out state and
// calls window.__unstable__onAfterSetActive (the Next provider's router.refresh()). A model of that, over a window
// that, like WebKit, does not fire `beforeunload` inside location.assign().
function webkitLikeWindow() {
  const target = new EventTarget();
  const log: string[] = [];
  const win = {
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    location: { assign: (url: string) => void log.push(`assign:${url}`) },
  };
  const clerk = {
    signOut: async (callback: () => void) => {
      let unloading = false;
      const mark = () => (unloading = true);
      win.addEventListener("beforeunload", mark);
      win.addEventListener(CLERK_BEFOREUNLOAD_EVENT, mark);
      await callback();
      win.removeEventListener("beforeunload", mark);
      win.removeEventListener(CLERK_BEFOREUNLOAD_EVENT, mark);
      if (!unloading) log.push("emit signed out", "router.refresh");
    },
  };
  return { win, clerk, log };
}

describe("leavePage (the navigation after Clerk's sign-out)", () => {
  // regression: on WebKit (webkit-iphone, phone shell) sign-out from /play ended on /sign-in?redirect_url=%2Fplay: the
  // refresh Clerk ran after a plain location.assign("/") hit the middleware's sign-in redirect and replaced the load.
  it("tells Clerk the page is unloading, so no refresh races the load of /", async () => {
    const { win, clerk, log } = webkitLikeWindow();
    const { deps } = recorder();
    await signOutEverywhere(clerk, { deps: { ...deps, navigate: (url) => leavePage(url, win) } });
    assert.deepEqual(log, ["assign:/"]);
  });

  it("a bare location.assign leaves the refresh in (the old behaviour this replaces)", async () => {
    const { win, clerk, log } = webkitLikeWindow();
    const { deps } = recorder();
    await signOutEverywhere(clerk, { deps: { ...deps, navigate: (url) => win.location.assign(url) } });
    assert.deepEqual(log, ["assign:/", "emit signed out", "router.refresh"]);
  });
});
