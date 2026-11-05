// axe per gallery section and demo route, in both themes (SPEC 5.2).
// Titles are `a11y <id> <theme>` so packages can --grep their own.
import { expectNoAxeViolations } from "../a11y";
import { test, waitForStable } from "../helpers";

const ROUTES: { id: string; path: string }[] = [
  { id: "foundations", path: "/dev/ui/sections/foundations" },
  { id: "controls", path: "/dev/ui/sections/controls" },
  { id: "overlays", path: "/dev/ui/sections/overlays" },
  { id: "shell", path: "/dev/ui/sections/shell" },
  { id: "layout", path: "/dev/ui/sections/layout" },
  { id: "shell-demo", path: "/dev/ui/shell" },
  { id: "stage-demo", path: "/dev/ui/stage" },
];

for (const { id, path } of ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`a11y ${id} ${theme}`, async ({ page }) => {
      const res = await page.goto(path);
      test.skip(res?.status() === 404, `${path} returns 404 (not built yet)`);
      await waitForStable(page);
      await expectNoAxeViolations(page, { theme });
    });
  }
}
