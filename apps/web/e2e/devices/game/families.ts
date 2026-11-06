// Device families of the P2 game boards (phase-02 plan 12.7) and the tags the device suites give them.
import type { TestInfo } from "@playwright/test";
import { DEVICE_BOARDS, type DeviceFamily } from "../../specs/game/tags";

export { DEVICE_BOARDS, type DeviceFamily };

/** `desktop-1440@125` → "desktop"; `iphone-safari@100` → "iphone"; `android-chrome@80` → "android". */
export function familyOf(testInfo: TestInfo): DeviceFamily | null {
  const device = String(testInfo.project.metadata?.device ?? testInfo.project.name.split("@")[0]);
  if (device.startsWith("desktop")) return "desktop";
  if (device === "ipad-landscape") return "ipad-landscape";
  if (device === "ipad-portrait") return "ipad-portrait";
  if (device.startsWith("iphone")) return "iphone";
  if (device.startsWith("android")) return "android";
  return null;
}

export const FAMILIES = Object.keys(DEVICE_BOARDS) as DeviceFamily[];

export function demoTags(family: DeviceFamily, state: string): string[] {
  return DEVICE_BOARDS[family].map((b) => `@demo:${b}.${state}`);
}
