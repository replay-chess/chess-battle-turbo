// S2 Computing, the fallback poll (phase-06 plan §12.4 `computing-fallback-poll.spec.ts`, §5.3, §5.5). Persona
// `weak-computing` (§6.8, real CC0 games: 12 graded, 13 queued). The realtime socket is blocked (page.routeWebSocket):
// TR-5 is polled about every 3 s; If-None-Match on its own ETag is a 304 (proven on the server: Playwright's request
// routing disables the browser cache); no poll while the tab is hidden; none after 15 minutes (page.clock); none once
// the worker has written the READY profile (the persona step `weak-computing:ready`). @p6
import { DEVICES, expect, openWeakness, root, test, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness computing · fallback poll · desktop-1440@100", { tag: ["@p6", ...weakStateTags("computing")] }, () => {
  test("the fallback poll: socket blocked, about every 3 s, 304 on its ETag, paused when hidden, stops at 15 min", async ({ page, weak }) => {
    test.setTimeout(600_000);
    await weak("weak-computing");
    // The realtime socket never connects (page.route does not see WebSockets: routeWebSocket closes it).
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.clock.install();
    const polls: { at: number; ifNoneMatch: string | undefined }[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/train/weakness" && r.method() === "GET") polls.push({ at: Date.now(), ifNoneMatch: r.headers()["if-none-match"] });
    });
    await openWeakness(page, "computing");
    await page.clock.runFor(10_000);
    await expect.poll(() => polls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    // The poll's ETag revalidates to a 304 while nothing changed (the server half of the browser cache).
    const first = await page.request.get("/api/train/weakness");
    expect(first.status()).toBe(200);
    const etag = first.headers()["etag"];
    expect(etag, "TR-5 sends a strong ETag").toMatch(/^"/);
    const again = await page.request.get("/api/train/weakness", { headers: { "if-none-match": etag! } });
    expect(again.status()).toBe(304);
    // Hidden tab: no poll.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenAt = polls.length;
    await page.clock.runFor(15_000);
    await page.waitForTimeout(500);
    expect(polls.length, "no poll while the tab is hidden").toBe(hiddenAt);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(10_000);
    await expect.poll(() => polls.length, { timeout: 20_000 }).toBeGreaterThan(hiddenAt);
    // 15 minutes on: the schedule has given up.
    await page.clock.runFor(16 * 60_000);
    await page.waitForTimeout(500);
    const atEnd = polls.length;
    await page.clock.runFor(60_000);
    await page.waitForTimeout(1_000);
    expect(polls.length, "no poll after 15 minutes").toBe(atEnd);
    await expect(root(page)).toHaveAttribute("data-status", "computing");
  });

  test("the poll stops once the profile is ready", async ({ page, weak, weakStep }) => {
    test.setTimeout(900_000);
    await weak("weak-computing");
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    const polls: number[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/train/weakness" && r.method() === "GET") polls.push(Date.now());
    });
    await openWeakness(page, "computing");
    await weakStep("weak-computing:ready");
    // The fallback poll finds the READY profile itself (no socket).
    await expect(page.getByTestId("weakness-ready-flash")).toBeVisible({ timeout: 120_000 });
    // The flash can come from a poll that saw READY while the build's last recompute was still pending ("updating"):
    // that poll scheduled one more, which finds nothing pending. The schedule's step is 3 s for the first 20 polls and
    // 10 s after them (WEAKNESS_FALLBACK); a slow build reaches the 10 s step, so waiting 4 s missed that last poll
    // (REGRESSION-6 r5: 21 polls, not 20; regression: weakness-poll-stop-10s-step). The polls must go quiet for longer
    // than the longest step, within a minute, and then stay quiet.
    const LONGEST_STEP_MS = 10_000;
    await expect
      .poll(() => Date.now() - (polls.at(-1) ?? 0), { message: "the fallback poll stops once the profile is ready", timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(LONGEST_STEP_MS + 1_000);
    const atReady = polls.length;
    await page.waitForTimeout(LONGEST_STEP_MS + 2_000);
    expect(polls.length, "no poll once ready").toBe(atReady);
  });

});
