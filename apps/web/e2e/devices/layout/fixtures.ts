// Layout-suite fixtures (SPEC 10.6, 04 §8.4). The inset emulation lives in
// ../helpers (`test` overrides --safe-* from project.metadata.insets); this file
// re-exports it with the page helpers every layout spec uses.
import type { Page, TestInfo } from "@playwright/test";
import { expect, isTouchShell, test, waitForStable } from "../helpers";
import { expectedShellMode, type ShellMode } from "./modes";

export { expect, test, waitForStable };

/** Clerk's Frontend API (the development instance's handshake host), not this app. */
const CLERK_FAPI = /(^|\.)clerk\.accounts\.dev$|^clerk\./;

/**
 * goto + 200 check + waitForStable. A fresh context's first document goes through the Clerk development instance's
 * handshake (no dev-browser cookie yet: a redirect to *.clerk.accounts.dev and back). A 5xx answered by Clerk's host,
 * not this app, is Clerk's and is retried once (CI 43430795552 devices-game: one 502 in 216 loads); the app's own 5xx
 * still fails at once, and the message names the host that answered.
 */
export async function gotoStable(page: Page, path: string) {
  let res = await page.goto(path);
  if (res && res.status() >= 500 && CLERK_FAPI.test(new URL(res.url()).hostname)) res = await page.goto(path);
  expect(res?.status(), `${path} status (answered by ${res ? new URL(res.url()).host : "nothing"})`).toBe(200);
  await waitForStable(page);
}

/** The shell mode this page should render, from its CSS viewport and pointer. */
export async function shellModeFor(page: Page): Promise<ShellMode> {
  const { vw, vh } = await page.evaluate(() => ({ vw: innerWidth, vh: innerHeight }));
  return expectedShellMode(vw, vh, await isTouchShell(page));
}

export const projectName = (testInfo: TestInfo) => testInfo.project.name;
export const hasInsets = (testInfo: TestInfo) => Boolean(testInfo.project.metadata?.insets);
