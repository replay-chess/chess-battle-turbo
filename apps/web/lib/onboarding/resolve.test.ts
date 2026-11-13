// The resolver matrix and the per-page guard (phase-04 plan §8.1, §12.1 resolve.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABANDONED_CHECKOUT_PATH,
  entitledLike,
  guardStep,
  pendingCheckoutFresh,
  resolveOnboardingRoute,
  type OnbViewer,
} from "./resolve";
import { ORDER, PAGES, PENDING_CHECKOUT_TTL_MS, type OnbPage, type OnbStep } from "./steps";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

type Membership = "entitled" | "not" | "admin" | "paywall_off";
type Link = "none" | "chesscom" | "lichess";
type Pending = "fresh" | "stale" | "none";

const MEMBERSHIPS: Membership[] = ["entitled", "not", "admin", "paywall_off"];
const LINKS: Link[] = ["none", "chesscom", "lichess"];
const PENDINGS: Pending[] = ["fresh", "stale", "none"];

function viewer(step: OnbStep, m: Membership, link: Link, pending: Pending, extra: Partial<OnbViewer> = {}): OnbViewer {
  return {
    step,
    onboardingDone: false,
    entitled: m === "entitled",
    isAdmin: m === "admin",
    paywallOn: m !== "paywall_off",
    hasActiveLink: link !== "none",
    lichessLinked: link === "lichess",
    pendingCheckoutAt:
      pending === "fresh" ? NOW - 5 * 60_000 : pending === "stale" ? NOW - PENDING_CHECKOUT_TTL_MS - 1 : null,
    next: null,
    ...extra,
  };
}

/** The §8.1 table, written out per step (the oracle the implementation is checked against). */
const NON_MEMBER: Record<OnbStep, (link: Link, pending: Pending) => string> = {
  WELCOME: () => "/onboarding/welcome",
  LINK: (link) => (link === "none" ? "/onboarding/link" : "/onboarding/level"),
  CONFIRM: (link) => (link === "lichess" ? "/onboarding/confirm?provider=lichess" : "/onboarding/link"),
  LEVEL: () => "/onboarding/level",
  GOALS: () => "/onboarding/goals",
  PLAN: () => "/onboarding/plan",
  ACTIVATING: (_link, pending) => (pending === "fresh" ? "/onboarding/activating" : "/onboarding/plan?resume=abandoned"),
  DONE: () => "/onboarding/plan",
};

function expected(step: OnbStep, m: Membership, link: Link, pending: Pending, done: boolean): string {
  const member = m !== "not";
  if (done && member) return "/games";
  if (member && ORDER.indexOf(step) >= ORDER.indexOf("PLAN")) return "/onboarding/done";
  return NON_MEMBER[step](link, pending);
}

describe("resolveOnboardingRoute: the full matrix", () => {
  for (const step of ORDER) {
    for (const m of MEMBERSHIPS) {
      for (const link of LINKS) {
        for (const pending of PENDINGS) {
          for (const done of [false, true]) {
            it(`${step} · ${m} · link ${link} · checkout ${pending} · ${done ? "onboarded" : "not onboarded"}`, () => {
              const v = viewer(step, m, link, pending, { onboardingDone: done });
              assert.equal(resolveOnboardingRoute(v, NOW), expected(step, m, link, pending, done));
            });
          }
        }
      }
    }
  }
});

describe("resolveOnboardingRoute: details", () => {
  it("a finished member goes to the stored destination (D4-13)", () => {
    const v = viewer("DONE", "entitled", "chesscom", "none", { onboardingDone: true, next: "/review/abc?tab=moves" });
    assert.equal(resolveOnboardingRoute(v, NOW), "/review/abc?tab=moves");
  });

  it("an onboarded viewer who is not a member (lapsed) is sent to the plan, not on", () => {
    const v = viewer("DONE", "not", "none", "none", { onboardingDone: true, next: "/games" });
    assert.equal(resolveOnboardingRoute(v, NOW), "/onboarding/plan");
  });

  it("the 30-minute edge: 29:59 is activating, 30:00 is abandoned", () => {
    const at = (ms: number) => viewer("ACTIVATING", "not", "none", "none", { pendingCheckoutAt: NOW - ms });
    assert.equal(resolveOnboardingRoute(at(PENDING_CHECKOUT_TTL_MS - 1), NOW), "/onboarding/activating");
    assert.equal(resolveOnboardingRoute(at(PENDING_CHECKOUT_TTL_MS), NOW), ABANDONED_CHECKOUT_PATH);
  });

  it("entitledLike: entitled, admin or paywall off", () => {
    assert.equal(entitledLike({ entitled: true, isAdmin: false, paywallOn: true }), true);
    assert.equal(entitledLike({ entitled: false, isAdmin: true, paywallOn: true }), true);
    assert.equal(entitledLike({ entitled: false, isAdmin: false, paywallOn: false }), true);
    assert.equal(entitledLike({ entitled: false, isAdmin: false, paywallOn: true }), false);
  });

  it("pendingCheckoutFresh", () => {
    assert.equal(pendingCheckoutFresh({ pendingCheckoutAt: null }, NOW), false);
    assert.equal(pendingCheckoutFresh({ pendingCheckoutAt: NOW }, NOW), true);
    assert.equal(pendingCheckoutFresh({ pendingCheckoutAt: NOW - PENDING_CHECKOUT_TTL_MS }, NOW), false);
  });
});

