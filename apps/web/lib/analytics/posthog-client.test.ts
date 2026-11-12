// The lazy PostHog client (lib/analytics/posthog-client.ts). regression: posthog-in-every-first-load (FIX-1):
// posthog-js was a static import of instrumentation-client and of every event helper, ~105 kB gzipped in the shared
// chunk of every route (the /r Lighthouse gate, G5).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { capturePosthog, loadPosthog, POSTHOG_QUEUE_MAX, resetPosthogClientForTests, withPosthog } from "./posthog-client";

const g = globalThis as { window?: unknown };

afterEach(() => {
  resetPosthogClientForTests();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete g.window;
});

describe("lazy PostHog client", () => {
  it("does nothing at all without a key", async () => {
    g.window = {};
    let ran = false;
    loadPosthog(
      () => {
        ran = true;
      },
      async () => {
        ran = true;
        return { default: {} as import("posthog-js").PostHog };
      },
    );
    withPosthog(() => {
      ran = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ran, false);
  });

  it("queues calls until the client has loaded, then runs them in order, once", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    g.window = {};
    const seen: string[] = [];
    withPosthog(() => seen.push("first"));
    capturePosthog("ignored-shape", {});
    let inits = 0;
    // A stand-in module (the real posthog-js needs a browser and keeps timers alive under node).
    const fake = { capture: (e: string) => seen.push(`capture:${e}`) } as unknown as import("posthog-js").PostHog;
    let loads = 0;
    const importer = async () => {
      loads++;
      return { default: fake };
    };
    loadPosthog(() => {
      inits++;
    }, importer);
    loadPosthog(() => {
      inits++;
    }, importer);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(loads, 1);
    withPosthog(() => seen.push("after"));
    assert.equal(inits, 1);
    assert.deepEqual(seen, ["first", "capture:ignored-shape", "after"]);
  });

  it("bounds the queue", () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    g.window = {};
    for (let i = 0; i < POSTHOG_QUEUE_MAX + 20; i++) withPosthog(() => undefined);
    assert.ok(POSTHOG_QUEUE_MAX >= 50);
  });

  it("no client module imports posthog-js statically any more", () => {
    for (const f of [
      "../../instrumentation-client.ts",
      "../../app/components/PostHogIdentify.tsx",
      "../../app/r/[code]/island.ts",
      "../../features/review/telemetry.ts",
      "../../features/games/model/telemetry.ts",
      "./shell-events.ts",
      "./system-events.ts",
      "./game-events.ts",
    ]) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      assert.doesNotMatch(src, /^import posthog from "posthog-js";$/m, f);
    }
  });
});
