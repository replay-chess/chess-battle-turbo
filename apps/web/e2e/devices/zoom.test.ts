import assert from "node:assert/strict";
import { test } from "node:test";
import { zoomDpr, zoomInsets, zoomViewport } from "./zoom";

test("1440x900 at 125% is 1152x720 at DPR 2.5", () => {
  assert.deepEqual(zoomViewport({ width: 1440, height: 900 }, 1.25), { width: 1152, height: 720 });
  assert.equal(zoomDpr(2, 1.25), 2.5);
});

test("1280x800 at 150% is 853x533 at DPR 3", () => {
  assert.deepEqual(zoomViewport({ width: 1280, height: 800 }, 1.5), { width: 853, height: 533 });
  assert.equal(zoomDpr(2, 1.5), 3);
});

test("insets divide by the zoom", () => {
  assert.deepEqual(zoomInsets({ top: 59, right: 0, bottom: 34, left: 0 }, 1.25), {
    top: 47.2,
    right: 0,
    bottom: 27.2,
    left: 0,
  });
});
