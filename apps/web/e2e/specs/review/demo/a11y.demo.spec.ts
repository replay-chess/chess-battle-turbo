// axe (wcag2a/aa, wcag21a/aa) on Compare, Practice and the public share page's error states (plan §12.3 "a11y: zero
// serious or critical violations"; this draft asserts zero of any impact). The live /r page needs SHARE_CODE.
import AxeBuilder from "@axe-core/playwright";
import { DEVICES, expect, openDemo, test } from "./_demo";

test.use(DEVICES["desktop-1440"]);

test.describe("a11y demo", { tag: ["@p3"] }, () => {
  const PAGES: [string, string][] = [
    ["/dev/ui/compare?state=default", "compare-screen"],
    ["/dev/ui/compare?state=default&tab=your_moves", "compare-screen"],
    ["/dev/ui/compare?state=default&tab=legend_moves", "compare-screen"],
    ["/dev/ui/compare?state=default&tab=practice", "compare-screen"],
    ["/dev/ui/compare?state=pending_evals", "compare-screen"],
    ["/dev/ui/compare?state=error", "compare-screen"],
    ["/dev/ui/compare?state=audio_failed", "compare-screen"],
    ["/dev/ui/practice?state=engine_loading", "practice-screen"],
    ["/dev/ui/practice?state=engine_failed", "practice-screen"],
    ["/dev/ui/practice?state=offline", "practice-screen"],
    ["/r/zzzzzzzz", "share-not-found"],
  ];
  if (process.env.SHARE_CODE) PAGES.push([`/r/${process.env.SHARE_CODE}`, "share-page"]);

  test.describe("a11y", () => {
    for (const [path, ready] of PAGES) {
      test(`axe: ${path}`, async ({ page }) => {
        await openDemo(page, path, ready);
        await page.waitForTimeout(600);
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
        expect(r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });
});
