// P2 overlays and toasts (SPEC 7.4) on the 4 UI projects plus the 2 motion
// projects. Keyboard-driven steps run on Chromium only (F M6). On motion projects
// geometry is read after the element's own animations finish.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { setTheme } from "../a11y";
import { expect, expectTapTargets, isChromium, test, waitForStable } from "../helpers";

const device = (ti: TestInfo) => (ti.project.metadata?.device as string | undefined) ?? "";
const hasTouch = (ti: TestInfo) => Boolean(ti.project.use.hasTouch);

/** Click, or tap on touch projects. */
async function press(locator: Locator, ti: TestInfo) {
  if (hasTouch(ti)) await locator.tap();
  else await locator.click();
}

/** Waits for the element's own (finite) animations, e.g. rc-pop or rc-sheet on motion projects. */
async function settle(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "element has a box").not.toBeNull();
  return b!;
}

function viewport(page: Page) {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

/** Resolves a CSS colour expression (e.g. var(--cb-surface)) to rgb() in the current theme. */
function resolveBg(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.background = v;
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, value);
}

/**
 * gotoSection for this section, plus a query, with one retry when the shared
 * `next dev` aborts the navigation (a Fast Refresh reload while other packages
 * edit files). A real 404/500 still fails.
 */
async function openOverlays(page: Page, query = "") {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await page.goto(`/dev/ui/sections/overlays${query}`);
      expect(res?.status(), "/dev/ui/sections/overlays status").toBe(200);
      break;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted|cancelled/i.test(String(error))) throw error;
    }
  }
  await waitForStable(page);
  // Clicks before hydration are lost; the section renders this marker once hydrated.
  await expect(page.getByTestId("ui-overlays-ready")).toBeAttached({ timeout: 20_000 });
}

const VISIBLE_TOAST = '[data-sonner-toast][data-visible="true"]';
const FRONT_TOAST = '[data-sonner-toast][data-front="true"]';

