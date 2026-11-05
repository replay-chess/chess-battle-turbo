// Records what each emulated project really reports (SPEC 5.2, gate B). It
// asserts only that the page loads; the attachment feeds SP/phase1/probe.json.
import { expect, test, waitForStable } from "../helpers";

test("probe @p1", async ({ page }, testInfo) => {
  const res = await page.goto("/dev/ui");
  expect(res?.status()).toBe(200);
  await waitForStable(page);
  const probe = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:0;left:0;height:100dvh;width:1px;visibility:hidden";
    document.body.append(el);
    const dvh = el.getBoundingClientRect().height;
    el.remove();
    return {
      innerWidth,
      innerHeight,
      dpr: devicePixelRatio,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      hoverNone: matchMedia("(hover: none)").matches,
      portrait: matchMedia("(orientation: portrait)").matches,
      dvh,
    };
  });
  await testInfo.attach("probe", {
    body: JSON.stringify({ project: testInfo.project.name, ...probe }),
    contentType: "application/json",
  });
});
