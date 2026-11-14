// Request budgets of the P5 screens (phase-05 plan §12.4 `request-budget.spec.ts`, §9.6 "First paint requests",
// "Invocations for a 10-item drill"; cdl §2, opt §2.4). @p5
//
//   first paint   shared member A (asserts request counts only, writes nothing): /home, /train and /train/bank render
//                 from the RSC seed: no `/api/*` read while the page loads and settles. The hub may send its one
//                 silent `PATCH /api/train/prefs` when the browser's zone differs from the stored one (§5.3 W8); the
//                 contexts here use the member's stored zone (UTC), so none is expected either.
//   a 10-item drill  leased `bank-member`, an explicit 10-card drill solved first try: from opening the runner to its
//                 done block the app makes at most 5 function invocations (the page render, ≤ 3 attempt batches, the
//                 end call); no `/api` read at all.
import type { Page, Request } from "@playwright/test";
import { DEVICES, expect, gotoOk, itemsById, poolUserEmail, sessionPayload, solveAndGradeAll, test, trainDb, waitForSession } from "./train/_lib/train";

// The drill leases `bank-member`, which bank.spec.ts also leases: both files run serially.
test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

/** App requests that run a server function: documents, RSC payloads and /api (not static assets, not third parties). */
function isInvocation(r: Request, origin: string): boolean {
  const u = new URL(r.url());
  if (u.origin !== origin) return false;
  if (u.pathname.startsWith("/_next/static") || u.pathname.startsWith("/_next/image") || /\.(js|css|png|svg|woff2?|ico|json|webmanifest)$/.test(u.pathname)) return false;
  // A router prefetch of the shell's nav links is the shell's cost on every page (P1), not the drill's: counted apart.
  if (r.headers()["next-router-prefetch"] === "1") return false;
  return r.resourceType() === "document" || u.pathname.startsWith("/api/") || r.headers()["rsc"] === "1" || u.searchParams.has("_rsc");
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForTimeout(2_500);
}

test.describe("P5 request budgets", { tag: ["@p5"] }, () => {
  test("0 /api reads at first paint of /home, /train and /train/bank", async ({ member, page }) => {
    test.setTimeout(300_000);
    await member("A");
    for (const [path, ready] of [
      ["/home", '[data-testid="home"][data-state]'],
      ["/train", '[data-testid="train-hub"]:not([data-state="loading"])'],
      ["/train/bank", '[data-testid="train-bank"][data-state]'],
    ] as const) {
      await test.step(path, async () => {
        const api: string[] = [];
        const onReq = (r: Request) => {
          const u = new URL(r.url());
          if (u.pathname.startsWith("/api/") && u.pathname !== "/api/socket-token" && r.method() === "GET") api.push(u.pathname);
        };
        page.on("request", onReq);
        await gotoOk(page, path);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 120_000 });
        await settle(page);
        page.off("request", onReq);
        expect(api, `${path}: the first paint is seeded`).toEqual([]);
      });
    }
  });

  // §9.4 "RSC flight for /train, /home ≤ 12 KB" (FIX-1: asserted). A client navigation between the two fetches the
  // route's own flight (the shared (app) layout is not resent): DTOs only, never Prisma rows. The flight is read through
  // a route (the browser keeps no body of a streamed RSC response), so service workers are blocked for this test.
  test.describe(() => {
    test.use({ serviceWorkers: "block" });
    test("the RSC flight of /train and /home is ≤ 12 KB", async ({ member, page, baseURL }) => {
      test.setTimeout(300_000);
      await member("A");
      const origin = new URL(baseURL!).origin;
      const sizes = new Map<string, number>();
      await page.route(
        (url) => url.origin === origin && (url.pathname === "/train" || url.pathname === "/home") && url.searchParams.has("_rsc"),
        async (route) => {
          const req = route.request();
          if (req.headers()["rsc"] !== "1" || req.headers()["next-router-prefetch"] === "1") return route.continue();
          const res = await route.fetch();
          const body = await res.body();
          sizes.set(new URL(req.url()).pathname, body.length);
          await route.fulfill({ response: res, body });
        },
      );
      const flight = async (from: string, linkName: string, to: string, ready: string): Promise<number> => {
        await gotoOk(page, from);
        await settle(page);
        sizes.delete(to);
        await page.getByRole("navigation").getByRole("link", { name: linkName, exact: true }).first().click();
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 120_000 });
        await expect.poll(() => sizes.get(to) ?? 0, { timeout: 60_000, message: `${to}: its RSC flight was fetched` }).toBeGreaterThan(0);
        return sizes.get(to)!;
      };
      const train = await flight("/home", "Train", "/train", '[data-testid="train-hub"]:not([data-state="loading"])');
      expect(train, `/train flight ${train} B`).toBeLessThanOrEqual(12 * 1024);
      const home = await flight("/train", "Home", "/home", '[data-testid="home"][data-state]');
      expect(home, `/home flight ${home} B`).toBeLessThanOrEqual(12 * 1024);
      test.info().annotations.push({ type: "rsc-flight", description: `/train ${train} B, /home ${home} B` });
    });
  });

  test("a 10-item drill costs at most 5 function invocations", async ({ persona, page, reviewDb, baseURL }, testInfo) => {
    test.setTimeout(420_000);
    await persona("bank-member");
    const db = trainDb(reviewDb);
    const userId = await db.userId(poolUserEmail(testInfo));
    const keys = (await db.raw.$queryRaw<{ k: string }[]>`
      SELECT "itemKey" AS k FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK' ORDER BY id LIMIT 10`).map((r) => r.k);
    expect(keys).toHaveLength(10);

    const origin = new URL(baseURL!).origin;
    const calls: string[] = [];
    page.on("request", (r) => {
      if (isInvocation(r, origin)) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await gotoOk(page, `/train/bank/session?cards=${keys.join(",")}`);
    const ref = await waitForSession(page);
    // The test's own payload read is not the app's: drop it from the count.
    const payload = await sessionPayload(page.request, ref);
    expect(payload.items).toHaveLength(10);
    expect(await solveAndGradeAll(page, itemsById(payload), 10)).toBe(10);
    await expect(page.getByTestId("trainer-done").filter({ visible: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => db.attemptsOfSession(ref), { timeout: 30_000 }).toBe(10);
    await page.waitForTimeout(2_000);
    const reads = calls.filter((c) => c.startsWith("GET /api/"));
    expect(reads, "no /api read during the drill").toEqual([]);
    expect(calls.length, `function invocations: ${calls.join(", ")}`).toBeLessThanOrEqual(5);
    testInfo.annotations.push({ type: "invocations", description: calls.join(", ") });
  });
});
