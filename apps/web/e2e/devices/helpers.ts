// Shared helpers for the device suites (SPEC 5.2). App code is imported with
// relative paths so the Playwright TS loader never depends on tsconfig paths.
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { COARSE_MQ, COARSE_POINTER_MQ } from "../../lib/layout/media-queries";
import type { Insets } from "./zoom";

/**
 * `test` with emulated safe-area insets: env(safe-area-inset-*) is always 0 under
 * emulation, so the fixture overrides the --safe-* variables viewport.css reads.
 */
export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const insets = testInfo.project.metadata?.insets as Insets | undefined;
    if (insets) {
      await page.addInitScript((i: Insets) => {
        const css = `:root{--safe-top:${i.top}px;--safe-right:${i.right}px;--safe-bottom:${i.bottom}px;--safe-left:${i.left}px}`;
        const add = () => {
          const s = document.createElement("style");
          s.textContent = css;
          document.head.append(s);
        };
        if (document.head) add();
        else document.addEventListener("DOMContentLoaded", add, { once: true });
      }, insets);
    }
    await provide(page);
  },
});
export { expect };

/** load → fonts ready → two animation frames → network idle (bounded). */
export async function waitForStable(page: Page) {
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  // WebKit re-resolves container-query sizes (the BoardStage board) and ResizeObserver-driven overlays a few
  // frames after a layout change such as a late font or a taller banner (~200 ms measured). Wait until main's
  // scroll height and the board/stage boxes hold for 5 frames (at most 2 s).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const key = () => {
          const main = document.querySelector("[data-rc-main]");
          const parts = [main ? `${main.scrollHeight}/${main.clientHeight}` : "-"];
          for (const sel of ['[data-testid="chess-board"]', ".rc-stage"]) {
            const r = document.querySelector(sel)?.getBoundingClientRect();
            parts.push(r ? `${r.x},${r.y},${r.width},${r.height}` : "-");
          }
          return parts.join("|");
        };
        const deadline = performance.now() + 2000;
        let last = key();
        let same = 0;
        const tick = () => {
          const now = key();
          same = now === last ? same + 1 : 0;
          last = now;
          if (same >= 5 || performance.now() > deadline) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Tap-target logic: matches Tailwind's pointer-coarse:. */
export function isCoarse(page: Page): Promise<boolean> {
  return page.evaluate((q) => matchMedia(q).matches, COARSE_POINTER_MQ);
}

/** Shell-mode logic: touch-first devices. */
export function isTouchShell(page: Page): Promise<boolean> {
  return page.evaluate((q) => matchMedia(q).matches, COARSE_MQ);
}

/** Keyboard-driven tests skip outside Chromium (F M6). */
export function isChromium(testInfo: TestInfo): boolean {
  return testInfo.project.use.browserName === "chromium" || testInfo.project.use.browserName === undefined;
}

export async function gotoSection(page: Page, id: "foundations" | "controls" | "overlays" | "shell" | "layout") {
  const res = await page.goto(`/dev/ui/sections/${id}`);
  expect(res?.status(), `/dev/ui/sections/${id} status`).toBe(200);
  await waitForStable(page);
  return res;
}

/**
 * WCAG 2.5.8 floor (24px) everywhere; 44px for primary chrome, measured as the
 * effective hit box (a tap-target ::after counts). Scoped to `root`. With
 * `all44`, every target under `root` must reach 44 on every project.
 */
export async function expectTapTargets(
  page: Page,
  { root = "body", primaryMin = 44, otherMin = 24, all44 = false }: { root?: string; primaryMin?: number; otherMin?: number; all44?: boolean } = {},
) {
  const bad = await page.evaluate(
    ({ root, primaryMin, otherMin, all44 }) => {
      const SEL =
        'a[href], button, [role="button"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="menuitem"], input:not([type="hidden"]), select, textarea, summary';
      const PRIMARY = "[data-rc-nav], [data-rc-tabbar], [data-rc-topbar], [data-rc-controls], [data-hit='44']";
      const out: string[] = [];
      const scope = document.querySelector(root);
      if (!scope) return [`root ${root} not found`];
      for (const el of scope.querySelectorAll<HTMLElement>(SEL)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
        if (el.closest("[inert], [aria-hidden='true']")) continue;
        const min = all44 || el.closest(PRIMARY) ? primaryMin : otherMin;
        if (r.width >= min - 0.5 && r.height >= min - 0.5) continue;
        // Effective hit box: the drawn box, grown by a ::after hit area if present.
        const after = getComputedStyle(el, "::after");
        let w = r.width;
        let h = r.height;
        if (after.content !== "none" && after.position === "absolute") {
          const top = parseFloat(after.top) || 0;
          const bottom = parseFloat(after.bottom) || 0;
          const left = parseFloat(after.left) || 0;
          const right = parseFloat(after.right) || 0;
          w = Math.max(w, r.width - left - right);
          h = Math.max(h, r.height - top - bottom);
        }
        if (w >= min - 0.5 && h >= min - 0.5) continue;
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(w)}x${Math.round(h)} < ${min}`);
      }
      return out;
    },
    { root, primaryMin, otherMin, all44 },
  );
  expect(bad, "tap targets below the minimum").toEqual([]);
}
