// The P3 client Sentry helpers (phase-03 plan §10.2 "Client"). regression: client-sentry-missing (FIX-1): the review,
// archive and compare screens had no breadcrumbs, no auto-advance span, no first-badge metric and no boundary with
// the request id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError } from "@/lib/api/errors";
import { analysisEventPly, captureBoundaryError, recordFirstBadge, startAutoAdvanceSpan } from "./review";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("review Sentry helpers", () => {
  it("a breadcrumb carries the event type and ply only", () => {
    assert.equal(analysisEventPly({ v: 1, gameRef: "cx", from: 4, gradedPlies: 10, evals: [1, 2] }), 10);
    assert.equal(analysisEventPly({ v: 1, gameRef: "cx", gradedPlies: 30, failedAtPly: 20 }), 20);
    assert.equal(analysisEventPly({ v: 1, gameRef: "cx" }), null);
    const body = src("./review.ts");
    assert.match(body, /const data = \{ ply: analysisEventPly\(payload\) \};/);
  });

  it("the boundary reports the API request id; other errors have none; nothing throws without an initialised SDK", () => {
    const api = new ApiError({ status: 500, code: "internal", requestId: "req_123" });
    assert.equal(captureBoundaryError(api, "review"), "req_123");
    assert.equal(captureBoundaryError(new Error("boom"), "games"), null);
    recordFirstBadge(120, "live");
    recordFirstBadge(-1, "load");
    startAutoAdvanceSpan().end();
  });

  it("the realtime handler, the three screens' boundaries and the review screen are wired", () => {
    assert.match(src("../realtime/handlers/analysis.ts"), /analysisBreadcrumb\(name, payload\);\s*applyAnalysisEvent/);
    for (const [file, screen] of [
      ["../../app/(app)/review/[ref]/error.tsx", "review"],
      ["../../app/(app)/review/[ref]/legend/error.tsx", "compare"],
      ["../../app/(app)/games/error.tsx", "games"],
    ] as const) {
      assert.match(src(file), new RegExp(`captureBoundaryError\\(error, "${screen}"\\)`), file);
    }
    const screen = src("../../features/review/components/ReviewScreen.tsx");
    assert.match(screen, /startAutoAdvanceSpan\(\)/);
    assert.match(screen, /recordFirstBadge\(/);
  });
});
