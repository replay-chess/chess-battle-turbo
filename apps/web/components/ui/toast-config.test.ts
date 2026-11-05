import assert from "node:assert/strict";
import { test } from "node:test";
import { TOAST_TYPES, toasterPlacement } from "./toast-config";

const base = { inShell: false, tabbar: false, tabletPortrait: false, narrow: false };

test("durations, icons and tones per type", () => {
  assert.deepEqual(TOAST_TYPES, {
    success: { duration: 3000, icon: "Check", tone: "good" },
    info: { duration: 3000, icon: "Info", tone: "text" },
    error: { duration: 8000, icon: "TriangleAlert", tone: "bad" },
    warning: { duration: 8000, icon: "WifiOff", tone: "warn" },
    achievement: { duration: 6000, icon: "Trophy", tone: "accent" },
    undo: { duration: 6000, icon: "Undo2", tone: "text" },
  });
});

test("outside the shell the toaster stays top-centre with sonner's default offset", () => {
  for (const tabbar of [false, true]) {
    const p = toasterPlacement({ ...base, tabbar });
    assert.equal(p.position, "top-center");
    assert.equal(p.offset, undefined);
    assert.equal(p.mobileOffset, undefined);
    assert.equal(p.visibleToasts, 3);
    assert.equal(p.width, 380);
  }
  assert.equal(toasterPlacement({ ...base, narrow: true }).width, 320);
});

test("in the shell on desktop: top-right, 3 visible, safe-area offsets", () => {
  const p = toasterPlacement({ ...base, inShell: true });
  assert.equal(p.position, "top-right");
  assert.equal(p.visibleToasts, 3);
  assert.deepEqual(p.offset, { top: "calc(16px + var(--safe-top))", right: "calc(24px + var(--safe-right))" });
  assert.deepEqual(p.mobileOffset, p.offset);
  assert.equal(p.width, 380);
});

test("narrow desktop in the shell is 320 wide", () => {
  assert.equal(toasterPlacement({ ...base, inShell: true, narrow: true }).width, 320);
});

test("in the shell in tab-bar mode: bottom-centre, one visible, offset equals mobileOffset", () => {
  const p = toasterPlacement({ ...base, inShell: true, tabbar: true, narrow: true });
  assert.equal(p.position, "bottom-center");
  assert.equal(p.visibleToasts, 1);
  assert.deepEqual(p.offset, { bottom: "var(--rc-overlay-bottom)", left: 16, right: 16 });
  assert.deepEqual(p.offset, p.mobileOffset);
  assert.equal(p.width, 380);
});

test("tablet portrait in the shell is 440 wide", () => {
  const p = toasterPlacement({ ...base, inShell: true, tabbar: true, tabletPortrait: true, narrow: true });
  assert.equal(p.position, "bottom-center");
  assert.equal(p.width, 440);
});
