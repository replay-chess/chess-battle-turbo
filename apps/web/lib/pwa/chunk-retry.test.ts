// regression: webkit-chunk-abort-on-reload (CI 43409659970: "ChunkLoadError: Loading chunk 4654 failed" on the
// review's `?m=2` reload). A failed chunk load is retried at 0.5 / 1.5 / 3 s before it is reported; other errors are not.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHUNK_RETRY_DELAYS_MS, installChunkRetry, isChunkLoadError, retryingChunkLoader } from "./chunk-retry";

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

  it("outside the browser bundle there is nothing to wrap", () => {
    assert.equal(installChunkRetry(), false);
  });
});
