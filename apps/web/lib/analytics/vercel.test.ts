import { test } from "node:test";
import assert from "node:assert/strict";
import { vercelAnalyticsEnabled } from "./vercel";

test("regression: vercel-insights-off-vercel: no /_vercel scripts on next start, CI or the e2e servers", () => {
  assert.equal(vercelAnalyticsEnabled({}), false);
  assert.equal(vercelAnalyticsEnabled({ NEXT_PUBLIC_APP_ENV: "test" }), false);
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "" }), false);
});

test("vercelAnalyticsEnabled is on for every Vercel deployment (dev project included)", () => {
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_APP_ENV: "dev" }), true);
  assert.equal(vercelAnalyticsEnabled({ VERCEL: "1", VERCEL_ENV: "preview" }), true);
});
