// The Link step's error answers (phase-04 plan §12.4 `onboarding/link-errors.spec.ts`; §4.2, §7.3.1). @p4 @local-only
//
// Against the upstream mock: `knightowl88xx…` not found; `blocked…` (Chess.com answers the web 403) found through the
// worker fallback; `boom…` (Chess.com 503) → the upstream copy; `ratelimited…` (Chess.com 429, the worker fallback
// limited too) → the countdown with `source: "chesscom"`; `quiet_rook` (410, a closed account) → private → Continue →
// Level `manual`; 11 lookups in a minute → our own 429; a handle whose verified link another member holds →
// `linked_elsewhere`. Projects: desktop-1440 and android (plan §12.4).
//
// Chess.com's own 429 lives in serial/chesscom-rate-limit.spec.ts: a 429 pauses the worker's Chess.com gate for every
// caller (60 s, then the back-off ladder; plan §12.1 gate.test.ts), which would stall the imports and fallbacks of
// every spec running beside it, so it runs alone in the `game-serial` project after the others.
import type { Page, Response } from "@playwright/test";
import { handleTag } from "../../mocks/upstream-server";
import {
  DEVICES,
  clickReady,
  expect,
  expectStep,
  gotoStep,
  markInjected,
  noDocumentScroll,
  resetUserBucket,
  stage,
  stateTag,
  test,
  tid,
  uniqueHandle,
} from "./_lib/p04";

test.describe.configure({ mode: "serial" });

const LOOKUP = "**/api/accounts/chesscom/lookup";

type ErrorBody = { error?: { code?: string; details?: Record<string, unknown>; retryAfterSec?: number } };

/** Types a handle, presses Look Up, waits for the answer; returns the lookup response. */
async function lookUp(page: Page, handle: string): Promise<Response> {
  await tid(page, "onb-username").fill(handle);
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/accounts/chesscom/lookup") && r.request().method() === "POST");
  await clickReady(page, "onb-lookup");
  const res = await answered;
  await expect(stage(page, "link")).not.toHaveAttribute("data-state", "validating", { timeout: 30_000 });
  return res;
}

async function toLink(page: Page): Promise<void> {
  await gotoStep(page, "");
  await expectStep(page, "welcome");
  await clickReady(page, "onb-get-started");
  await expectStep(page, "link");
}

for (const variant of [
  { name: "desktop", device: "desktop-1440" as const, tags: true },
  { name: "android", device: "android" as const, tags: false },
]) {
  test.describe(`link errors · ${variant.name}`, () => {
    test.use(DEVICES[variant.device]);
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.name === "webkit-iphone", "chromium projects only (desktop and android)");
    });

    test(
      `not found, blocked → worker fallback, upstream down (${variant.name})`,
      { tag: ["@p4", "@local-only", ...(variant.tags ? [stateTag("desktop", "link", "not_found")] : [])] },
      async ({ page, leasePersona, telemetry, upstream }, testInfo) => {
        test.setTimeout(240_000);
        const me = await leasePersona("onboarding-fresh");
        // Chess.com's 503 makes the lookup answer 502 on purpose: tell the console guard the 5xx is injected.
        await markInjected(page, LOOKUP);
        await toLink(page);

        // Not found.
        const missing = uniqueHandle("knightowl88xx", testInfo);
        telemetry.forbid(missing);
        expect((await lookUp(page, missing)).status()).toBe(404);
        await expect(tid(page, "onb-not-found")).toBeVisible();
        await expect(stage(page, "link")).toHaveAttribute("data-state", "not_found");
        await expect(tid(page, "onb-username")).toHaveAttribute("aria-invalid", "true");
        await noDocumentScroll(page);

        // Web 403 → the worker's fallback finds it.
        const blocked = uniqueHandle("blocked", testInfo);
        telemetry.forbid(blocked);
        expect((await lookUp(page, blocked)).status()).toBe(200);
        await expect(tid(page, "onb-found")).toBeVisible();
        await expect(stage(page, "link")).toHaveAttribute("data-state", "found");
        const web = await upstream.requestsFor("chesscom", `/pub/player/${blocked}`, "web");
        const worker = await upstream.requestsFor("chesscom", `/pub/player/${blocked}`, "worker");
        expect(web.length, "the web asked Chess.com first").toBeGreaterThan(0);
        expect(worker.length, "the worker answered after the 403").toBeGreaterThan(0);
        await telemetry.expect(
          "account_lookup_fallback_used",
          { upstream_status: 403, result: "found" },
          { source: "server", distinctId: me.ref, count: 1 },
        );

        // Chess.com down → the upstream copy, 502 upstream_unavailable.
        const boom = uniqueHandle("boom", testInfo);
        const down = await lookUp(page, boom);
        expect(down.status()).toBe(502);
        expect(((await down.json()) as ErrorBody).error?.code).toBe("upstream_unavailable");
        await expect(tid(page, "onb-upstream")).toBeVisible();

        await telemetry.expect("onb_link_lookup_result", { result: "not_found" }, { source: "client" });
        await telemetry.expect("onb_link_lookup_result", { result: "error" }, { source: "client" });
      },
    );

    test(
      `a closed account is private: Continue → Level manual (${variant.name})`,
      {
        tag: [
          "@p4",
          "@local-only",
          ...(variant.tags ? [stateTag("desktop", "link", "private_profile"), stateTag("desktop", "level", "manual")] : []),
        ],
      },
      async ({ page, leasePersona, telemetry }) => {
        test.setTimeout(180_000);
        await leasePersona("onboarding-fresh");
        await toLink(page);
        telemetry.forbid("quiet_rook");
        expect((await lookUp(page, "quiet_rook")).status()).toBe(200);
        await expect(tid(page, "onb-private")).toBeVisible();
        await expect(stage(page, "link")).toHaveAttribute("data-state", "private_profile");
        await clickReady(page, "onb-continue");
        await expectStep(page, "level");
        await expect(stage(page, "level")).toHaveAttribute("data-state", "manual");
        await telemetry.expect("onb_link_lookup_result", { result: "private" }, { source: "client" });
      },
    );
  });
}

