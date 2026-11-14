// A route stylesheet that a soft navigation fails to load is no page error (lib/shell/stylesheet-rejections.ts). @p5 @smoke
//
// regression: webkit-home-css-cut (CI 43608761478, webkit-iphone review-walkthrough: "[pageerror] [object Event]
// (/home)"). The sign-in lands on `/`, which sends a member to /home by a soft navigation; React inserts /home's route
// CSS as stylesheet resources whose load promise nothing catches. When that load fails, the promise rejects with the
// link's `error` Event, uncaught: WebKit fires that `error` whenever a navigation cuts the load (the walkthrough went on
// to /review/<ref> while /home's CSS was still loading), and every browser fires it on a network failure.
// Here every stylesheet a page asks for at runtime (after its document's own links: the soft navigation's route CSS
// and the prefetch hints) fails to load, which is the same `error` on the same link, on both projects.
import { expect, test } from "./review/_lib/review";

// page.route must see the stylesheet requests: the production build's service worker answers /_next/static itself.
test.use({ serviceWorkers: "block" });

test("a soft navigation whose route stylesheet fails to load: no page error", { tag: ["@p5", "@smoke"] }, async ({ member, page }) => {
  test.setTimeout(240_000);
  // A document's own stylesheets are requested while it is parsed (before DOMContentLoaded); later ones are runtime.
  let parsed = false;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) parsed = false; // a new document (not a soft navigation)
  });
  page.on("domcontentloaded", () => void (parsed = true));
  const failed: string[] = [];
  await page.route(/\/_next\/static\/css\/[0-9a-f]+\.css$/, async (route) => {
    if (!parsed) return route.continue();
    failed.push(new URL(route.request().url()).pathname);
    return route.abort("failed");
  });
  await member("K"); // `/`, then the soft navigation to /home
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await expect(page.getByTestId("home")).toBeVisible({ timeout: 60_000 });
  expect(failed.length, "the soft navigation to /home loaded route stylesheets at runtime (and they failed)").toBeGreaterThan(0);
  await page.waitForTimeout(1_000); // a late rejection would land here; the console guard fails the test on it
});
