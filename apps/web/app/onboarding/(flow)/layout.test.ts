// The (flow) layout's hydration and redirect contract (FIX-1, REGRESSION-4 §4.1): the guard runs in the layout before
// anything streams, and the steps render inside a Suspense boundary inside the frame's <main>.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const src = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

describe("onboarding (flow) layout", () => {
  it("regression: onb-hydration-418 (FIX-1): steps sit in a Suspense boundary inside the shell; the guard redirects first", () => {
    assert.match(src, /<OnboardingShell>\s*<Suspense fallback=\{null\}>\{children\}<\/Suspense>\s*<\/OnboardingShell>/);
    const guard = src.indexOf("guardStepFromLayout(viewer");
    const shell = src.indexOf("<OnboardingShell>");
    assert.ok(guard > 0 && guard < shell, "the layout's guard (a 307) runs before the boundary can stream");
  });
});
