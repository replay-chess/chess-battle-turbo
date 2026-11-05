import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument, renderOpenApi } from "../../scripts/openapi";
import { HTTP_ENDPOINTS } from "./registry/index";

const committed = fileURLToPath(new URL("../../../../docs/api/openapi.json", import.meta.url));

describe("openapi", () => {
  it("is deterministic", () => {
    assert.equal(renderOpenApi(), renderOpenApi());
  });

  it("has one operation per registry entry, keyed by id", () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, { operationId: string }>> };
    const ids = Object.values(doc.paths).flatMap((item) => Object.values(item).map((op) => op.operationId));
    assert.deepEqual(ids.sort(), HTTP_ENDPOINTS.map((e) => e.id).sort());
  });

  it("matches the committed docs/api/openapi.json (run `pnpm --filter @repo/contracts openapi`)", () => {
    assert.equal(readFileSync(committed, "utf8"), renderOpenApi());
  });
});
