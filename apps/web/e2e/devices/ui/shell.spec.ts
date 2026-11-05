// App shell on the demo route (SPEC 8.4). Signed out; /dev/ui/shell renders the
// real AppShellView with demo users. Keyboard steps run on Chromium only.
// axe for the shell section and the demo route lives in ui/a11y.spec.ts
// (`a11y shell <theme>`, `a11y shell-demo <theme>`).
import type { Page, TestInfo } from "@playwright/test";
import { setTheme } from "../a11y";
import { expect, isChromium, isTouchShell, test, waitForStable } from "../helpers";

const DEMO = "/dev/ui/shell";
const PHONES = ["ui-iphone", "ui-android"];

async function open(page: Page, query = "") {
  const res = await page.goto(`${DEMO}${query}`);
  expect(res?.status(), `${DEMO}${query} status`).toBe(200);
  await waitForStable(page);
  await expect(page.getByTestId("app-shell")).toBeVisible();
}

function only(testInfo: TestInfo, names: string[], why = `runs on ${names.join(", ")}`) {
  test.skip(!names.includes(testInfo.project.name), why);
}

const sidebar = (page: Page) => page.getByTestId("shell-sidebar");

async function visibleTestIds(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      })
      .map((el) => el.getAttribute("data-testid") ?? ""),
  );
}

/** One visible dialog layer that is open (Radix keeps closed ones unmounted). */
async function openDialogIds(page: Page): Promise<string[]> {
  return page
    .locator('[role="dialog"]:visible')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? "?"));
}

test.describe("desktop sidebar @p1", () => {
  test.beforeEach(() => only(test.info(), ["ui-desktop"]));

  test("220px sidebar with Play, Tournaments, Learn and Profile only", async ({ page }) => {
    await open(page);
    const box = await sidebar(page).boundingBox();
    expect(Math.abs((box?.width ?? 0) - 220)).toBeLessThanOrEqual(1);
    expect((await visibleTestIds(page, '[data-testid="shell-sidebar"] [data-testid^="nav-item-"]')).sort()).toEqual([
      "nav-item-learn",
      "nav-item-play",
      "nav-item-profile",
      "nav-item-tournaments",
    ]);
    for (const name of ["Home", "Train", "Review", "Settings"]) {
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId("subnav")).toBeHidden();
  });

  test("Learn subs show only while Learn is current @demo:V3Nav.learn", async ({ page }) => {
    await open(page, "?current=legends");
    expect((await visibleTestIds(page, '[data-testid="shell-sidebar"] [data-testid^="nav-item-"]')).sort()).toEqual([
      "nav-item-learn",
      "nav-item-legends",
      "nav-item-openings",
      "nav-item-play",
      "nav-item-profile",
      "nav-item-tournaments",
    ]);
    await expect(page.getByTestId("subnav")).toBeHidden();
  });

  test("current=tournaments marks Play and Tournaments", async ({ page }) => {
    await open(page, "?current=tournaments");
    await expect(sidebar(page).getByTestId("nav-item-play")).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).getByTestId("nav-item-tournaments")).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).getByTestId("nav-item-learn")).not.toHaveAttribute("aria-current", /.*/);
  });

  test("trial tag, no rating line", async ({ page }) => {
    await open(page, "?user=trial");
    await expect(sidebar(page).getByTestId("shell-trial-tag")).toHaveText("Trial · 5 days left");
    await open(page, "?user=norating");
    await expect(sidebar(page).getByTestId("shell-rating")).toHaveCount(0);
    await expect(sidebar(page).getByTestId("shell-trial-tag")).toHaveCount(0);
  });

  test("payment banner shows the server date and stays dismissed for the session", async ({ page }) => {
    await open(page, "?user=payment");
    const banner = page.getByTestId("shell-payment-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Nov 12");
    await expect(banner.getByRole("button", { name: "Update Payment" })).toBeVisible();
    await banner.getByRole("button", { name: "Dismiss for this session" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await waitForStable(page);
    await expect(page.getByTestId("shell-payment-banner")).toHaveCount(0);
  });

  test("admin item only for admins", async ({ page }) => {
    await open(page, "?user=admin");
    await page.getByTestId("shell-account-button").click();
    await expect(page.getByTestId("account-item-admin")).toBeVisible();
    await page.keyboard.press("Escape");
    await open(page);
    await page.getByTestId("shell-account-button").click();
    await expect(page.getByTestId("account-menu")).toBeVisible();
    await expect(page.getByTestId("account-item-admin")).toHaveCount(0);
  });

  test("account menu items, demo-disabled actions, Esc focus return, theme toggle", async ({ page }) => {
    await open(page);
    const gear = page.getByTestId("shell-account-button");
    await gear.click();
    const menu = page.getByTestId("account-menu");
    await expect(menu).toBeVisible();
    for (const id of ["membership", "account", "theme", "help", "privacy", "terms", "signout"]) {
      await expect(menu.getByTestId(`account-item-${id}`)).toBeVisible();
    }
    await expect(menu.getByTestId("account-item-account")).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByTestId("account-item-signout")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(gear).toBeFocused();

    const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await gear.click();
    await page.getByTestId("account-item-theme").click();
    await expect(page.locator("html")).toHaveClass(wasDark ? /(^|\s)light(\s|$)/ : /(^|\s)dark(\s|$)/);
    await gear.click();
    await page.getByTestId("account-item-theme").click();
    await expect(page.locator("html")).toHaveClass(wasDark ? /(^|\s)dark(\s|$)/ : /(^|\s)light(\s|$)/);
  });

  test("dark theme: the current item fills with the dark accent @demo:V3Nav.play", async ({ page }) => {
    await open(page, "?current=play");
    await setTheme(page, "dark");
    const { bg, accent } = await sidebar(page)
      .getByTestId("nav-item-play")
      .evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--cb-accent)";
        document.body.append(probe);
        const accent = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { bg: getComputedStyle(el).backgroundColor, accent };
      });
    expect(bg).toBe(accent);
    await setTheme(page, "light");
  });

  test("rail at 1000x700: 64px, no wordmark, tooltips on focus, SubNav", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, "?current=legends");
    const box = await sidebar(page).boundingBox();
    expect(Math.abs((box?.width ?? 0) - 64)).toBeLessThanOrEqual(1);
    await expect(sidebar(page).getByTestId("shell-brand").locator("span")).toBeHidden();
    await sidebar(page).getByTestId("nav-item-play").focus();
    await expect(page.getByRole("tooltip")).toContainText("Play");
    const subnav = page.getByTestId("subnav");
    await expect(subnav).toBeVisible();
    await expect(subnav.getByTestId("subnav-item-legends")).toBeVisible();
    await expect(subnav.getByTestId("subnav-item-openings")).toBeVisible();
  });
});

