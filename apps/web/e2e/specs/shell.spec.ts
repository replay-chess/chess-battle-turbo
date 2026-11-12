import { devices, type Locator, type Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/**
 * App shell on the real signed-in routes (SPEC 9.5). Members (E2E user A) get
 * the shell; non-members (user R) and signed-out visitors keep the marketing
 * Navbar and Footer.
 */

// `defaultBrowserType` can't be set inside a describe block (it forces a new worker).
const { defaultBrowserType: _pixelBrowser, ...pixel7 } = devices["Pixel 7"];
void _pixelBrowser;

const NOT_FOUND_TEXT = "Off the Board";

async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

/**
 * Opens a layer and waits for it. Retries while the page hydrates: under a busy
 * `next dev` the first click or key can land before React attaches handlers.
 */
async function openLayer(target: Locator, open: () => Promise<void>) {
  await expect(async () => {
    if (!(await target.isVisible())) await open();
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

const openAccountMenu = (page: Page) =>
  openLayer(page.getByTestId("account-menu"), () => page.getByTestId("shell-account-button").click());

const openAccountSheet = (page: Page) =>
  openLayer(page.getByTestId("account-sheet"), () => page.getByTestId("shell-account-avatar").click());

const openPalette = (page: Page) =>
  openLayer(page.getByTestId("command-palette"), () => page.keyboard.press("ControlOrMeta+K"));

async function expectShell(page: Page) {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("marketing-navbar")).toHaveCount(0);
}

/** First legend detail URL on /legends, or null when the catalogue is empty. */
async function firstLegendHref(page: Page): Promise<string | null> {
  await gotoApp(page, "/legends");
  const link = page.locator('a[href^="/legends/"]').first();
  if ((await link.count()) === 0) return null;
  return link.getAttribute("href");
}

/**
 * A position page to test. The legend page's first position link when it has
 * one; otherwise the first opening as `/position/<ref>?type=opening`.
 */
async function firstPositionHref(page: Page, legendHref: string | null): Promise<string | null> {
  if (legendHref) {
    await gotoApp(page, legendHref);
    const link = page.locator('a[href^="/position/"]').first();
    if ((await link.count()) > 0) return link.getAttribute("href");
  }
  await gotoApp(page, "/openings");
  const opening = page.locator('a[href^="/openings/"]').first();
  if ((await opening.count()) === 0) return null;
  const href = await opening.getAttribute("href");
  const ref = href?.split("/openings/")[1]?.split(/[?#]/)[0];
  return ref ? `/position/${ref}?type=opening` : null;
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  // Let sticky bars and scroll-linked layout settle.
  await page.waitForTimeout(300);
}

type Box = { top: number; bottom: number };

/**
 * Measures, after scrolling to the end: the deepest last in-flow element of the
 * page root, the fixed CTA bar (when one is fixed at this width) and the tab bar.
 */
async function measureEnd(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const inFlow = (el: Element) => {
      const pos = getComputedStyle(el).position;
      return pos !== "fixed" && pos !== "absolute" && visible(el);
    };
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };

    const pageEl = document.querySelector(".rc-vs__page");
    const roots = pageEl ? [...pageEl.children].filter(inFlow) : [];
    let last: Element | null = roots.at(-1) ?? null;
    for (;;) {
      const next: Element | undefined = last ? [...last.children].filter(inFlow).at(-1) : undefined;
      if (!next) break;
      last = next;
    }

    const cta = [...document.querySelectorAll('[class*="bottom-[var(--rc-fixed-bottom"]')].find(
      (el) => getComputedStyle(el).position === "fixed" && visible(el),
    );
    const tab = document.querySelector("[data-rc-tabbar]");

    return {
      innerHeight: window.innerHeight,
      last: box(last),
      lastTag: last ? `${last.tagName.toLowerCase()}.${String(last.className).slice(0, 80)}` : null,
      cta: cta ? box(cta) : null,
      tabbar: tab && visible(tab) ? box(tab) : null,
    };
  });
}

function insideViewport(b: Box, innerHeight: number) {
  return b.top >= -1 && b.bottom <= innerHeight + 1;
}

// 1–7, 9, 13, 15, 16: desktop (Desktop Chrome from the config: sidebar mode).
test.describe("App shell for members @p1", () => {
  test("1. /play renders inside the shell @state:V3Nav.play", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    await expect(page.getByTestId("nav-item-play")).toHaveAttribute("aria-current", "page");
    for (const id of ["mode-quick", "start-game-button"]) {
      await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId(id)).toBeEnabled();
    }
  });

  test("2. /tournaments marks Play and Tournaments current", async ({ authedPage: page }) => {
    await gotoApp(page, "/tournaments");
    await expectShell(page);
    await expect(page.getByTestId("nav-item-play")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-item-tournaments")).toHaveAttribute("aria-current", "page");
  });

  test("3. /legends marks Learn current @state:V3Nav.learn", async ({ authedPage: page }) => {
    await gotoApp(page, "/legends");
    await expectShell(page);
    await expect(page.getByTestId("nav-item-learn")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-item-legends")).toBeVisible();
  });

  test("4. Profile nav item and the membership anchor @state:V3Nav.profile", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    await page.getByTestId("nav-item-profile").click();
    await page.waitForURL(/\/profile\/[^/?#]+/);
    await expect(page.getByTestId("nav-item-profile")).toHaveAttribute("aria-current", "page");

    await openAccountMenu(page);
    await page.getByTestId("account-item-membership").click();
    const section = page.getByTestId("membership-section");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await section.boundingBox())?.y ?? -1, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0);
    await expect.poll(async () => (await section.boundingBox())?.y ?? 9999, { timeout: 10_000 }).toBeLessThanOrEqual(120);
  });

  test("5. Account menu: theme toggle and focus return", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    const button = page.getByTestId("shell-account-button");
    const html = page.locator("html");
    const wasDark = ((await html.getAttribute("class")) ?? "").split(/\s+/).includes("dark");

    await openAccountMenu(page);
    await page.getByTestId("account-item-theme").click();
    if (wasDark) {
      await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    } else {
      await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
      await expect
        .poll(() => page.getByTestId("app-shell").evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe("rgb(0, 0, 0)");
    }

    // Switch back.
    await openAccountMenu(page);
    await page.getByTestId("account-item-theme").click();
    if (wasDark) await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);

    // Esc closes the menu and returns focus to the trigger.
    await openAccountMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-menu")).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("6. Palette, chords and the shortcuts dialog @state:V3CommandPalette.open @state:V3CommandPalette.closed @state:V3Shortcuts.open @state:V3Shortcuts.closed", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);

    await openPalette(page);
    await page.getByTestId("command-palette-input").fill("tour");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/tournaments$/);
    await expect(page.getByTestId("command-palette")).toBeHidden();

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.waitForURL(/\/play$/);

    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toBeHidden();
  });

  test("7. No dead links in the nav, account menu or palette", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);

    const hrefs = new Set<string>();
    const add = (list: (string | null)[]) => list.forEach((h) => h && hrefs.add(h));

    add(
      await page
        .locator('[data-rc-nav] a[href], [data-rc-tabbar] a[href], [data-testid="subnav"] a[href]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("href"))),
    );

    await openAccountMenu(page);
    add(await page.locator('[data-testid="account-menu"] a[href]').evaluateAll((els) => els.map((e) => e.getAttribute("href"))));
    await page.keyboard.press("Escape");

    // Palette "Go To" rows are commands, not links: check each row exists and
    // request the URL it navigates to.
    const profileHref = await page.getByTestId("nav-item-profile").getAttribute("href");
    expect(profileHref, "nav-item-profile href").toMatch(/^\/profile\/[^/?#]+$/);
    await openPalette(page);
    for (const id of ["play", "tournaments", "legends", "openings", "profile", "membership"]) {
      await expect(page.getByTestId(`palette-item-${id}`), `palette-item-${id}`).toBeVisible();
    }
    await page.keyboard.press("Escape");
    add(["/play", "/tournaments", "/legends", "/openings", profileHref, `${profileHref}#membership`]);

    const internal = [...hrefs]
      .filter((h) => h.startsWith("/") && !h.startsWith("//"))
      .map((h) => h.split("#")[0]!)
      .filter((h, i, all) => h && all.indexOf(h) === i);
    expect(internal.length).toBeGreaterThan(3);

    for (const href of internal) {
      const res = await page.request.get(href);
      expect(res.status(), href).toBeLessThan(400);
      // The RSC payload in <script> tags always carries the root not-found tree; check the rendered HTML only.
      const html = (await res.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      expect(html, href).not.toContain(NOT_FOUND_TEXT);
    }
  });

  test("9. Sign Out returns to the marketing home page", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    await openAccountMenu(page);
    await page.getByTestId("account-item-signout").click();
    // The signed-out landing page lands when its document does: "load" also waits for ~50 third-party directory
    // badge images (app/components/DirectoryBadges.tsx), and one slow badge host held it past 30 s
    // (regression: signout-landing-load).
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000, waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("marketing-navbar")).toBeVisible();
  });

  test("13. A legacy modal blocks shell shortcuts", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    await page.getByTestId("mode-friend").click();
    await page.getByTestId("start-game-button").click();
    const modal = page.locator("[data-rc-modal]");
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("go-to-game-button")).toBeVisible({ timeout: 30_000 });
    const url = page.url();

    for (const keys of [["/"], ["?"], ["g", "p"], ["ControlOrMeta+K"]]) {
      for (const key of keys) await page.keyboard.press(key);
      await page.waitForTimeout(300);
      await expect(page.getByTestId("command-palette"), keys.join(" ")).toHaveCount(0);
      await expect(page.getByTestId("shortcuts-dialog"), keys.join(" ")).toHaveCount(0);
      expect(page.url(), keys.join(" ")).toBe(url);
    }

    // Close the modal, which cancels the friend game.
    await modal.locator("button").first().click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
  });

  test("15. Scroll restoration on /legends (soft)", async ({ authedPage: page }) => {
    const legendHref = await firstLegendHref(page);
    test.skip(!legendHref, "No legends on this database");
    await expectShell(page);
    await scrollToEnd(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.locator('a[href^="/legends/"]').first().click();
    await page.waitForURL(/\/legends\/[^/]+/);
    await page.goBack();
    await page.waitForURL(/\/legends$/);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.scrollY);
    test.info().annotations.push({ type: "scroll-restoration", description: `before=${before} after=${after}` });
    expect.soft(Math.abs(after - before), `scrollY before=${before} after=${after}`).toBeLessThanOrEqual(4);
  });

  test("16. No hydration warnings on /play and /legends", async ({ authedPage: page }) => {
    const messages: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("Hydration")) messages.push(msg.text());
    });
    page.on("pageerror", (err) => {
      if (err.message.includes("Hydration")) messages.push(err.message);
    });
    for (const path of ["/play", "/legends"]) {
      await gotoApp(page, path);
      await expectShell(page);
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    expect(messages).toEqual([]);
  });
});

