// P1 controls kit (SPEC 6.4) on the 4 UI projects, against /dev/ui/sections/controls.
// Keyboard steps run on Chromium only (F M6).
import type { Locator, Page } from "@playwright/test";
import { setTheme } from "../a11y";
import { expect, expectTapTargets, gotoSection, isChromium, isCoarse, test } from "../helpers";

/** The computed colour of a CSS custom property, resolved the same way a border or background would be. */
async function tokenColor(page: Page, token: string, prop: "color" | "backgroundColor" = "color") {
  return page.evaluate(
    ({ token, prop }) => {
      const probe = document.createElement("span");
      probe.style[prop] = `var(${token})`;
      document.body.append(probe);
      const value = getComputedStyle(probe)[prop];
      probe.remove();
      return value;
    },
    { token, prop },
  );
}

const spec = (page: Page, id: string): Locator => page.getByTestId(id);

test.beforeEach(async ({ page }) => {
  await gotoSection(page, "controls");
});

test("ChipGroup: click selects, arrows rove, the selected chip stays on", async ({ page }, testInfo) => {
  const group = spec(page, "ui-chip-group");
  const chip = group.getByRole("radio", { name: "10+0" }).or(group.getByRole("button", { name: "10+0" }));
  await chip.click();
  await expect(chip).toHaveAttribute("data-state", "on");
  await chip.click();
  await expect(chip, "single choice never deselects").toHaveAttribute("data-state", "on");
  await expect(group.locator('[data-state="on"]')).toHaveCount(1);

  if (isChromium(testInfo)) {
    await chip.focus();
    await page.keyboard.press("ArrowRight");
    const next = group.getByText("15+10", { exact: true });
    await expect(next).toBeFocused();
  }
});

test("Chip: a standalone chip toggles aria-pressed", async ({ page }) => {
  const chip = spec(page, "ui-chip").getByRole("button", { name: "Legends Only" });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip).toHaveCSS("border-radius", "0px");
});

test("RemovableChip: named for its filter, and removing hides it", async ({ page }) => {
  const remove = spec(page, "ui-chip-removable").getByRole("button", { name: "Remove filter: Blunders" });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
});

test("Segmented: radio items; ArrowRight moves the selection", async ({ page }, testInfo) => {
  const group = spec(page, "ui-segmented").getByRole("radiogroup", { name: "Colour" });
  const radios = group.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(group.getByRole("tab")).toHaveCount(0);
  const random = group.getByRole("radio", { name: "Random" });
  const black = group.getByRole("radio", { name: "Black" });
  await expect(random).toHaveAttribute("aria-checked", "true");

  if (isChromium(testInfo)) {
    await random.focus();
    // Radix selects on arrow-key focus only while the key is down; its roving focus moves in a
    // timeout, so a zero-length press releases the key first. Hold it like a person does.
    await page.keyboard.press("ArrowRight", { delay: 50 });
    await expect(black).toHaveAttribute("aria-checked", "true");
    await expect(random).toHaveAttribute("aria-checked", "false");
  } else {
    await black.click();
    await expect(black).toHaveAttribute("aria-checked", "true");
  }
});

test("Tabs: tablist, tab and tabpanel; ArrowRight activates the next tab", async ({ page }, testInfo) => {
  const root = spec(page, "ui-tabs-underline");
  const list = root.getByRole("tablist", { name: "Game panel" });
  await expect(list).toBeVisible();
  const coach = list.getByRole("tab", { name: "Coach" });
  const moves = list.getByRole("tab", { name: "Moves" });
  await expect(coach).toHaveAttribute("aria-selected", "true");
  await expect(root.getByRole("tabpanel")).toContainText("Coach panel");

  if (isChromium(testInfo)) {
    await coach.focus();
    await page.keyboard.press("ArrowRight");
  } else {
    await moves.click();
  }
  await expect(moves).toHaveAttribute("aria-selected", "true");
  await expect(coach).toHaveAttribute("aria-selected", "false");
  await expect(root.getByRole("tabpanel")).toContainText("Moves panel");
});

test("Tabs: the bold active label doesn't change the trigger width", async ({ page }) => {
  const list = spec(page, "ui-tabs-overflow").getByRole("tablist");
  const games = list.getByRole("tab", { name: "Games" });
  const before = (await games.boundingBox())?.width ?? 0;
  await games.click();
  await expect(games).toHaveAttribute("aria-selected", "true");
  const after = (await games.boundingBox())?.width ?? 0;
  expect(Math.abs(after - before)).toBeLessThan(0.5);
});

test("Tabs overflow: the last tab, once clicked, sits inside the list box", async ({ page }) => {
  const list = spec(page, "ui-tabs-overflow").getByRole("tablist");
  const last = list.getByRole("tab", { name: "Openings" });
  await last.click();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => {
      const [l, t] = await Promise.all([list.boundingBox(), last.boundingBox()]);
      if (!l || !t) return false;
      return t.x >= l.x - 0.5 && t.x + t.width <= l.x + l.width + 0.5;
    })
    .toBe(true);
});

