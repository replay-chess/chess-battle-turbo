// Shared helpers of the P3 demo specs (/dev/ui/review, /complete, /share, /game-over, /games, /compare, /practice;
// phase-03 plan §4.10, §12.3). The demo routes need no server data and no sign-in; they run under the P1 console guard
// and telemetry fixtures like every spec. Each file runs at desktop-1440@100; phone-only behaviour sits in an
// `iphone@100` describe (DEVICES from ../_lib/devices).
import { expect, type Page } from "@playwright/test";
export { boardInView, blur, clickUntil, noDocumentScroll, retryUntil, visible } from "../_lib/review";
export { DEVICES, expect, test } from "../_lib/review";

export async function openDemo(page: Page, path: string, ready: string) {
  // Third-party dev widgets are not part of the app.
  await page.context().route(/unpkg\.com\/react-(scan|grab)\/|\/pingchat-widget\.js/, (r) => r.abort());
  // next dev's floating dev-tools button sits over the bottom-left of the control bar; production has none.
  await page.addInitScript(() => {
    const css = "nextjs-portal{display:none!important}";
    // A constructed sheet: a <style> appended on DOMContentLoaded can race React's hydration of <head> (#418).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  // One retry: a `next dev` that compiles another route meanwhile can abort the first navigation (ERR_ABORTED).
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(path, { timeout: 240_000 });
      break;
    } catch (error) {
      if (attempt > 0 || !/ERR_ABORTED|frame was detached|interrupted/i.test(String(error))) throw error;
    }
  }
  await expect(page.getByTestId(ready)).toBeVisible({ timeout: 120_000 });
}

/** A phone-sized viewport (the action bar replaces the side footer). */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 600;
}
