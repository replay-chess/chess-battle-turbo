import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import {
  RECOVERY_WINDOW_MS,
  cancelDeferredSessionExpired,
  createSessionGuard,
  deferredSessionExpired,
  holdSessionExpired,
  openSessionExpired,
  defaultIsPublicPath,
  isSessionPublicPath,
  postAuthMessage,
  refetchUnauthorizedQueries,
  safeReturnPath,
  sessionExpiredStore,
  setPublicPathClassifier,
  signInHref,
  subscribeAuthMessages,
  type ClerkSessionLike,
} from "./session-guard";

const err401 = () => new ApiError({ status: 401, code: "unauthorized" });

function harness(opts: { sessionAfterReload: boolean; reloadThrows?: boolean }) {
  let t = 1_000_000;
  let reloads = 0;
  const opened: string[] = [];
  let open = false;
  const clerk: { session: ClerkSessionLike["session"] } = {
    session: {
      reload: async () => {
        reloads++;
        await new Promise((r) => setTimeout(r, 5));
        if (!opts.sessionAfterReload) clerk.session = null;
        if (opts.reloadThrows) throw new Error("401 from Clerk");
      },
    },
  };
  const guard = createSessionGuard({
    getClerk: () => clerk,
    isOpen: () => open,
    open: (source) => {
      opened.push(source);
      open = true;
    },
    now: () => t,
  });
  return {
    guard,
    opened,
    get reloads() {
      return reloads;
    },
    advance: (ms: number) => {
      t += ms;
    },
    setOpen: (v: boolean) => {
      open = v;
    },
  };
}

describe("createSessionGuard", () => {
  it("recovers when the reload leaves a session, and does not open the modal", async () => {
    const h = harness({ sessionAfterReload: true });
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "recovered");
    assert.deepEqual(h.opened, []);
    assert.equal(h.reloads, 1);
  });

  it("opens the modal when the reload leaves no session", async () => {
    const h = harness({ sessionAfterReload: false });
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "expired");
    assert.deepEqual(h.opened, ["api_401"]);
  });

  it("treats a throwing reload by what Clerk left behind", async () => {
    const h = harness({ sessionAfterReload: false, reloadThrows: true });
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "expired");
  });

  it("is single-flight: concurrent 401s share one reload", async () => {
    const h = harness({ sessionAfterReload: true });
    const results = await Promise.all([
      h.guard.onUnauthorized({ source: "api_401", error: err401() }),
      h.guard.onUnauthorized({ source: "api_401", error: err401() }),
      h.guard.onUnauthorized({ source: "api_401", error: err401() }),
    ]);
    assert.deepEqual(results, ["recovered", "recovered", "recovered"]);
    assert.equal(h.reloads, 1);
  });

  it("a 401 again within 10 s of a recovery opens the modal without another reload", async () => {
    const h = harness({ sessionAfterReload: true });
    await h.guard.onUnauthorized({ source: "api_401", error: err401() });
    h.advance(RECOVERY_WINDOW_MS - 1);
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "expired");
    assert.deepEqual(h.opened, ["api_401"]);
    assert.equal(h.reloads, 1);
  });

  it("a 401 long after a recovery reloads again", async () => {
    const h = harness({ sessionAfterReload: true });
    await h.guard.onUnauthorized({ source: "api_401", error: err401() });
    h.advance(RECOVERY_WINDOW_MS + 1);
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "recovered");
    assert.equal(h.reloads, 2);
  });

  it("ignores 401s while the modal is open", async () => {
    const h = harness({ sessionAfterReload: false });
    h.setOpen(true);
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "ignored");
    assert.equal(h.reloads, 0);
  });

  it("reset() forgets a recovery", async () => {
    const h = harness({ sessionAfterReload: true });
    await h.guard.onUnauthorized({ source: "api_401", error: err401() });
    h.guard.reset();
    assert.equal(await h.guard.onUnauthorized({ source: "api_401", error: err401() }), "recovered");
  });
});

describe("refetchUnauthorizedQueries", () => {
  it("refetches only active queries whose last error was a 401", () => {
    let filters: { predicate?: (q: unknown) => boolean; refetchType?: string } | undefined;
    const fake = {
      invalidateQueries: (f: typeof filters) => {
        filters = f;
        return Promise.resolve();
      },
    } as unknown as QueryClient;
    refetchUnauthorizedQueries(fake);
    assert.equal(filters?.refetchType, "active");
    const q = (status: string, error: unknown) => ({ state: { status, error } });
    assert.equal(filters?.predicate?.(q("error", err401())), true);
    assert.equal(filters?.predicate?.(q("error", new ApiError({ status: 500, code: "internal" }))), false);
    assert.equal(filters?.predicate?.(q("success", null)), false);
  });

  it("is a no-op without a query client", () => {
    assert.doesNotThrow(() => refetchUnauthorizedQueries(undefined));
  });
});

describe("modal store", () => {
  it("opens once and closes", () => {
    sessionExpiredStore.close();
    assert.equal(sessionExpiredStore.open("api_401", "/play?x=1"), true);
    assert.equal(sessionExpiredStore.open("clerk", "/other"), false);
    assert.equal(sessionExpiredStore.get().returnPath, "/play?x=1");
    sessionExpiredStore.setPhase("signing_in");
    assert.equal(sessionExpiredStore.get().phase, "signing_in");
    sessionExpiredStore.close();
    assert.equal(sessionExpiredStore.get().open, false);
    assert.equal(sessionExpiredStore.get().phase, "modal");
  });
});

