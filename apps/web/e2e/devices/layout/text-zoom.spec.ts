// A 20px root font (Chrome "Large" font, Firefox text zoom) still fits one
// viewport: structure is px, text in fixed rows truncates (SPEC 10.6, 04 §7.2).
import { expectTapTargets, waitForStable } from "../helpers";
import { expectOneViewport } from "./assertions";
import { gotoStable, shellModeFor, test } from "./fixtures";
import { ROUTES, isGameRoute } from "./routes";

const PROJECTS = ["desktop-1440@100", "iphone@100", "ipad-portrait@100"];

for (const route of ROUTES) {
  test(`text zoom 20px ${route.path} @p1`, async ({ page }, testInfo) => {
    test.skip(!PROJECTS.includes(testInfo.project.name), "text zoom runs on three projects only");
    await gotoStable(page, route.path);
    await page.addStyleTag({ content: "html{font-size:20px}" });
    await waitForStable(page);
    const gameInTabbar = isGameRoute(route.path) && (await shellModeFor(page)) === "tabbar";
    await expectOneViewport(page, { board: route.board, nav: !gameInTabbar });
    await expectTapTargets(page);
  });
}
