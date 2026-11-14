// pendingViewerReads (auth.ts): a sign-in settles only when the page made no viewer read for VIEWER_QUIET_MS and, on a
// production build, its service-worker registration exists. regression: webkit-signin-late-reads (REGRESSION-5: the
// webkit-iphone @smoke run failed connected.spec on "…/api/me due to access control checks." and friend-full on
// "…/sw.js due to access control checks.", both on the `/` a sign-in had just left).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { Request } from "@playwright/test";
import { pendingViewerReads, registersServiceWorker, VIEWER_QUIET_MS, type ViewerReadsPage } from "./auth";

/** A page that emits request events on cue and answers `getRegistration()` from a flag. */
function fakePage(opts: { registeredAfterMs?: number } = {}) {
  const ee = new EventEmitter();
  const started = Date.now();
  const page = {
    on: (event: string, fn: (...args: unknown[]) => void) => (ee.on(event, fn), page),
    off: (event: string, fn: (...args: unknown[]) => void) => (ee.off(event, fn), page),
    waitForTimeout: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    evaluate: async () => opts.registeredAfterMs !== undefined && Date.now() - started >= opts.registeredAfterMs,
  } as unknown as ViewerReadsPage;
  const req = (path: string) => ({ url: () => `http://localhost:3800${path}` }) as unknown as Request;
  return { page, ee, req, listeners: () => ee.eventNames().length };
}

describe("pendingViewerReads", () => {
  it("waits for a viewer read that starts after settled() was called (UserSync once Clerk reports the session)", async () => {
    const { page, ee, req, listeners } = fakePage();
    const reads = pendingViewerReads(page, { swRegistration: false });
    const me = req("/api/me");
    setTimeout(() => ee.emit("request", me), 200);
    setTimeout(() => ee.emit("requestfinished", me), 500);
    const t0 = Date.now();
    await reads.settled();
    const took = Date.now() - t0;
    assert.ok(took >= 500 + VIEWER_QUIET_MS - 60, `settled after the late read finished and the page went quiet (${took} ms)`);
    assert.equal(listeners(), 0, "stops tracking");
  });

  it("other requests do not hold it; a quiet page settles after the quiet window", async () => {
    const { page, ee, req } = fakePage();
    const reads = pendingViewerReads(page, { swRegistration: false });
    ee.emit("request", req("/api/train/today"));
    const t0 = Date.now();
    await reads.settled();
    const took = Date.now() - t0;
    assert.ok(took >= VIEWER_QUIET_MS - 60 && took < VIEWER_QUIET_MS + 500, `${took} ms`);
  });

  it("a production build waits for the page's service-worker registration, bounded", async () => {
    const { page } = fakePage({ registeredAfterMs: VIEWER_QUIET_MS + 400 });
    const t0 = Date.now();
    await pendingViewerReads(page, { swRegistration: true }).settled();
    assert.ok(Date.now() - t0 >= VIEWER_QUIET_MS + 400 - 60);
    const never = fakePage();
    const t1 = Date.now();
    await pendingViewerReads(never.page, { swRegistration: true }).settled(VIEWER_QUIET_MS + 600);
    assert.ok(Date.now() - t1 < VIEWER_QUIET_MS + 1_200, "never past the caller's budget");
  });

  it("registersServiceWorker: CI, E2E_WEB_BUILD=1 and a deployed site; not `next dev`", () => {
    assert.equal(registersServiceWorker({ CI: "1" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(registersServiceWorker({ E2E_WEB_BUILD: "1" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(registersServiceWorker({ E2E_BASE_URL: "https://x.vercel.app" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(registersServiceWorker({} as unknown as NodeJS.ProcessEnv), false);
  });
});