test.describe("Phone shell (Pixel 7) @p1", () => {
  test.use({ ...pixel7 });

  test("8. Tab bar, account sheet, SubNav and Back", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    const tabbar = page.getByTestId("shell-tabbar");
    await expect(tabbar).toBeVisible();

    await scrollToEnd(page);
    const start = await page.getByTestId("start-game-button").boundingBox();
    const tab = await tabbar.boundingBox();
    expect(start && tab, "start button and tab bar boxes").toBeTruthy();
    expect(start!.y + start!.height).toBeLessThanOrEqual(tab!.y + 1);

    await openAccountSheet(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-sheet")).toBeHidden();

    await page.getByTestId("subnav-item-tournaments").click();
    await page.waitForURL(/\/tournaments$/);

    await gotoApp(page, "/legends");
    await expectShell(page);
    await page.getByTestId("subnav-item-openings").click();
    await page.waitForURL(/\/openings$/);

    const legendHref = await firstLegendHref(page);
    test.skip(!legendHref, "No legends on this database: Back check skipped");
    await gotoApp(page, legendHref!);
    await expect(page.getByTestId("shell-back")).toBeVisible();
    await page.getByTestId("shell-back").click();
    await page.waitForURL(/\/legends$/);
  });

  test("14. Clerk profile opens from the account sheet", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    await openAccountSheet(page);
    await page.getByTestId("account-item-account").click();

    const profile = page.locator(".cl-userProfile-root");
    await expect(profile).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none");
    const firstButton = profile.locator("button").first();
    await firstButton.focus();
    await expect(firstButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(profile).toBeHidden();
  });
});

