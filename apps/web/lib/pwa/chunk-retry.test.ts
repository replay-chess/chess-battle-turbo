// regression: webkit-chunk-abort-on-reload (CI 43409659970: "ChunkLoadError: Loading chunk 4654 failed" on the
// review's `?m=2` reload). A failed chunk load is retried at 0.5 / 1.5 / 3 s before it is reported; other errors are not.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHUNK_RETRY_DELAYS_MS, CHUNK_SCRIPT_GUARD, installChunkRetry, isChunkLoadError, retryingChunkLoader } from "./chunk-retry";

const chunkError = (id: number) => Object.assign(new Error(`Loading chunk ${id} failed.\n(error: http://x/_next/static/chunks/${id}.js)`), { name: "ChunkLoadError" });

describe("chunk retry", () => {
  it("recognises webpack's JS and CSS chunk errors only", () => {
    assert.equal(isChunkLoadError(chunkError(4654)), true);
    assert.equal(isChunkLoadError(new Error("Loading CSS chunk 12 failed.\n(/x.css)")), true);
    assert.equal(isChunkLoadError(new TypeError("x is not a function")), false);
    assert.equal(isChunkLoadError(null), false);
  });

  it("a load that fails twice and then works resolves, after the first two delays", async () => {
    const waits: number[] = [];
    let calls = 0;
    const load = retryingChunkLoader(async (id) => {
      calls++;
      if (calls < 3) throw chunkError(Number(id));
      return "ok";
    }, CHUNK_RETRY_DELAYS_MS, async (ms) => waits.push(ms));
    assert.equal(await load(7153), "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [500, 1_500]);
  });

  it("a chunk that stays gone fails after every delay, with the last error", async () => {
    const waits: number[] = [];
    let calls = 0;
    const load = retryingChunkLoader(async (id) => {
      calls++;
      throw chunkError(Number(id));
    }, CHUNK_RETRY_DELAYS_MS, async (ms) => waits.push(ms));
    await assert.rejects(load(264), (e: unknown) => isChunkLoadError(e));
    assert.equal(calls, CHUNK_RETRY_DELAYS_MS.length + 1);
    assert.deepEqual(waits, [...CHUNK_RETRY_DELAYS_MS]);
  });

  it("any other error is not retried", async () => {
    let calls = 0;
    const load = retryingChunkLoader(async () => {
      calls++;
      throw new TypeError("boom");
    }, CHUNK_RETRY_DELAYS_MS, async () => undefined);
    await assert.rejects(load(1), TypeError);
    assert.equal(calls, 1);
  });

  // regression: webkit-route-chunk-dead-tag (CI 43653740138): webpack waited 120 s on a server-rendered chunk <script>
  // that had already failed. The inline guard removes such a tag unless a loader is attached to it.
  it("the inline guard removes a failed chunk <script> no loader waits on, and nothing else", () => {
    type Listener = (e: { target: unknown }) => void;
    const listeners: { type: string; fn: Listener; capture: unknown }[] = [];
    new Function("addEventListener", CHUNK_SCRIPT_GUARD)((type: string, fn: Listener, capture: unknown) => listeners.push({ type, fn, capture }));
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0]!.type, "error");
    assert.equal(listeners[0]!.capture, true, "capture: an element's load error does not bubble to window");
    const removed: string[] = [];
    const el = (tagName: string, src: string, onerror: unknown = null) => {
      const node = { tagName, src, onerror, parentNode: { removeChild: () => removed.push(src) } };
      return node;
    };
    const fire = (target: unknown) => listeners[0]!.fn({ target });
    fire(el("SCRIPT", "http://localhost:3000/_next/static/chunks/app/(app)/layout-15ae7ff7d7e4f708.js"));
    fire(el("SCRIPT", "http://localhost:3000/_next/static/chunks/2563-abc.js", () => undefined)); // webpack is attached
    fire(el("SCRIPT", "https://cdn.example/npm/@clerk/clerk-js@5/dist/clerk.browser.js"));
    fire(el("LINK", "http://localhost:3000/_next/static/chunks/x.css"));
    fire(el("IMG", "http://localhost:3000/_next/static/chunks/x.png"));
    fire({ tagName: "SCRIPT", src: "http://localhost:3000/_next/static/chunks/1.js", onerror: null, parentNode: null });
    fire(null);
    assert.deepEqual(removed, ["http://localhost:3000/_next/static/chunks/app/(app)/layout-15ae7ff7d7e4f708.js"]);
  });

  it("outside the browser bundle there is nothing to wrap", () => {
    assert.equal(installChunkRetry(), false);
  });
});
