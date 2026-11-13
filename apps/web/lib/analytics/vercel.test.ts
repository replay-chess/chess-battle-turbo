import { test } from "node:test";
import assert from "node:assert/strict";
import { vercelAnalyticsEnabled, vercelWebAnalyticsEnabled } from "./vercel";

test("regression: vercel-insights-off-vercel: no /_vercel scripts on next start, CI or the e2e servers", () => {
  assert.equal(vercelAnalyticsEnabled({}), false);
  assert.equal(vercelAnalyticsEnabled({ NEXT_PUBLIC_APP_ENV: "test" }), false);
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "" }), false);
});

test("vercelAnalyticsEnabled is on for every Vercel deployment (dev project included)", () => {
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_APP_ENV: "dev" }), true);
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: "preview" }), true);
});

test("regression: vercel-web-analytics-disabled-project (D7): no /_vercel/insights script unless the project enables it", () => {
  assert.equal(vercelWebAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: "production" }), false, "the dev project: Web Analytics off");
  assert.equal(vercelWebAnalyticsEnabled({ VERCEL_WEB_ANALYTICS: "1" }), false, "never off Vercel");
  assert.equal(vercelWebAnalyticsEnabled({ VERCEL: "1", VERCEL_WEB_ANALYTICS: "1" }), true);
  assert.equal(vercelWebAnalyticsEnabled({ VERCEL: "1", VERCEL_WEB_ANALYTICS: "0" }), false);
});
