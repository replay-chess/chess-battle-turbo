// build-engine-assets.mjs (phase-02 plan 0.2, 13.1 WP-H): the folder hash is stable and matches ENGINE_HASH in
// features/engine/manifest.ts for the committed engine files; SOURCE.txt names the upstream and the GPL offer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { engineHash, GLUE, sourceText, WASM } from "./build-engine-assets.mjs";
import { ENGINE_HASH } from "../features/engine/manifest";

test("engineHash is deterministic, 12 hex chars, and changes with either file", () => {
  const a = engineHash(Buffer.from("glue"), Buffer.from("wasm"));
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(engineHash(Buffer.from("glue"), Buffer.from("wasm")), a);
  assert.notEqual(engineHash(Buffer.from("glue2"), Buffer.from("wasm")), a);
  assert.notEqual(engineHash(Buffer.from("glue"), Buffer.from("wasm2")), a);
});

test("ENGINE_HASH matches the engine files in public/workers (run build-engine-assets.mjs after changing them)", () => {
  const dir = new URL("../public/workers/", import.meta.url);
  const hash = engineHash(readFileSync(new URL(GLUE, dir)), readFileSync(new URL(WASM, dir)));
  assert.equal(ENGINE_HASH, hash);
});

test("SOURCE.txt names the upstream tag, the net, the hashes and the written offer", () => {
  const text = sourceText({ version: "18.0.5", hash: "abc123abc123", glueSha: "g".repeat(64), wasmSha: "w".repeat(64) });
  assert.match(text, /github\.com\/nmrugg\/stockfish\.js\/tree\/v18\.0\.5/);
  assert.match(text, /nn-9067e33176e8\.nnue/);
  assert.match(text, /sf18-abc123abc123/);
  assert.match(text, /GPL-3\.0/);
  assert.match(text, /Written offer of source/);
});
