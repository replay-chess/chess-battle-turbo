// Engine locations (phase-02 plan 0.2, 7.9): the hashed same-origin folder, the R2 base from
// NEXT_PUBLIC_ENGINE_BASE_URL (https only, hash must match), and the shim URL the worker is created with.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENGINE_HASH, ENGINE_SHIM, engineUrls, originBase, remoteBase } from "./manifest";

test("ENGINE_HASH is set by build-engine-assets.mjs and names a folder", () => {
  assert.match(ENGINE_HASH, /^[0-9a-f]{12}$/);
  assert.equal(originBase(), `/workers/sf18-${ENGINE_HASH}/`);
});

test("remoteBase: https only, trailing slash added, a mismatched sf18 folder is ignored", () => {
  assert.equal(remoteBase(undefined, "abc"), null);
  assert.equal(remoteBase("", "abc"), null);
  assert.equal(remoteBase("http://media.example.com/engine/sf18-abc/", "abc"), null);
  assert.equal(remoteBase("not a url", "abc"), null);
  assert.equal(remoteBase("https://m.example.com/engine/sf18-abc?x=1", "abc"), null);
  assert.equal(remoteBase("https://m.example.com/engine/sf18-abc", "abc"), "https://m.example.com/engine/sf18-abc/");
  assert.equal(remoteBase("https://m.example.com/engine/sf18-def/", "abc"), null);
  assert.equal(remoteBase("https://m.example.com/engine/", "abc"), "https://m.example.com/engine/");
});

test("engineUrls: origin by default; R2 puts the remote in `r` and the R2 wasm in the fragment", () => {
  const o = engineUrls({ remote: null, hash: "abc123" });
  assert.equal(o.source, "origin");
  assert.equal(o.wasm, "/workers/sf18-abc123/stockfish-18-lite-single.wasm");
  assert.equal(o.worker, `${ENGINE_SHIM}?o=%2Fworkers%2Fsf18-abc123%2F#${encodeURIComponent(o.wasm)}`);

  const r = engineUrls({ remote: "https://m.example.com/engine/sf18-abc123/", hash: "abc123" });
  assert.equal(r.source, "r2");
  assert.equal(r.glue, "https://m.example.com/engine/sf18-abc123/stockfish-18-lite-single.js");
  const u = new URL(r.worker, "https://app.example.com");
  assert.equal(u.searchParams.get("o"), "/workers/sf18-abc123/");
  assert.equal(u.searchParams.get("r"), "https://m.example.com/engine/sf18-abc123/");
  // The Stockfish.js glue splits the fragment on "," and decodes the first part.
  assert.equal(decodeURIComponent(u.hash.slice(1).split(",")[0]!), r.wasm);
});

test("the shim validates its folders before loading anything", () => {
  const shim = readFileSync(new URL("../../public/workers/engine-shim.js", import.meta.url), "utf8");
  assert.match(shim, /\^\\\/workers\\\/sf18-\[0-9a-f\]\{6,64\}\\\/\$/);
  assert.match(shim, /importScripts\(origin \+ GLUE\)/);
  assert.match(shim, /rc: "engine-init"/);
});
