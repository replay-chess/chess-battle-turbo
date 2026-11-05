// scripts/qa/state-coverage.ts: a listing counts every tagged test; a run report counts only passing tests
// (sign-off review: skipped tests were reported as "real").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as stateCoverage from "../../../../scripts/qa/state-coverage";

// The repo root has no "type": "module", so tsx loads the script as CommonJS: its exports sit on `default`.
const { tagsFromReport } =
  (stateCoverage as unknown as { default?: typeof stateCoverage }).default ?? stateCoverage;

const spec = (title: string, tests: { status?: string; results?: unknown[] }[], tags: string[] = []) => ({ title, tags, tests });

describe("state-coverage tagsFromReport", () => {
  it("a --list report: every tagged test counts, describe tags included", () => {
    const report = {
      suites: [
        {
          title: "x.spec.ts",
          suites: [{ title: "page @state:V3RateLimited.page", specs: [spec("counts down", [{ results: [] }])] }],
          specs: [spec("banner @state:V3PaymentFailed.banner", [{ results: [] }]), spec("demo", [{ results: [] }], ["@demo:V3Toasts"])],
        },
      ],
    };
    const t = tagsFromReport(report);
    assert.equal(t.ran, false);
    assert.deepEqual([...t.state].sort(), ["V3PaymentFailed.banner", "V3RateLimited.page"]);
    assert.deepEqual([...t.demo], ["V3Toasts"]);
  });

  it("a run report: skipped and failing tests reach nothing; passed and flaky do", () => {
    const ok = [{ status: "expected", results: [{ status: "passed" }] }];
    const report = {
      suites: [
        {
          title: "x.spec.ts",
          specs: [
            spec("skipped @state:V3PaymentFailed.banner", [{ status: "skipped", results: [{ status: "skipped" }] }]),
            spec("failed @state:V3SessionExpired.modal", [{ status: "unexpected", results: [{ status: "failed" }] }]),
            spec("flaky @state:V3SessionExpired.signing_in", [{ status: "flaky", results: [{ status: "failed" }, { status: "passed" }] }]),
            spec("passed @state:V3RateLimited.page", ok),
          ],
        },
      ],
    };
    const t = tagsFromReport(report);
    assert.equal(t.ran, true);
    assert.deepEqual([...t.state].sort(), ["V3RateLimited.page", "V3SessionExpired.signing_in"]);
  });
});
