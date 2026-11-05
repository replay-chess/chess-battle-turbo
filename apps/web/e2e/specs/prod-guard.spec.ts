// Production guard (phase-01 plan §11.6, §12.3; CT X12). @p1
//
// Runs only with PROD_GUARD=1, which makes playwright.config.ts build the app
// in production mode (NEXT_PUBLIC_APP_ENV=production) with ALLOW_TEST_HOOKS=1
// and every env hook set (lib/test-hooks/registry.ts prodGuardEnv), and serve
// it on :3200:
//
//   cd apps/web && set -a && source .env.test && set +a && PROD_GUARD=1 npx playwright test
//
// It iterates the hook registry: every dev route answers 404, every header hook
// leaves the response identical to the plain request, and every env hook is
// inert. It replaces the curl list of SPEC §12.3 step 4 (robots and manifest
// checks are kept at the end).
import { expect, test, type APIResponse } from "@playwright/test";
import { TEST_HOOKS, type EnvHook, type HeaderHook, type RouteHook } from "../../lib/test-hooks/registry";

const routes = TEST_HOOKS.filter((h): h is RouteHook => h.kind === "route");
const headers = TEST_HOOKS.filter((h): h is HeaderHook => h.kind === "header");
const envHooks = TEST_HOOKS.filter((h): h is EnvHook => h.kind === "env");

/** Fields that legitimately differ between two identical requests. */
const VOLATILE_KEYS = new Set(["requestId", "request_id", "time", "now", "timestamp", "ts", "uptime", "uptimeMs", "durationMs"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !VOLATILE_KEYS.has(k))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

async function snapshot(res: APIResponse) {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = normalize(JSON.parse(text));
  } catch {
    // not JSON: compare the raw text
  }
  return { status: res.status(), retryAfter: res.headers()["retry-after"] ?? null, body };
}

test.describe("production guard @p1", () => {
  for (const hook of routes) {
    for (const p of hook.paths) {
      test(`route ${p} is 404 (${hook.id})`, async ({ request }) => {
        const res = await request.get(p, { maxRedirects: 0 });
        expect(res.status(), `${p} must not exist in production`).toBe(404);
      });
    }
  }

  for (const hook of headers) {
    test(`header hook ${hook.id} is ignored`, async ({ request }) => {
      const plain = await snapshot(await request.fetch(hook.probe.path, { method: hook.probe.method }));
      const hooked = await snapshot(
        await request.fetch(hook.probe.path, { method: hook.probe.method, headers: hook.headers }),
      );
      expect(hooked, `${Object.keys(hook.headers).join(", ")} changed the response`).toEqual(plain);
    });
  }

  for (const hook of envHooks) {
    const proof = hook.proof;
    if (proof.by === "http") {
      test(`env hook ${hook.id} (${hook.env}) is inert`, async ({ request }) => {
        const res = await request.fetch(proof.path, { method: proof.method, headers: proof.headers, maxRedirects: 0 });
        expect(proof.expectStatus, `${hook.env} must not open ${proof.path}`).toContain(res.status());
      });
    } else if (proof.by === "browser") {
      test(`env hook ${hook.id} (${hook.env}) is inert`, async ({ page }) => {
        await page.goto(proof.path);
        const present = await page.evaluate((name) => name in window, proof.absentGlobal);
        expect(present, `window.${proof.absentGlobal} must not exist in production`).toBe(false);
      });
    } else {
      test(`env hook ${hook.id} (${hook.env}) is covered by ${proof.test}`, async () => {
        test.info().annotations.push({ type: "proof", description: proof.test });
      });
    }
  }

  test("robots.txt disallows /dev/ and the manifest keeps its identity", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("/dev/");
    const manifest = await (await request.get("/manifest.json")).json();
    expect(manifest).toMatchObject({ id: "/", start_url: "/play" });
  });
});
