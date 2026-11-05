// 1A·P7 state completion (plan §4.5, §4.6, §12): every V3PaymentFailed and V3Skeletons state is reachable
// on a demo route. UI projects (ui-desktop, ui-iphone, ui-android, ui-ipad). Signed out.
import type { Page } from "@playwright/test";
import { expectNoAxeViolations } from "../a11y";
import { expectOneViewport } from "../layout/assertions";
import { shellModeFor } from "../layout/fixtures";
import { expect, expectTapTargets, test, waitForStable } from "../helpers";

async function open(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBe(200);
  await waitForStable(page);
}

const banner = (page: Page) => page.getByTestId("shell-payment-banner");

test.describe("V3PaymentFailed @p1", () => {
  test("banner: Update Payment and a dismiss button @demo:V3PaymentFailed.banner", async ({ page }) => {
    await open(page, "/dev/ui/shell?user=payment");
    await expect(banner(page)).toContainText("You keep access until Nov 12.");
    await expect(banner(page).getByRole("button", { name: "Update Payment" })).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Dismiss for this session" })).toBeVisible();
    await expectTapTargets(page);
  });

  test("last_day: Update Payment, no dismiss @demo:V3PaymentFailed.last_day", async ({ page }) => {
    await open(page, "/dev/ui/shell?user=payment_last_day");
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText("Access ends Nov 12 unless the card is updated.");
    await expect(banner(page).getByRole("button", { name: "Update Payment" })).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Dismiss for this session" })).toHaveCount(0);
    await expect(banner(page)).toHaveAttribute("role", "status");
    await expectTapTargets(page);
  });

  test("last_day ignores an earlier dismissal in the same session", async ({ page }) => {
    await open(page, "/dev/ui/shell?user=payment");
    await banner(page).getByRole("button", { name: "Dismiss for this session" }).click();
    await expect(banner(page)).toHaveCount(0);
    await open(page, "/dev/ui/shell?user=payment_last_day");
    await expect(banner(page)).toBeVisible();
  });

  test("expired: Renew Membership links to /pricing?reason=ended @demo:V3PaymentFailed.expired", async ({ page }) => {
    await open(page, "/dev/ui/shell?user=payment_expired");
    await expect(banner(page)).toContainText("Your membership ended on Nov 12 after the payment failed.");
    await expect(banner(page)).toContainText("Your saved games stay.");
    const renew = banner(page).getByRole("link", { name: "Renew Membership" });
    await expect(renew).toHaveAttribute("href", "/pricing?reason=ended");
    await expect(banner(page).getByRole("button", { name: "Update Payment" })).toHaveCount(0);
    await expect(banner(page).getByRole("button", { name: "Dismiss for this session" })).toHaveCount(0);
    await expectTapTargets(page);
  });

  test("dismissed: toast with Undo; Undo restores the banner @demo:V3PaymentFailed.dismissed", async ({ page }) => {
    await open(page, "/dev/ui/shell?user=payment");
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole("button", { name: "Dismiss for this session" }).click();
    await expect(banner(page)).toHaveCount(0);

    const toast = page.getByTestId("toast-undo");
    await expect(toast).toContainText("Hidden for this session. Membership shows the payment issue.");
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText("Nov 12");

    // Restored for the session too: a reload keeps it.
    await page.reload();
    await waitForStable(page);
    await expect(banner(page)).toBeVisible();
  });
});

const VARIANTS = ["game", "review", "profile", "list"] as const;

test.describe("V3Skeletons @p1", () => {
  for (const variant of VARIANTS) {
    test(`${variant}: one aria-busy region with a hidden Loading label @demo:V3Skeletons.${variant}`, async ({ page }) => {
      await open(page, `/dev/ui/skeletons?variant=${variant}`);
      const region = page.locator('[aria-busy="true"]');
      await expect(region).toHaveCount(1);
      await expect(region.locator(".sr-only").first()).toHaveText(/^Loading .+…$/);
      await expect(region.locator('[aria-hidden="true"]').first()).toBeAttached();
      await expect(page.getByTestId("skeleton-hairline")).toBeAttached();
      if (variant === "review") {
        await expect(page.getByTestId("route-skeleton-progress")).toHaveText("Analysing · 14 of 38 moves");
      }
      // Flow pages never scroll sideways.
      const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(1);
    });
  }

  test("game: real board from the FEN and one viewport", async ({ page }) => {
    await open(page, "/dev/ui/skeletons?variant=game");
    await expect(page.locator('[aria-busy="true"] [data-testid="chess-board"]')).toBeVisible();
    const tabbar = (await shellModeFor(page)) === "tabbar";
    await expectOneViewport(page, { board: true, nav: !tabbar });
    if (tabbar) await expect(page.locator("[data-rc-controls]")).toBeVisible();
  });
});

// axe on every new state, both themes. Titles follow ui/a11y.spec.ts (`a11y <id> <theme>`).
const AXE: { id: string; path: string }[] = [
  { id: "payment-last-day", path: "/dev/ui/shell?user=payment_last_day" },
  { id: "payment-expired", path: "/dev/ui/shell?user=payment_expired" },
  ...VARIANTS.map((v) => ({ id: `skeletons-${v}`, path: `/dev/ui/skeletons?variant=${v}` })),
];

for (const { id, path } of AXE) {
  for (const theme of ["light", "dark"] as const) {
    test(`a11y ${id} ${theme} @p1`, async ({ page }) => {
      await open(page, path);
      await expectNoAxeViolations(page, { theme });
    });
  }
}
