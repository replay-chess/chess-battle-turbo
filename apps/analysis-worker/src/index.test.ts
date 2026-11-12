// The exported version is the package version (the image tag and Sentry release are built from it).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { WORKER_VERSION } from "./index";

describe("analysis-worker entry", () => {
  it("exports the package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    assert.equal(WORKER_VERSION, pkg.version);
  });
});