test.describe("time zone @p1", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("no hydration warnings outside UTC", async ({ page }, testInfo) => {
    only(testInfo, ["ui-desktop"]);
    const messages: string[] = [];
    page.on("console", (m) => messages.push(m.text()));
    await open(page, "?user=payment");
    await expect(page.getByTestId("shell-payment-banner")).toContainText("Nov 12");
    expect(messages.filter((m) => m.includes("Hydration"))).toEqual([]);
  });
});

test.describe("keyboard @p1", () => {
  test.beforeEach(() => {
    const testInfo = test.info();
    only(testInfo, ["ui-desktop"], "keyboard checks run on desktop Chromium");
    test.skip(!isChromium(testInfo), "keyboard checks run on Chromium only");
  });

  test("ControlOrMeta+K opens the palette; 'tour' filters to Tournaments; Enter navigates @demo:V3CommandPalette.open @demo:V3CommandPalette.closed", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+K");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
    await page.keyboard.type("tour");
    await expect(palette.locator('[data-testid^="palette-item-"]')).toHaveCount(1);
    await expect(page.getByTestId("palette-item-tournaments")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/tournaments|\/sign-in/);
  });

  test("'/' on the body opens the palette", async ({ page }) => {
    await open(page);
    await page.locator("body").click({ position: { x: 600, y: 600 } });
    await page.keyboard.press("/");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });

  test("in a field: '/' types, 'g p' stays, ControlOrMeta+K still opens", async ({ page }) => {
    await open(page);
    const input = page.getByTestId("shell-demo-input");
    await input.click();
    await page.keyboard.press("/");
    await expect(input).toHaveValue("/");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe(DEMO);
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });

  test("'?' opens shortcuts; ControlOrMeta+K swaps to the palette (no stacking) @demo:V3Shortcuts.open @demo:V3Shortcuts.closed", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
    expect(await openDialogIds(page)).toEqual(["command-palette"]);
  });

  test("the Single-Key Shortcuts switch turns '/' and 'g p' off and persists", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    const toggle = page.getByTestId("shortcuts-single-key-switch");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);

    await page.keyboard.press("/");
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(DEMO);
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await waitForStable(page);
    await page.keyboard.press("/");
    await page.waitForTimeout(200);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);

    // Turn it back on through the palette row.
    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.type("keyboard");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
    await page.getByTestId("shortcuts-single-key-switch").click();
    await expect(page.getByTestId("shortcuts-single-key-switch")).toHaveAttribute("aria-checked", "true");
  });

  test("'g' then 'p' navigates to Play", async ({ page }) => {
    await open(page);
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.waitForURL(/\/play|\/sign-in/);
  });

  test("the first Tab focuses the skip link; Enter moves focus to #main", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("phones @p1", () => {
  test.beforeEach(() => only(test.info(), PHONES));

  test("top bar and tab bar; no sidebar, no search button", async ({ page }) => {
    await open(page);
    const tabbar = page.getByTestId("shell-tabbar");
    await expect(tabbar).toBeVisible();
    await expect(tabbar.locator('[data-testid^="tab-item-"]')).toHaveCount(3);
    await expect(sidebar(page)).toBeHidden();
    const top = await page.getByTestId("shell-topbar").boundingBox();
    expect(Math.abs((top?.height ?? 0) - 44)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("shell-search-button")).toBeHidden();
  });

  test("the avatar opens the account sheet at the bottom", async ({ page }) => {
    await open(page);
    await page.getByTestId("shell-account-avatar").click();
    const sheet = page.getByTestId("account-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("account-item-membership")).toBeVisible();
    const box = await sheet.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - vh)).toBeLessThanOrEqual(1);
  });

  test("SubNav reaches Tournaments", async ({ page }) => {
    await open(page, "?current=play");
    await expect(page.getByTestId("subnav")).toBeVisible();
    // next dev can swallow a tap during the Clerk dev handshake reload or an HMR rebuild; tap again.
    await expect(async () => {
      if (/\/tournaments|\/sign-in/.test(page.url())) return;
      await page.getByTestId("subnav-item-tournaments").click({ timeout: 5000 });
      await page.waitForURL(/\/tournaments|\/sign-in/, { timeout: 8000 });
    }).toPass({ timeout: 25_000 });
  });

  test("detail route: Back replaces the brand and the SubNav", async ({ page }) => {
    await open(page, "?back=legends&current=legends");
    const back = page.getByTestId("shell-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveText("Legends");
    await expect(back).toHaveAttribute("href", "/legends");
    await expect(page.getByTestId("subnav")).toBeHidden();
  });
});

test.describe("iPad @p1", () => {
  test.beforeEach(() => only(test.info(), ["ui-ipad"]));

  test("coarse pointer: rail, SubNav, ⌘K, no search button, no '/'", async ({ page }) => {
    await open(page, "?current=play");
    const coarse = await isTouchShell(page);
    if (coarse) {
      const box = await sidebar(page).boundingBox();
      expect(Math.abs((box?.width ?? 0) - 64)).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("shell-search-button")).toBeHidden();
    }
    await expect(page.getByTestId("subnav")).toBeVisible();
    await page.locator("#main").focus();
    if (coarse) {
      await page.keyboard.press("/");
      await page.waitForTimeout(200);
      await expect(page.getByTestId("command-palette")).toHaveCount(0);
    }
    await page.keyboard.press("ControlOrMeta+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });
});

test("offline chip, then Back online without a reload @p1", async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => ((window as unknown as { __rcMarker: number }).__rcMarker = 42));
  const tabbar = await page.getByTestId("shell-tabbar").isVisible();
  const chip = page.getByTestId(tabbar ? "shell-online-chip-inline" : "shell-online-chip");
  await context.setOffline(true);
  await expect(chip).toContainText(tabbar ? "Offline" : "Offline · cached pages still work");
  await context.setOffline(false);
  await expect(chip).toContainText("Back online");
  expect(await page.evaluate(() => (window as unknown as { __rcMarker?: number }).__rcMarker)).toBe(42);
});

test.describe("palette legend search @p1", () => {
  test.beforeEach(() => only(test.info(), ["ui-desktop"]));

  test("'morphy' finds Paul Morphy (needs the P6 seed)", async ({ page, request }) => {
    const res = await request.get("/api/legends/search?name=morphy");
    const json = res.ok() ? await res.json() : null;
    test.skip(!json?.data?.legends?.length, "no legend matches 'morphy' on this database (P6 dev seed not applied)");
    await open(page);
    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.type("morphy");
    await expect(page.getByTestId("command-palette").getByText("Paul Morphy")).toBeVisible();
  });

  test("offline: Search needs a connection", async ({ page, context }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+K");
    await context.setOffline(true);
    await page.keyboard.type("mo");
    await expect(page.getByTestId("palette-legends-offline")).toBeVisible();
    await context.setOffline(false);
  });
});

test("no dead links in the nav, SubNav, account menu or Back @p1", async ({ page }, testInfo) => {
  only(testInfo, ["ui-desktop"]);
  await open(page, "?user=admin&current=play&back=legends");
  await page.getByTestId("shell-account-button").click();
  await expect(page.getByTestId("account-menu")).toBeVisible();
  const hrefs = await page
    .locator(
      '[data-rc-nav] a[href], [data-rc-tabbar] a[href], [data-testid="subnav"] a[href], [data-testid="account-menu"] a[href], a[data-testid="shell-back"]',
    )
    .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  const unique = [...new Set(hrefs)].filter((h) => h && !h.startsWith("#"));
  expect(unique.length).toBeGreaterThan(3);
  for (const href of unique) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBeLessThan(400);
    // Next preloads the not-found boundary in the RSC payload, so look at the markup outside <script>.
    const markup = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
    expect(markup, `${href} renders the 404 page`).not.toContain("Off the Board");
  }
});
