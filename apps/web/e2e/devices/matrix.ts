// Device x zoom matrix (SPEC D7, 04 §8.2-8.3).
import { devices } from "@playwright/test";
import { zoomDpr, zoomInsets, zoomViewport, type Insets } from "./zoom";

export type { Insets };

export type BaseDevice = {
  id: string;
  browserName: "chromium" | "webkit";
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  dpr: number;
  mobile: boolean;
  userAgent?: string;
  insets?: Insets;
};

export const BASE_DEVICES: BaseDevice[] = [
  { id: "desktop-1440", browserName: "chromium", viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, dpr: 2, mobile: false },
  { id: "desktop-1280", browserName: "chromium", viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 }, dpr: 2, mobile: false },
  {
    id: "ipad-landscape", browserName: "webkit", viewport: { width: 1194, height: 834 }, screen: { width: 1194, height: 834 }, dpr: 2, mobile: true,
    userAgent: devices["iPad Pro 11 landscape"]!.userAgent, insets: { top: 24, right: 0, bottom: 0, left: 0 },
  },
  {
    id: "ipad-portrait", browserName: "webkit", viewport: { width: 834, height: 1194 }, screen: { width: 834, height: 1194 }, dpr: 2, mobile: true,
    userAgent: devices["iPad Pro 11"]!.userAgent, insets: { top: 24, right: 0, bottom: 20, left: 0 },
  },
  {
    id: "iphone", browserName: "webkit", viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, dpr: 3, mobile: true,
    userAgent: devices["iPhone 15"]!.userAgent, insets: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  {
    id: "iphone-safari", browserName: "webkit", viewport: { width: 393, height: 659 }, screen: { width: 393, height: 852 }, dpr: 3, mobile: true,
    userAgent: devices["iPhone 15"]!.userAgent,
  },
  {
    id: "android", browserName: "chromium", viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, dpr: 2.625, mobile: true,
    userAgent: devices["Pixel 7"]!.userAgent, insets: { top: 36, right: 0, bottom: 24, left: 0 },
  },
  {
    id: "android-chrome", browserName: "chromium", viewport: { width: 412, height: 839 }, screen: { width: 412, height: 915 }, dpr: 2.625, mobile: true,
    userAgent: devices["Pixel 7"]!.userAgent,
  },
];

export const ZOOMS = (process.env.LAYOUT_ZOOMS ?? "0.8,1,1.1,1.25,1.5")
  .split(",")
  .map((z) => Number(z.trim()))
  .filter((z) => Number.isFinite(z) && z > 0);

export function baseDevice(id: string): BaseDevice {
  const d = BASE_DEVICES.find((b) => b.id === id);
  if (!d) throw new Error(`Unknown base device ${id}`);
  return d;
}

/** Playwright `use` and `metadata` for one device at one zoom. */
export function zoomed(d: BaseDevice, zoom: number) {
  return {
    use: {
      browserName: d.browserName,
      viewport: zoomViewport(d.viewport, zoom),
      screen: zoomViewport(d.screen, zoom),
      deviceScaleFactor: zoomDpr(d.dpr, zoom),
      isMobile: d.mobile,
      hasTouch: d.mobile,
      userAgent: d.userAgent,
    },
    metadata: {
      device: d.id,
      zoom,
      insets: d.insets ? zoomInsets(d.insets, zoom) : undefined,
    },
  };
}

export const projectName = (d: BaseDevice, zoom: number) => `${d.id}@${Math.round(zoom * 100)}`;

/** UI projects run at zoom 1. */
export const UI_PROJECTS: { name: string; device: string }[] = [
  { name: "ui-desktop", device: "desktop-1440" },
  { name: "ui-iphone", device: "iphone" },
  { name: "ui-android", device: "android" },
  { name: "ui-ipad", device: "ipad-landscape" },
];

/** Motion projects: reducedMotion "no-preference". */
export const MOTION_PROJECTS: { name: string; device: string }[] = [
  { name: "ui-desktop-motion", device: "desktop-1440" },
  { name: "ui-iphone-motion", device: "iphone" },
];