test(
  "an account with no rated games: found, then Confirm says so (desktop)",
  { tag: ["@p4", "@local-only", "@state:V3OnbPreview.no_games"] },
  async ({ page, leasePersona }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
    await leasePersona("onboarding-fresh");
    await toLink(page);
    const handle = uniqueHandle("empty", testInfo);
    expect((await lookUp(page, handle)).status()).toBe(200);
    await expect(tid(page, "onb-found")).toContainText(/no rated games/i);
    await clickReady(page, "onb-continue");
    await expectStep(page, "confirm");
    await expect(stage(page, "confirm")).toHaveAttribute("data-state", "no_games", { timeout: 30_000 });
    await expect(tid(page, "onb-no-games")).toBeVisible();
  },
);

test(
  "eleven lookups in a minute: our own 429 (desktop)",
  { tag: ["@p4", "@local-only", stateTag("desktop", "link", "rate_limited")] },
  async ({ page, leasePersona, p4db }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
    const me = await leasePersona("onboarding-fresh");
    await resetUserBucket(p4db, "lookup", me.clerkUserId);
    await toLink(page);
    for (let i = 1; i <= 10; i++) {
      const res = await lookUp(page, `${uniqueHandle("knightowl88xx", testInfo).slice(0, 22)}${i}`);
      expect(res.status(), `lookup ${i}`).toBe(404);
    }
    const eleventh = await lookUp(page, uniqueHandle("knightowl88xx", testInfo));
    expect(eleventh.status()).toBe(429);
    const body = (await eleventh.json()) as ErrorBody;
    expect(body.error?.details?.bucket, "our own limit (10 / 60 s per user), not Chess.com's").toBe("lookup");
    expect(body.error?.details?.source).not.toBe("chesscom");
    expect(body.error?.retryAfterSec).toBeGreaterThan(0);
    expect(body.error?.retryAfterSec).toBeLessThanOrEqual(60);
    await expect(tid(page, "onb-rate-limited")).toBeVisible();
    await expect(tid(page, "onb-lookup")).toHaveAttribute("aria-disabled", "true");
  },
);

test(
  "a Chess.com account another member holds verified: linked_elsewhere (desktop)",
  { tag: ["@p4", "@local-only"] },
  async ({ page, leasePersona, p4db }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name === "webkit-iphone", "chromium only");
    const me = await leasePersona("onboarding-fresh");
    await resetUserBucket(p4db, "lookup", me.clerkUserId);
    const handle = uniqueHandle("held", testInfo);
    const holderEmail = `e2e-holder-${Date.now().toString(36)}${testInfo.workerIndex}@chessbattle.dev`;
    // Another member who verified this Chess.com account (the mock's player id for the handle).
    const playerId = String(41_000_000 + Number(handleTag(handle)));
    const [holder] = await p4db.$queryRaw<{ id: bigint }[]>`
      INSERT INTO users ("googleId", email, name, code, "referenceId", "updatedAt")
      VALUES (${`user_e2e_holder_${Date.now()}`}, ${holderEmail}, 'Holder E2E', ${`H${Date.now().toString(36).slice(-5).toUpperCase()}`},
              ${`e2eholder${Date.now().toString(36)}`}, now())
      RETURNING id`;
    try {
      await p4db.$executeRaw`
        INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "verifiedAt", "updatedAt")
        VALUES (${holder!.id}, 'CHESSCOM', ${playerId}, ${handle}, ${handle.toLowerCase()}, now(), now())`;
      await toLink(page);
      const res = await lookUp(page, handle);
      expect(res.status()).toBe(409);
      expect(((await res.json()) as ErrorBody).error?.details?.reason).toBe("linked_elsewhere");
      await expect(tid(page, "onb-linked-elsewhere")).toBeVisible();
      await expect(stage(page, "link")).toHaveAttribute("data-state", "linked_elsewhere");
    } finally {
      await p4db.$executeRaw`DELETE FROM users WHERE id = ${holder!.id}`;
    }
  },
);