const STEP_PAGES = PAGES.filter((p) => p !== "activating" && p !== "done");
const pageIndex = (p: OnbPage) => PAGES.indexOf(p);

describe("guardStep: one ahead, any back (pages up to plan)", () => {
  for (const step of ORDER) {
    for (const page of STEP_PAGES) {
      it(`stored ${step}, opening ${page} (not a member)`, () => {
        const v = viewer(step, "not", "none", "none");
        const query = page === "confirm" ? { provider: "chesscom", u: "knightowl_88" } : {};
        const got = guardStep(page, v, NOW, query);
        if (pageIndex(page) <= ORDER.indexOf(step) + 1) assert.equal(got, null);
        else assert.equal(got, resolveOnboardingRoute(v, NOW));
      });
    }
  }

  it("a member is sent past the plan to done", () => {
    for (const m of ["entitled", "admin", "paywall_off"] as const) {
      assert.equal(guardStep("plan", viewer("GOALS", m, "none", "none"), NOW), "/onboarding/done");
    }
    assert.equal(guardStep("plan", viewer("GOALS", "not", "none", "none"), NOW), null);
  });

  it("a finished member is sent on from every page", () => {
    for (const page of PAGES) {
      const v = viewer("DONE", "entitled", "chesscom", "none", { onboardingDone: true, next: "/games?source=chesscom" });
      assert.equal(guardStep(page, v, NOW), "/games?source=chesscom");
    }
  });
});

describe("guardStep: confirm", () => {
  const v = (link: Link) => viewer("LINK", "not", link, "none");

  it("Chess.com needs a valid username", () => {
    assert.equal(guardStep("confirm", v("none"), NOW, { provider: "chesscom", u: "knightowl_88" }), null);
    assert.equal(guardStep("confirm", v("none"), NOW, { provider: "chesscom", u: "no spaces allowed" }), "/onboarding/link");
    assert.equal(guardStep("confirm", v("none"), NOW, { provider: "chesscom", u: "ab" }), "/onboarding/link");
    assert.equal(guardStep("confirm", v("none"), NOW, { provider: "chesscom" }), "/onboarding/link");
  });

  it("Lichess needs a Lichess link", () => {
    assert.equal(guardStep("confirm", v("lichess"), NOW, { provider: "lichess" }), null);
    assert.equal(guardStep("confirm", v("chesscom"), NOW, { provider: "lichess" }), "/onboarding/link");
    assert.equal(guardStep("confirm", v("none"), NOW, { provider: "lichess" }), "/onboarding/link");
  });

  it("no or an unknown provider → link", () => {
    assert.equal(guardStep("confirm", v("lichess"), NOW, {}), "/onboarding/link");
    assert.equal(guardStep("confirm", v("lichess"), NOW, { provider: "fide", u: "knightowl_88" }), "/onboarding/link");
  });
});

describe("guardStep: activating and done", () => {
  it("activating: fresh checkout, checkout=success or a member; else the plan", () => {
    assert.equal(guardStep("activating", viewer("ACTIVATING", "not", "none", "fresh"), NOW), null);
    assert.equal(guardStep("activating", viewer("PLAN", "not", "none", "none"), NOW, { checkout: "success" }), null);
    assert.equal(guardStep("activating", viewer("ACTIVATING", "entitled", "none", "stale"), NOW), null);
    assert.equal(guardStep("activating", viewer("ACTIVATING", "not", "none", "stale"), NOW), ABANDONED_CHECKOUT_PATH);
    assert.equal(guardStep("activating", viewer("GOALS", "not", "none", "none"), NOW), "/onboarding/plan");
  });

  it("done: a member or a fresh checkout ('Trial starting…'); else the plan", () => {
    assert.equal(guardStep("done", viewer("ACTIVATING", "entitled", "none", "none"), NOW), null);
    assert.equal(guardStep("done", viewer("ACTIVATING", "admin", "none", "none"), NOW), null);
    assert.equal(guardStep("done", viewer("ACTIVATING", "not", "none", "fresh"), NOW), null);
    assert.equal(guardStep("done", viewer("ACTIVATING", "not", "none", "stale"), NOW), "/onboarding/plan");
    assert.equal(guardStep("done", viewer("WELCOME", "not", "none", "none"), NOW), "/onboarding/plan");
  });
});
