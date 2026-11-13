// Chess.com limits the lookup (phase-04 plan §12.4 `onboarding/link-errors.spec.ts`, the `ratelimited` row; §7.3.1,
// D4-23). @p4 @local-only
//
// The mock answers `ratelimited…` with 429 `Retry-After: 30` to the web and to the worker's fallback, so the lookup
// answers 429 `rate_limited {source: "chesscom"}` and the Link card counts down with Look Up aria-disabled (never
// auto-retried). The worker's 429 pauses its Chess.com gate for every caller, so this spec runs alone in the
// `game-serial` project (playwright.config.ts SERIAL_GAME_SPECS), after every other spec.
import type { Page, Response } from "@playwright/test";
import { DEVICES, clickReady, expect, expectStep, gotoStep, noDocumentScroll, stage, stateTag, test, tid, uniqueHandle } from "../_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

type ErrorBody = { error?: { code?: string; details?: Record<string, unknown>; retryAfterSec?: number } };

async function lookUp(page: Page, handle: string): Promise<Response> {
  await tid(page, "onb-username").fill(handle);
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/accounts/chesscom/lookup") && r.request().method() === "POST");
  await clickReady(page, "onb-lookup");
  return answered;
}

test(
  "Chess.com rate-limits the lookup: 429 source chesscom, countdown, Look Up disabled",
  { tag: ["@p4", "@local-only", stateTag("desktop", "link", "rate_limited")] },
  async ({ page, leasePersona, telemetry, upstream }, testInfo) => {
    test.setTimeout(180_000);
    await leasePersona("onboarding-fresh");
    await gotoStep(page, "");
    await clickReady(page, "onb-get-started");
    await expectStep(page, "link");
    const handle = uniqueHandle("ratelimited", testInfo);
    telemetry.forbid(handle);
    const res = await lookUp(page, handle);
    expect(res.status()).toBe(429);
    const body = (await res.json()) as ErrorBody;
    expect(body.error?.code).toBe("rate_limited");
    expect(body.error?.details?.source).toBe("chesscom");
    expect(body.error?.retryAfterSec).toBeGreaterThan(0);
    expect((await upstream.requestsFor("chesscom", `/pub/player/${handle}`, "worker")).length, "the worker fallback was tried").toBeGreaterThan(0);
    await expect(tid(page, "onb-rate-limited")).toBeVisible();
    await expect(stage(page, "link")).toHaveAttribute("data-state", "rate_limited");
    await expect(tid(page, "onb-rate-limited").getByRole("timer")).toHaveText(/^0:\d\d$/);
    await expect(tid(page, "onb-lookup")).toHaveAttribute("aria-disabled", "true");
    await noDocumentScroll(page);
    await telemetry.expect("onb_link_lookup_result", { result: "rate_limited" }, { source: "client" });
  },
);
