// axe in both themes (SPEC 5.2). Tags cover color-contrast, landmark-unique,
// aria-* and button-name.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const THEME_STORAGE_KEY = "chess-battle-theme"; // app/components/ThemeProvider.tsx
const BODY_BG = { light: "rgb(250, 249, 246)", dark: "rgb(0, 0, 0)" } as const;

/**
 * Switches the theme the way the app does (the gallery toggle when present, so
 * next-themes can't re-apply the old class after hydration), then waits until
 * the body background really is the theme's cb-bg before any colour check.
 */
export async function setTheme(page: Page, theme: "light" | "dark") {
  const toggle = page.getByTestId(`gallery-theme-${theme}`);
  if (await toggle.count()) {
    await toggle.click();
  } else {
    await page.evaluate(
      ({ t, key }) => {
        try {
          localStorage.setItem(key, t);
        } catch {
          // Storage can be blocked; the class alone still themes the page.
        }
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(t);
        root.style.colorScheme = t;
      },
      { t: theme, key: THEME_STORAGE_KEY },
    );
  }
  await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
  await expect(page.locator("body")).toHaveCSS("background-color", BODY_BG[theme]);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  // WebKit (ui-ipad, ui-iphone) updates the inherited `color` of some descendants (rows inside a ScrollRegion) up to
  // ~300 ms after the theme class flips: getComputedStyle still returned the old #1a1a1a at +50 ms and white at
  // +300 ms, with no transition involved. Wait until every element's computed colour holds for 400 ms (samples every
  // 100 ms, at most 3 s) before axe measures contrast.
  await page.evaluate(async () => {
    const sample = () => {
      let acc = "";
      for (const el of document.querySelectorAll("body *")) acc += getComputedStyle(el).color + ";";
      return acc;
    };
    const deadline = performance.now() + 3000;
    let last = sample();
    let stable = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      const now = sample();
      stable = now === last ? stable + 1 : 0;
      if (stable >= 4 || performance.now() > deadline) return;
      last = now;
    }
  });
}

export async function expectNoAxeViolations(page: Page, { include, theme }: { include?: string; theme: "light" | "dark" }) {
  await setTheme(page, theme);
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect(summary, `axe violations (${theme})`).toEqual([]);
}