describe("a live game holds the modal (phase-02 plan 4.7, 5.5.1)", () => {
  // regression: in-game-auth.spec — a session revoked mid-game opened "You've Been Signed Out" over the board (the
  // player lost on time behind it); the plan defers the modal until the game ends and shows the in-game chip instead.
  const onMemberPage = () => setPublicPathClassifier(() => false);

  it("keeps the first open request while held and opens it when the last hold goes", () => {
    const undo = onMemberPage();
    sessionExpiredStore.close();
    const release = holdSessionExpired();
    const nested = holdSessionExpired();
    assert.equal(openSessionExpired("clerk"), false);
    assert.equal(openSessionExpired("api_401"), false);
    assert.equal(sessionExpiredStore.get().open, false, "no modal during the game");
    assert.equal(deferredSessionExpired(), "clerk");
    nested();
    assert.equal(sessionExpiredStore.get().open, false, "one hold left");
    release();
    release(); // idempotent
    assert.equal(sessionExpiredStore.get().open, true, "opens when the game ends");
    assert.equal(sessionExpiredStore.get().source, "clerk");
    assert.equal(deferredSessionExpired(), null);
    sessionExpiredStore.close();
    undo();
  });

  it("a sign-in meanwhile cancels it", () => {
    const undo = onMemberPage();
    sessionExpiredStore.close();
    const release = holdSessionExpired();
    openSessionExpired("clerk");
    cancelDeferredSessionExpired();
    release();
    assert.equal(sessionExpiredStore.get().open, false);
    undo();
  });

  it("never opens on a public page after the game", () => {
    const undo = setPublicPathClassifier(() => true);
    sessionExpiredStore.close();
    const release = holdSessionExpired();
    openSessionExpired("api_401");
    release();
    assert.equal(sessionExpiredStore.get().open, false);
    assert.equal(deferredSessionExpired(), null);
    undo();
  });

  it("the /dev/ui demo is never held", () => {
    sessionExpiredStore.close();
    const release = holdSessionExpired();
    assert.equal(openSessionExpired("demo"), true);
    release();
    sessionExpiredStore.close();
  });
});

describe("paths", () => {
  it("public pages never show the modal; member, signed-in and dev routes do", () => {
    for (const p of ["/", "/pricing", "/legends", "/legends/paul-morphy", "/openings/x", "/profile/abc", "/sign-in", "/sign-in/factor-one", "/help", "/too-many-requests"]) {
      assert.equal(defaultIsPublicPath(p), true, p);
    }
    for (const p of ["/play", "/game/abc", "/tournaments", "/onboarding", "/admin", "/dev/ui/data", "/legendsx", "/queue"]) {
      assert.equal(defaultIsPublicPath(p), false, p);
    }
  });

  it("the classifier is replaceable (1B·J plugs in route-classes)", () => {
    const undo = setPublicPathClassifier((p) => p === "/play");
    assert.equal(isSessionPublicPath("/play"), true);
    undo();
    assert.equal(isSessionPublicPath("/play"), false);
  });

  it("signInHref keeps path and query, encoded", () => {
    assert.equal(signInHref("/dev/ui/data"), "/sign-in?redirect_url=%2Fdev%2Fui%2Fdata");
    assert.equal(signInHref("/play?tab=friends"), "/sign-in?redirect_url=%2Fplay%3Ftab%3Dfriends");
    assert.equal(signInHref("https://evil.example"), "/sign-in?redirect_url=%2Fplay");
  });

  it("safeReturnPath accepts app paths only", () => {
    assert.equal(safeReturnPath("/play"), "/play");
    assert.equal(safeReturnPath("/game/abc?x=1#m"), "/game/abc?x=1#m");
    assert.equal(safeReturnPath(" /play "), "/play");
    assert.equal(safeReturnPath("https://evil.example"), "/");
    assert.equal(safeReturnPath("//evil.example/x"), "/");
    assert.equal(safeReturnPath("/\\evil.example"), "/");
    assert.equal(safeReturnPath("javascript:alert(1)"), "/");
    assert.equal(safeReturnPath("/play\nSet-Cookie"), "/");
    assert.equal(safeReturnPath("/too-many-requests?retry=5"), "/");
    assert.equal(safeReturnPath(null), "/");
    assert.equal(safeReturnPath(undefined, "/play"), "/play");
    assert.equal(safeReturnPath("/a/../play"), "/play");
  });
});

describe("rc-auth broadcast (1B·J)", () => {
  it("a tab never hears its own message; other tabs do", async () => {
    const seen: string[] = [];
    const unsubSelf = subscribeAuthMessages((m) => seen.push(`self:${m.type}`), "tab-a");
    const unsubOther = subscribeAuthMessages((m) => seen.push(`other:${m.type}`), "tab-b");
    try {
      postAuthMessage("signed_out", "tab-a");
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(seen, ["other:signed_out"]);
    } finally {
      unsubSelf();
      unsubOther();
    }
  });
});
