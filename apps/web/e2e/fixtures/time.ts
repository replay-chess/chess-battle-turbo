// Server time control (phase-01 plan §12.0, CT X5).
//
// `page.clock` moves only the browser. Server deadlines (trial days, payment
// windows, later the game clocks) read `ctx.now`, which route() takes from
// `x-rc-now: <epoch ms>` when testHooksEnabled() and `x-e2e-token` equals
// E2E_TEST_TOKEN. This fixture adds both headers to the page's /api requests.
//
//   test("trial ends", async ({ page, serverNow }) => {
//     await serverNow.set("2026-12-01T09:00:00Z");
//     await page.clock.install({ time: new Date("2026-12-01T09:00:00Z") }); // keep the browser in step
//   });
//
// Against a production build the headers are ignored (prod-guard.spec.ts).
import { test as base, type APIRequestContext, type Page } from "@playwright/test";

export const NOW_HEADER = "x-rc-now";
export const TOKEN_HEADER = "x-e2e-token";

/** Header pair for a given instant; throws when E2E_TEST_TOKEN is missing. */
export function serverNowHeaders(at: Date | string | number, token = process.env.E2E_TEST_TOKEN): Record<string, string> {
  if (!token) throw new Error("E2E_TEST_TOKEN is not set; server time control needs it (see .env.test)");
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`serverNow: invalid time ${String(at)}`);
  return { [NOW_HEADER]: String(ms), [TOKEN_HEADER]: token };
}

export type ServerNow = {
  /** From now on, every /api request of this page carries the given server time. */
  set(at: Date | string | number): Promise<void>;
  /** Stop overriding; the server uses its own clock again. */
  clear(): Promise<void>;
  /** Headers for an APIRequestContext call (`request.get(url, { headers })`). */
  headers(at: Date | string | number): Record<string, string>;
  /** The current override in epoch ms, or null. */
  current(): number | null;
};

const API_GLOB = "**/api/**";

export function createServerNow(page: Page): ServerNow {
  let at: number | null = null;
  let routed = false;
  return {
    async set(value) {
      const headers = serverNowHeaders(value);
      at = Number(headers[NOW_HEADER]);
      if (routed) return;
      routed = true;
      await page.route(API_GLOB, async (route) => {
        if (at === null) return route.fallback();
        await route.fallback({ headers: { ...route.request().headers(), ...serverNowHeaders(at) } });
      });
    },
    async clear() {
      at = null;
    },
    headers: (value) => serverNowHeaders(value),
    current: () => at,
  };
}

/** Same as `serverNow.headers()`, for specs that only use `request`. */
export async function getWithServerNow(request: APIRequestContext, url: string, at: Date | string | number) {
  return request.get(url, { headers: serverNowHeaders(at) });
}

export const test = base.extend<{ serverNow: ServerNow }>({
  serverNow: async ({ page }, provide) => {
    await provide(createServerNow(page));
  },
});
