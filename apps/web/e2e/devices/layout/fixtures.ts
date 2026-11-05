// Layout-suite fixtures (SPEC 10.6, 04 §8.4). The inset emulation lives in
// ../helpers (`test` overrides --safe-* from project.metadata.insets); this file
// re-exports it with the page helpers every layout spec uses.
import type { Page, TestInfo } from "@playwright/test";
import { expect, isTouchShell, test, waitForStable } from "../helpers";
import { expectedShellMode, type ShellMode } from "./modes";

export { expect, test, waitForStable };

/** goto + 200 check + waitForStable. */
export async function gotoStable(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBe(200);
  await waitForStable(page);
}

/** The shell mode this page should render, from its CSS viewport and pointer. */
export async function shellModeFor(page: Page): Promise<ShellMode> {
  const { vw, vh } = await page.evaluate(() => ({ vw: innerWidth, vh: innerHeight }));
  return expectedShellMode(vw, vh, await isTouchShell(page));
}

export const projectName = (testInfo: TestInfo) => testInfo.project.name;
export const hasInsets = (testInfo: TestInfo) => Boolean(testInfo.project.metadata?.insets);
