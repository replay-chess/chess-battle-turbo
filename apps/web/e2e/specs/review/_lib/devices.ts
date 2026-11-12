// Device contexts of the P3 specs (phase-03 plan §12.3 "Projects" column). The main config runs one chromium project
// (plus webkit-iphone for @smoke in CI), so a spec names the plan's device with `test.use(DEVICES[...])` per describe:
// the same viewport, scale, touch and user agent as P1's device × zoom matrix (e2e/devices/matrix.ts) at 100 %. The
// browser engine stays the project's (Playwright cannot switch it inside a worker).
import type { BrowserContextOptions } from "@playwright/test";
import { BASE_DEVICES } from "../../../devices/matrix";

export type DeviceName = "desktop-1440" | "iphone" | "android" | "ipad-portrait" | "ipad-landscape";

function contextOf(id: DeviceName): BrowserContextOptions {
  const d = BASE_DEVICES.find((b) => b.id === id);
  if (!d) throw new Error(`unknown device ${id}`);
  return {
    viewport: d.viewport,
    screen: d.screen,
    deviceScaleFactor: d.dpr,
    isMobile: d.mobile,
    hasTouch: d.mobile,
    ...(d.userAgent ? { userAgent: d.userAgent } : {}),
  };
}

export const DEVICES: Record<DeviceName, BrowserContextOptions> = {
  "desktop-1440": contextOf("desktop-1440"),
  iphone: contextOf("iphone"),
  android: contextOf("android"),
  "ipad-portrait": contextOf("ipad-portrait"),
  "ipad-landscape": contextOf("ipad-landscape"),
};

/** True on a phone-sized viewport (the action bar replaces the side footer). */
export function isPhoneViewport(width: number | undefined): boolean {
  return (width ?? 1440) < 600;
}
