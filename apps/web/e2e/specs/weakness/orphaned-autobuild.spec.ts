// S2 Computing, orphaned (phase-06 plan §12.4 `orphaned-autobuild.spec.ts`, §7.1.1, §8.14). Persona `weak-orphaned`
// (§6.8): 22 real CC0 games graded by the e2e worker, no snapshot and no recompute job (the state a backfill gap leaves).
// TR-5 itself never enqueues (AP-09, checked in the database); the page sends exactly one auto-build TR-12 (202) and
// the worker builds the profile. When the profile is gone again within 10 minutes (persona step `weak-orphaned:again`),
// the reload's auto-build meets the durable limit: 429, the page stays on computing, and no error toast. @p6
import type { Request } from "@playwright/test";
import { DEVICES, expect, openWeakness, root, test, tr5, weakDb, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness orphaned · desktop-1440@100", { tag: ["@p6", ...weakStateTags("computing")] }, () => {
  test("one auto-build on first paint; the reload's second one is a quiet 429", async ({ page, weak, weakStep, reviewDb, telemetry }) => {
    test.setTimeout(900_000);
    const lease = await weak("weak-orphaned");
    const db = weakDb(reviewDb);
    const userId = await db.userId(lease.email);
    // GET is read-only: the probe says orphaned, and no job exists after it.
    const p = await tr5(page.request);
    expect(p.status).toBe("computing");
    expect(p.progress).toMatchObject({ orphaned: true });
    expect(p.games.analysed).toBe(22);
    expect(await db.recompute(userId), "TR-5 never enqueues").toBeNull();

    const posts: Request[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/train/weakness/recompute") && r.method() === "POST") posts.push(r);
    });
    const first = page.waitForResponse((r) => r.url().endsWith("/api/train/weakness/recompute"));
    await openWeakness(page, "computing");
    expect((await first).status()).toBe(202);
    expect(posts.length).toBe(1);
    await expect(page.getByTestId("weakness-see-profile").or(page.getByTestId("weakness-headline")).first()).toBeVisible({ timeout: 180_000 });
    expect(posts.length, "exactly one auto-build").toBe(1);
    expect((await db.recompute(userId))?.trigger).toBe("user");
    await telemetry.expect("weakness_recompute_clicked", { from: "auto", result: "ok" }, { count: 1 });

    await weakStep("weak-orphaned:again");
    expect((await tr5(page.request)).progress).toMatchObject({ orphaned: true });
    const second = page.waitForResponse((r) => r.url().endsWith("/api/train/weakness/recompute"));
    await page.reload({ waitUntil: "domcontentloaded" });
    const res = await second;
    expect(res.status(), "the durable limit (one request per 10 minutes)").toBe(429);
    expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
    await expect(root(page)).toHaveAttribute("data-status", "computing");
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-sonner-toast]"), "no error toast for the auto-build's 429").toHaveCount(0);
    expect(posts.length).toBe(2);
    await telemetry.expect("weakness_recompute_clicked", { from: "auto", result: "rate_limited" }, { count: 1 });
  });
});
