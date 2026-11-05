import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedShellMode } from "./modes";

const CASES: [number, number, boolean, ReturnType<typeof expectedShellMode>][] = [
  [853, 533, false, "rail"], // desktop-1280@150
  [1152, 720, false, "sidebar"], // desktop-1440@125
  [1194, 834, true, "rail"], // ipad-landscape@100, coarse pointer
  [556, 796, true, "tabbar"], // ipad-portrait@150
  [852, 393, true, "rail"], // phone landscape
  [1440, 900, false, "sidebar"],
  [1101, 700, false, "sidebar"],
  [1100, 700, false, "rail"],
  [600, 400, false, "tabbar"], // <= 600 wide, any orientation
  [834, 1194, true, "tabbar"], // iPad portrait
  [901, 1200, false, "rail"], // portrait but wider than 900
];

for (const [vw, vh, touch, mode] of CASES) {
  test(`expectedShellMode(${vw}, ${vh}, ${touch}) is ${mode}`, () => {
    assert.equal(expectedShellMode(vw, vh, touch), mode);
  });
}
