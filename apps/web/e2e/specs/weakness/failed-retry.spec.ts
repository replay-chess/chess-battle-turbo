// S5 Failed and Retry on real data (phase-06 plan §12.4 `failed-retry.spec.ts`, §4.8, §7.1.2; §1.2 T7). Persona
// `weakfail` (§6.8): 22 real CC0 games graded by the e2e worker whose recompute died on its last attempt; the running
// worker's reaper failed it and wrote the FAILED snapshot. Retry → 202 → computing → the worker builds the profile;
// the retry's recompute then dies on its last attempt too (persona step `weakfail:crash`, reaped by the worker) → the
// page is failed again → a second Retry within 10 minutes → 429 with the countdown; 601 s later (x-rc-now) → 202. @p6
import { serverNowHeaders } from "../../fixtures/time";
import { DEVICES, expect, openWeakness, root, test, tr5, weakDb } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness failed · desktop-1440@100", { tag: ["@p6"] }, () => {
  test("Retry, failed again, the countdown, and the limit 10 minutes on", async ({ page, weak, weakStep, reviewDb, telemetry }) => {
    test.setTimeout(900_000);
    const lease = await weak("weakfail");
    const db = weakDb(reviewDb);
    const userId = await db.userId(lease.email);
    const p = await tr5(page.request);
    expect(p.status).toBe("failed");
    expect(p.failure).toMatchObject({ code: "worker_stalled" });
    expect(await db.recompute(userId)).toMatchObject({ status: "FAILED", attempts: 3 });
    await openWeakness(page, "failed");
    await expect(page.getByTestId("weakness-failed")).toContainText("We couldn’t build your profile");
    await expect(page.getByTestId("weakness-failed")).toHaveAttribute("data-state", "default");

    const retry = page.waitForResponse((r) => r.url().endsWith("/api/train/weakness/recompute"));
    await page.getByTestId("weakness-retry").click();
    expect((await retry).status()).toBe(202);
    await expect(root(page)).toHaveAttribute("data-status", /computing|ready/);
    await telemetry.expect("weakness_recompute_clicked", { from: "failed", result: "ok" }, { count: 1 });
    // The retry's recompute dies on its last attempt as well; the reaper's FAILED snapshot reaches the page.
    await weakStep("weakfail:crash");
    // The reaper's failure write sends the worker's server event (the code only, no PII).
    await telemetry.expect("weakness_recompute_failed", { code: "worker_stalled", attempts: 3 }, { source: "server" });
    await expect(page.getByTestId("weakness-failed")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("weakness-failed")).toHaveAttribute("data-state", "failed_again");
    await expect(page.getByTestId("weakness-failed")).toContainText("If this keeps happening, contact hello@playchess.tech");

    const limited = page.waitForResponse((r) => r.url().endsWith("/api/train/weakness/recompute"));
    await page.getByTestId("weakness-retry").click();
    const res = await limited;
    expect(res.status()).toBe(429);
    const after = Number(res.headers()["retry-after"]);
    expect(after).toBeGreaterThan(500);
    expect(after).toBeLessThanOrEqual(600);
    await expect(page.getByTestId("weakness-rate-limited")).toContainText("Your profile was asked for recently. Try again in");
    await expect(page.getByTestId("weakness-rate-limited-timer")).toHaveText(/^\d{1,2}:\d\d$/);
    await telemetry.expect("weakness_recompute_clicked", { from: "failed", result: "rate_limited" }, { count: 1 });

    // 601 s on (the request's x-rc-now): the limit has passed.
    const later = await page.request.post("/api/train/weakness/recompute", { headers: serverNowHeaders(new Date(Date.now() + 601_000)), data: {} });
    expect(later.status(), await later.text()).toBe(202);
  });
});