test("Field error: aria-invalid, described by hint then error, bad border", async ({ page }) => {
  const input = spec(page, "ui-field-error").getByRole("textbox", { name: "Username" });
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-required", "true");
  const ids = ((await input.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  expect(ids).toHaveLength(2);
  await expect(page.locator(`[id="${ids[0]}"]`)).toContainText("letters, numbers or underscores");
  await expect(page.locator(`[id="${ids[1]}"]`)).toContainText("Username is taken.");
  const bad = await tokenColor(page, "--cb-bad");
  await expect(input).toHaveCSS("border-top-color", bad);
});

test("Field: no aria-invalid without an error", async ({ page }) => {
  const input = spec(page, "ui-field-hint").getByRole("textbox", { name: "Email" });
  await expect(input).not.toHaveAttribute("aria-invalid", /.*/);
  const ids = ((await input.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  expect(ids).toHaveLength(1);
});

test("Input text is 16px on coarse pointers, 15px otherwise", async ({ page }) => {
  const input = spec(page, "ui-field-default").getByRole("textbox", { name: "Display Name" });
  const coarse = await isCoarse(page);
  await expect(input).toHaveCSS("font-size", coarse ? "16px" : "15px");
});

test("Select: no native appearance, square", async ({ page }) => {
  const select = spec(page, "ui-select").getByRole("combobox", { name: "Piece Set" });
  await expect(select).toHaveCSS("appearance", "none");
  await expect(select).toHaveCSS("border-radius", "0px");
});

test("Switch: role switch toggles; clicking the row label toggles it", async ({ page }) => {
  const sound = spec(page, "ui-switch").getByRole("switch", { name: "Sound" });
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");

  const row = spec(page, "ui-switch-row");
  const sw = row.getByRole("switch", { name: "Single-Key Shortcuts" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await row.getByText("Single-Key Shortcuts", { exact: true }).click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await row.getByText("Press / to search", { exact: false }).click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
});

test("Checkbox: Space toggles, indeterminate reports mixed, square", async ({ page }, testInfo) => {
  const box = spec(page, "ui-checkbox").getByRole("checkbox", { name: "Select this game" });
  await expect(box).toHaveAttribute("aria-checked", "false");
  await expect(box).toHaveCSS("border-radius", "0px");
  if (isChromium(testInfo)) {
    await box.focus();
    await page.keyboard.press("Space");
  } else {
    await box.click();
  }
  await expect(box).toHaveAttribute("aria-checked", "true");

  const all = page.getByTestId("ui-checkbox-all");
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");
  await expect(spec(page, "ui-checkbox-row").getByRole("checkbox", { name: "Mistakes" })).toHaveAttribute("aria-checked", "true");
});

test("RadioCard: arrow keys move the selection", async ({ page }, testInfo) => {
  const group = spec(page, "ui-radio-card").getByRole("radiogroup", { name: "Start from" });
  const standard = group.getByRole("radio", { name: /Standard Start/ });
  const legend = group.getByRole("radio", { name: /Legend Position/ });
  await expect(standard).toHaveAttribute("aria-checked", "true");
  if (isChromium(testInfo)) {
    await standard.focus();
    await page.keyboard.press("ArrowDown", { delay: 50 });
  } else {
    await legend.click();
  }
  await expect(legend).toHaveAttribute("aria-checked", "true");
  await expect(standard).toHaveAttribute("aria-checked", "false");
});

test("Radio swatch: picking a theme checks it", async ({ page }) => {
  const group = spec(page, "ui-radio-swatch").getByRole("radiogroup", { name: "Board theme" });
  const paper = group.getByRole("radio", { name: "Paper" });
  await paper.click();
  await expect(paper).toHaveAttribute("aria-checked", "true");
});

test("Disclosure: Enter on the summary toggles open", async ({ page }, testInfo) => {
  const details = spec(page, "ui-disclosure").locator("details");
  const summary = details.locator("summary");
  await expect(details).not.toHaveAttribute("open", /.*/);
  if (isChromium(testInfo)) {
    await summary.focus();
    await page.keyboard.press("Enter");
  } else {
    await summary.click();
  }
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("seven days with every feature");
});

test("Banner: role status, named dismiss, dismissing removes it", async ({ page }) => {
  const root = spec(page, "ui-banner-dismiss");
  const banner = root.getByRole("status");
  await expect(banner).toContainText("review your games with the coach");
  await expect(root.locator('[role="banner"]')).toHaveCount(0);
  const dismiss = root.getByRole("button", { name: "Dismiss for this session" });
  await dismiss.click();
  await expect(root.getByText("review your games with the coach")).toHaveCount(0);
});

test("ProgressBar: named, with a readable value", async ({ page }) => {
  const bar = spec(page, "ui-progress").getByRole("progressbar", { name: "Import progress" });
  await expect(bar).toHaveAttribute("aria-valuetext", "212 of 480 games");
  await expect(bar).toHaveAttribute("aria-valuemax", "480");
});

test("Avatar: a broken image falls back to initials", async ({ page }) => {
  const root = spec(page, "ui-avatar-image-fallback");
  // next/image loads lazily: bring it on screen so the browser requests (and fails) it.
  await root.scrollIntoViewIfNeeded();
  const avatar = root.getByRole("img", { name: "Mikhail Tal" });
  await expect(avatar).toContainText("MT");
  await expect(avatar.locator("img")).toHaveCount(0);
});

test("every interactive specimen has a 44px hit box", async ({ page }) => {
  await expectTapTargets(page, { root: '[data-testid="gallery-controls"]', all44: true });
});

test("dark theme: the good banner uses the dark good tint", async ({ page }) => {
  await setTheme(page, "dark");
  const banner = spec(page, "ui-banner-good").getByRole("status");
  await expect(banner).toHaveCSS("background-color", "rgb(26, 30, 23)");
});

test("no rounded corners outside the allowed round parts", async ({ page }) => {
  const offenders = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="gallery-controls"]');
    if (!root) return ["no root"];
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
      if (getComputedStyle(el).borderTopLeftRadius === "0px") continue;
      // Allowed: avatars, switch tracks/thumbs, radio rings and dots, spinners, count badges.
      if (el.closest('[data-variant="neutral"], [data-variant="ink"], [data-variant="gradient"], [role="switch"], [role="radio"], [data-shape="circle"]')) continue;
      if (el.className && typeof el.className === "string" && el.className.includes("rounded-full")) continue;
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    }
    return out;
  });
  expect(offenders).toEqual([]);
});
