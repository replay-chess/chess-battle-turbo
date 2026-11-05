// P0 gallery checks (SPEC 5.4) on the 4 UI projects.
import { expect, expectTapTargets, gotoSection, isChromium, test, waitForStable } from "../helpers";

const SECTIONS = ["foundations", "controls", "overlays", "shell", "layout"] as const;

test("/dev/ui renders every section and is noindex", async ({ page }) => {
  const res = await page.goto("/dev/ui");
  expect(res?.status()).toBe(200);
  await waitForStable(page);
  for (const id of SECTIONS) await expect(page.getByTestId(`gallery-${id}`)).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test("every section route returns 200", async ({ page }) => {
  for (const id of SECTIONS) {
    await gotoSection(page, id);
    await expect(page.getByTestId(`gallery-${id}`)).toBeVisible();
  }
});

test("dark theme switch turns cb-bg black", async ({ page }) => {
  await gotoSection(page, "foundations");
  await page.getByTestId("gallery-theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const swatch = page.getByTestId("ui-tokens-neutrals").locator('[data-token="cb-bg"]');
  await expect(swatch).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#000000");
  await page.getByTestId("gallery-theme-light").click();
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#FAF9F6");
});

test("primary button is square, at least 44 tall and accent filled", async ({ page }) => {
  await gotoSection(page, "foundations");
  const button = page.getByTestId("ui-button-primary").getByRole("button").first();
  await expect(button).toHaveCSS("border-radius", "0px");
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  const { bg, accent } = await button.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.background = "var(--cb-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { bg: getComputedStyle(el).backgroundColor, accent };
  });
  expect(bg).toBe(accent);
});

test("button sizes all reach a 44px hit box", async ({ page }) => {
  await gotoSection(page, "foundations");
  await expectTapTargets(page, { root: '[data-testid="ui-button-sizes"]', all44: true });
});

test("focus ring is 2px solid", async ({ page }, testInfo) => {
  test.skip(!isChromium(testInfo), "keyboard focus checks run on Chromium only");
  await gotoSection(page, "foundations");
  const first = page.getByTestId("ui-focus-demo").getByRole("button").first();
  await first.focus();
  // Focus via the keyboard so :focus-visible applies.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-style", "solid");
  await expect(first).toHaveCSS("outline-width", "2px");
});

test("loading button is busy and ignores clicks", async ({ page }) => {
  await gotoSection(page, "foundations");
  const button = page.getByTestId("ui-button-loading").getByRole("button");
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // React handles clicks at its root, so a window listener sees the event after
  // the Button's handler has run and prevented it.
  await button.evaluate((el) => {
    (window as unknown as { __rcClicked: number }).__rcClicked = 0;
    window.addEventListener("click", (e) => {
      if (el.contains(e.target as Node) && !e.defaultPrevented) (window as unknown as { __rcClicked: number }).__rcClicked += 1;
    });
  });
  await button.click({ force: true });
  expect(await page.evaluate(() => (window as unknown as { __rcClicked: number }).__rcClicked)).toBe(0);
});

for (const route of ["/pricing", "/dev/ui"]) {
  test(`Geist loads on ${route}`, async ({ page }) => {
    await page.goto(route);
    await waitForStable(page);
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family.replace(/["']/g, "")).toMatch(/^Geist/);
    const loaded = await page.evaluate(async () => (await document.fonts.load("500 16px Geist")).length);
    expect(loaded).toBeGreaterThan(0);
  });
}