// Plan phase-01 §8.6 / B4: Sign Out ends on "/" on every browser, and nothing navigates to /sign-in while the
// sign-out intent is set. regression: CI runs 43246907343 (and before the first fix, every local webkit run): on
// webkit-iphone the phone sheet's Sign Out from /play landed on /sign-in?redirect_url=%2Fplay. clerk-js signOut()
// first awaits the Next provider's cache-invalidating server action (POST /play); its response re-rendered the tree
// while still signed in and SessionWatcher's signed-in branch cleared `rc.signout`; so the post-sign-out
// router.refresh() was not dropped (skipRefreshAfterSetActive), its RSC request met the middleware's sign-in redirect,
// and that navigation replaced the load of "/". Whether the refresh beats the load of "/" depends on the browser's
// timing, so the test checks the cause directly: the "/" document is held back 3 s (a refresh, if any, has time to
// start), no router refresh or navigation request is made after Sign Out, and `rc.signout` reaches "/".
test.describe("Phone sign-out @p1 @smoke", () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

  test("Sign Out from the account sheet on /play lands on / and stays there", async ({ authedPage: page }) => {
    await gotoApp(page, "/play");
    await expectShell(page);
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(f.url());
    });
    let heldHome = 0;
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().resourceType() === "document") {
          heldHome++;
          await new Promise((r) => setTimeout(r, 3_000));
        }
        await route.continue().catch(() => undefined);
      },
    );
    await openAccountSheet(page);
    // Router refreshes or navigations (RSC requests that are not prefetches) after Sign Out: there must be none, since
    // a full document load of "/" is the only navigation a sign-out makes.
    const refreshes: string[] = [];
    page.on("request", (r) => {
      const h = r.headers();
      if (h["rsc"] && !h["next-router-prefetch"] && new URL(r.url()).pathname !== "/") refreshes.push(r.url());
    });
    await page.getByTestId("account-item-signout").click();
    // "commit", not "load": the marketing home page's third-party badges can hold `load` back past 30 s.
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000, waitUntil: "commit" });
    await expect(page.getByTestId("marketing-navbar")).toBeVisible({ timeout: 30_000 });
    expect(heldHome, "the load of / was held back").toBeGreaterThan(0);
    // Settled: no late navigation to sign-in after the load of "/", and the sign-out intent survived to "/".
    await page.waitForTimeout(2_000);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(visited.filter((u) => new URL(u).pathname.startsWith("/sign-in")), "navigations to sign-in").toEqual([]);
    expect(refreshes, "router refreshes after Sign Out").toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem("rc.signout")), "the sign-out intent reached /").toBe("1");
  });
});