test.describe("dialog", () => {
  test("opens modal, traps focus, closes on Esc and returns focus", async ({ page }, ti) => {
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (/Description/.test(m.text())) warnings.push(m.text());
    });
    await openOverlays(page);
    const trigger = page.getByTestId("ui-dialog-trigger");
    await press(trigger, ti);
    const dialog = page.getByRole("dialog", { name: "Rename Position" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("ui-dialog")).toBeVisible();
    await settle(dialog);
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    if (isChromium(ti)) {
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `Tab ${i + 1} stays inside`).toBe(true);
      }
    }
    if (device(ti) === "desktop-1440") {
      expect(Math.abs((await box(dialog)).width - 560)).toBeLessThanOrEqual(1);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(warnings, "no Radix Description warning").toEqual([]);
  });

  test("xl dialog is 1040 wide on desktop and capped by the viewport elsewhere", async ({ page }, ti) => {
    await openOverlays(page);
    await press(page.getByTestId("ui-dialog-xl-trigger"), ti);
    const dialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(dialog).toBeVisible();
    await settle(dialog);
    const { w } = await viewport(page);
    expect(Math.abs((await box(dialog)).width - Math.min(1040, w - 32))).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test("alert dialog focuses the safe action", async ({ page }, ti) => {
  await openOverlays(page);
  const trigger = page.getByTestId("ui-alert-dialog-trigger");
  await press(trigger, ti);
  const alert = page.getByRole("alertdialog", { name: "Resign This Game?" });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("ui-alert-dialog")).toBeVisible();
  await expect(alert.getByRole("button", { name: "Keep Playing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(alert).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("sheet sits on the bottom edge at 60% height and closes on Esc", async ({ page }, ti) => {
  await openOverlays(page);
  const trigger = page.getByTestId("ui-sheet-trigger");
  await press(trigger, ti);
  const sheet = page.getByRole("dialog", { name: "Moves" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await settle(sheet);
  const { h } = await viewport(page);
  const b = await box(sheet);
  expect(Math.abs(b.y + b.height - h), "bottom equals the viewport height").toBeLessThanOrEqual(1);
  expect(Math.abs(b.height - 0.6 * h), "height is 60dvh").toBeLessThanOrEqual(2);
  await expect(sheet.locator("[data-rc-grabber]")).toHaveCount(1);
  await expect(sheet.locator("[data-rc-grabber]")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("responsive dialog is a sheet in tab-bar mode and a dialog otherwise", async ({ page }, ti) => {
  await openOverlays(page);
  await press(page.getByTestId("ui-responsive-dialog-trigger"), ti);
  const surface = page.getByTestId("ui-responsive-dialog");
  await expect(surface).toBeVisible();
  const tabbar = await page.evaluate(() =>
    matchMedia("(max-width: 600px), (max-width: 900px) and (orientation: portrait)").matches,
  );
  await expect(surface).toHaveAttribute("data-surface", tabbar ? "sheet" : "dialog");
  await expect(page.getByRole("dialog", { name: "Game Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(surface).toBeHidden();
});

test.describe("menu", () => {
  test("keyboard: arrows move the highlight, disabled is skipped, Enter selects, Esc returns focus", async ({ page }, ti) => {
    test.skip(!isChromium(ti), "keyboard steps run on Chromium only");
    await openOverlays(page);
    const trigger = page.getByTestId("ui-menu-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("ui-menu")).toBeVisible();
    const highlighted = menu.locator("[data-highlighted]");
    await expect(highlighted).toHaveText("Offer Draw");
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).toContainText("Flip Board");
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).toContainText("Sound");
    await page.keyboard.press("ArrowDown");
    await expect(highlighted).toContainText("Resign");
    await page.keyboard.press("ArrowDown"); // Abort is disabled, so the highlight stays
    await expect(highlighted).toContainText("Resign");
    await expect(menu.getByRole("menuitem", { name: "Abort" })).toHaveAttribute("aria-disabled", "true");

    await page.keyboard.press("ArrowUp");
    const sound = page.getByTestId("ui-menu-sound");
    await expect(highlighted).toContainText("Sound");
    await expect(sound).toBeFocused();
    await expect(sound).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("ui-menu-sound")).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("pointer: Sound toggles aria-checked and Esc closes", async ({ page }, ti) => {
    await openOverlays(page);
    const trigger = page.getByTestId("ui-menu-trigger");
    await press(trigger, ti);
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Sound" })).toHaveAttribute("aria-checked", "true");
    await press(page.getByTestId("ui-menu-sound"), ti);
    await expect(menu).toBeHidden();
    await press(trigger, ti);
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("ui-menu-sound")).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test("tooltip shows on focus", async ({ page }) => {
  await openOverlays(page);
  await page.getByTestId("ui-tooltip-trigger").focus();
  const tip = page.getByTestId("ui-tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Flip Board");
  await expect(page.getByRole("tooltip")).toHaveText("Flip Board");
});

test.describe("popovers", () => {
  for (const { trigger, content, label, text } of [
    { trigger: "ui-popover-trigger", content: "ui-popover", label: "Display", text: "Show Coordinates" },
    { trigger: "ui-info-button", content: "ui-info-popover", label: "Positions", text: "Mistakes from your games, ready to replay." },
    { trigger: "ui-filter-popover", content: "ui-filter-content", label: "Filter Games", text: "Clear All" },
  ]) {
    test(`${content} opens on ${"click or tap"}, is labelled and closes on Esc`, async ({ page }, ti) => {
      await openOverlays(page);
      const t = page.getByTestId(trigger);
      await press(t, ti);
      const pop = page.getByTestId(content);
      await expect(pop).toBeVisible();
      await expect(pop).toHaveAttribute("aria-label", label);
      await expect(pop).toContainText(text);
      await expect(t).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(pop).toBeHidden();
      await expect(t).toBeFocused();
    });
  }

  test("filter badge counts, Clear All removes it, Show closes", async ({ page }, ti) => {
    await openOverlays(page);
    const trigger = page.getByTestId("ui-filter-popover");
    await expect(trigger).toHaveAccessibleName("Filter, 2 active");
    const badge = trigger.locator("span.rounded-full");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("2");
    await press(trigger, ti);
    const content = page.getByTestId("ui-filter-content");
    await expect(content).toBeVisible();
    await press(content.getByRole("button", { name: "Clear All" }), ti);
    await expect(badge).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName("Filter");
    await press(content.getByRole("button", { name: "Show 24 Games" }), ti);
    await expect(content).toBeHidden();
  });
});

test("opening overlays never scrolls the page or shifts layout", async ({ page }, ti) => {
  await openOverlays(page);
  const doc = () => page.evaluate(() => document.scrollingElement!.scrollTop);
  for (const id of ["ui-dialog-trigger", "ui-sheet-trigger", "ui-popover-trigger", "ui-menu-trigger"]) {
    const trigger = page.getByTestId(id);
    await trigger.scrollIntoViewIfNeeded();
    const before = { top: await doc(), box: await box(trigger) };
    await press(trigger, ti);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await doc(), `${id}: scrollTop unchanged`).toBe(before.top);
    const after = await box(trigger);
    expect(Math.abs(after.x - before.box.x) + Math.abs(after.y - before.box.y), `${id}: no layout shift`).toBeLessThanOrEqual(0.5);
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test.describe("toasts", () => {
  test("desktop, shell placement: top-right, 3 visible, 380 wide", async ({ page }, ti) => {
    test.skip(device(ti) !== "desktop-1440", "desktop geometry");
    await openOverlays(page);
    await expect(page.getByTestId("ui-toast-shell-toggle")).toHaveAttribute("aria-pressed", "true");
    const info = page.getByTestId("ui-toast-info");
    for (let i = 0; i < 4; i++) await info.click();
    await expect(page.locator(FRONT_TOAST)).toBeVisible();
    await expect.poll(() => page.locator(VISIBLE_TOAST).count()).toBeLessThanOrEqual(3);
    await expect(page.locator('[data-testid="toast-info"]').first()).toBeVisible();
    const { w } = await viewport(page);
    await expect
      .poll(async () => {
        const b = await page.locator(FRONT_TOAST).boundingBox();
        return b ? { right: Math.abs(b.x + b.width - (w - 24)) <= 2, top: Math.abs(b.y - 16) <= 4, width: Math.abs(b.width - 380) <= 1 } : null;
      })
      .toEqual({ right: true, top: true, width: true });
  });

  test("desktop, page placement: top-centre at sonner's default offset", async ({ page }, ti) => {
    test.skip(device(ti) !== "desktop-1440", "desktop geometry");
    await openOverlays(page, "?placement=page");
    await expect(page.getByTestId("ui-toast-shell-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("ui-toast-info").click();
    const { w } = await viewport(page);
    await expect
      .poll(async () => {
        const b = await page.locator(FRONT_TOAST).boundingBox();
        return b ? { centre: Math.abs(b.x + b.width / 2 - w / 2) <= 2, top: Math.abs(b.y - 24) <= 4 } : null;
      })
      .toEqual({ centre: true, top: true });
  });

  test("phones: one visible, centred above the bottom edge, text and action only", async ({ page }, ti) => {
    test.skip(!["iphone", "android"].includes(device(ti)), "phone geometry");
    await openOverlays(page);
    await press(page.getByTestId("ui-toast-info"), ti);
    await press(page.getByTestId("ui-toast-error"), ti);
    await expect.poll(() => page.locator(VISIBLE_TOAST).count()).toBe(1);
    const front = page.locator(FRONT_TOAST);
    await expect(front).toHaveAttribute("data-testid", "toast-error");
    const { w, h } = await viewport(page);
    await expect
      .poll(async () => {
        const b = await front.boundingBox();
        return b ? { centre: Math.abs(b.x + b.width / 2 - w / 2) <= 2, bottom: b.y + b.height <= h - 16 } : null;
      })
      .toEqual({ centre: true, bottom: true });
    await expect(front.locator("[data-close-button]")).toBeHidden();
    const retry = front.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    expect((await box(retry)).height).toBeGreaterThanOrEqual(44 - 0.5);

    await press(page.getByTestId("ui-toast-controls-toggle"), ti);
    await expect(page.getByTestId("ui-toast-controls-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(retry).toBeHidden();
  });

  test("iPad portrait: bottom-centre, 440 wide", async ({ page }, ti) => {
    test.skip(device(ti) !== "ipad-landscape", "tablet portrait geometry");
    await page.setViewportSize({ width: 834, height: 1194 });
    await openOverlays(page);
    await press(page.getByTestId("ui-toast-info"), ti);
    const front = page.locator(FRONT_TOAST);
    await expect(front).toBeVisible();
    await expect
      .poll(async () => {
        const b = await front.boundingBox();
        return b
          ? { centre: Math.abs(b.x + b.width / 2 - 834 / 2) <= 2, width: Math.abs(b.width - 440) <= 1, bottomHalf: b.y > 1194 / 2, bottom: b.y + b.height <= 1194 - 16 + 1 }
          : null;
      })
      .toEqual({ centre: true, width: true, bottomHalf: true, bottom: true });
  });

  test("legacy sonner toasts get the v3 box", async ({ page }, ti) => {
    await openOverlays(page);
    await press(page.getByTestId("ui-toast-legacy"), ti);
    const legacy = page.locator("[data-sonner-toast]", { hasText: "Legacy toast styled" });
    await expect(legacy).toBeVisible();
    await expect(legacy).toHaveCSS("border-radius", "0px");
    await expect(legacy).toHaveCSS("background-color", await resolveBg(page, "var(--cb-surface)"));
    await expect(legacy).toHaveCSS("font-family", /Geist/);
  });

  test("dark toast background is the dark cb-surface", async ({ page }, ti) => {
    await openOverlays(page);
    await setTheme(page, "dark");
    const surface = await resolveBg(page, "var(--cb-surface)");
    expect(surface).not.toBe("rgb(255, 255, 255)");
    await press(page.getByTestId("ui-toast-success"), ti);
    const toast = page.getByTestId("toast-success").first();
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS("background-color", surface);
    await setTheme(page, "light");
  });
});

test("gallery overlays tap targets reach 44px", async ({ page }) => {
  await openOverlays(page);
  await expectTapTargets(page, { root: '[data-testid="gallery-overlays"]', all44: true });
});