test.describe("Marketing chrome for everyone else @p1", () => {
  test("10. A non-member keeps the marketing Navbar on /legends", async ({ nonMemberPage: page }) => {
    await gotoApp(page, "/legends");
    await expect(page.getByTestId("marketing-navbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });

  test("11. Signed-out /legends keeps Navbar, Footer and breadcrumbs @public", async ({ page }) => {
    await gotoApp(page, "/legends");
    await expect(page.getByTestId("marketing-navbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonLd.some((s) => s.includes("BreadcrumbList"))).toBe(true);
  });
});

// 12. Scroll and clip (C B1, F B4): the page's last element and the fixed CTA
// bar end inside the viewport, above the tab bar.
const scrollProjects = [
  { name: "Pixel 7", use: pixel7 },
  { name: "desktop 1280x800 at 150%", use: { viewport: { width: 853, height: 533 }, deviceScaleFactor: 3 } },
] as const;

for (const project of scrollProjects) {
  test.describe(`12. Scroll and clip on ${project.name} @p1`, () => {
    test.use({ ...project.use });

    test("member pages scroll to their last element", async ({ authedPage: page }) => {
      const legendHref = await firstLegendHref(page);
      const positionHref = await firstPositionHref(page, legendHref);
      const paths = ["/play", legendHref, positionHref].filter((p): p is string => Boolean(p));
      if (!legendHref) test.info().annotations.push({ type: "skip", description: "No legends: /legends/<ref> not checked" });
      if (!positionHref) test.info().annotations.push({ type: "skip", description: "No positions: /position/<ref> not checked" });

      for (const path of paths) {
        await gotoApp(page, path);
        await expectShell(page);
        if (path === "/play") await expect(page.getByTestId("mode-quick")).toBeVisible();
        else await page.waitForLoadState("networkidle").catch(() => {});
        // Entrance animations (framer-motion transforms) make an ancestor the
        // containing block of the fixed CTA bar until they finish: measure once
        // two readings 300 ms apart agree.
        let m = await measureEnd(page);
        await expect(async () => {
          await scrollToEnd(page);
          const a = await measureEnd(page);
          await page.waitForTimeout(300);
          m = await measureEnd(page);
          expect(JSON.stringify(m)).toBe(JSON.stringify(a));
        }).toPass({ timeout: 20_000 });
        expect(m.last, `${path}: page root's last element`).not.toBeNull();
        expect(insideViewport(m.last!, m.innerHeight), `${path}: ${m.lastTag} inside viewport ${JSON.stringify(m)}`).toBe(true);
        if (m.cta) expect(insideViewport(m.cta, m.innerHeight), `${path}: CTA bar inside viewport`).toBe(true);
        const limits = [m.cta?.top, m.tabbar?.top].filter((v): v is number => typeof v === "number");
        if (limits.length > 0) {
          expect(m.last!.bottom, `${path}: ${m.lastTag} above the bars ${JSON.stringify(m)}`).toBeLessThanOrEqual(
            Math.min(...limits) + 1,
          );
        }
        if (m.cta && m.tabbar) expect(m.cta.bottom, `${path}: CTA bar above the tab bar`).toBeLessThanOrEqual(m.tabbar.top + 1);

        if (path === "/play") {
          const quick = page.getByTestId("mode-quick");
          await quick.scrollIntoViewIfNeeded();
          await quick.click({ trial: true });
        }
      }
    });
  });
}
