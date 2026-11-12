import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { downloadPct, DOWNLOAD_SHARE, ENGINE_WASM_BYTES_ESTIMATE, prefetchWithProgress, startEngineWithProgress } from "./engine-load";

function streamed(chunks: number[], length: number | null, ok = true): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const n of chunks) c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
    const headers = new Headers(length === null ? {} : { "content-length": String(length) });
    return new Response(body, { status: ok ? 200 : 404, headers });
  }) as unknown as typeof fetch;
}

describe("engine start with progress", () => {
  it("maps bytes onto the first 90 %", () => {
    assert.equal(downloadPct(0, 1000), 0);
    assert.equal(downloadPct(500, 1000), 45);
    assert.equal(downloadPct(1000, 1000), DOWNLOAD_SHARE);
    assert.equal(downloadPct(ENGINE_WASM_BYTES_ESTIMATE / 2, null), 45, "no Content-Length: the build's size");
    assert.equal(downloadPct(10 ** 9, null), DOWNLOAD_SHARE);
  });

  it("reports as the body streams, then 90", async () => {
    const seen: number[] = [];
    await prefetchWithProgress("/x.wasm", (p) => seen.push(p), streamed([250, 250, 500], 1000));
    assert.deepEqual(seen, [22, 45, 90, 90]);
  });

  it("never throws on a failed or rejected fetch", async () => {
    const seen: number[] = [];
    await prefetchWithProgress("/x.wasm", (p) => seen.push(p), streamed([10], 10, false));
    await prefetchWithProgress("/x.wasm", (p) => seen.push(p), (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch);
    assert.deepEqual(seen, []);
  });

  it("an engine already up is 100 at once; otherwise download, init, 100", async () => {
    const ready = { status: () => "ready" as const, init: async () => assert.fail("no init") };
    const seen: number[] = [];
    await startEngineWithProgress(ready, "/x.wasm", (p) => seen.push(p), streamed([1], 1));
    assert.deepEqual(seen, [100]);

    const calls: string[] = [];
    const idle = { status: () => "idle" as const, init: async () => void calls.push("init") };
    const seen2: number[] = [];
    await startEngineWithProgress(idle, "/x.wasm", (p) => seen2.push(p), streamed([5, 5], 10));
    assert.deepEqual(calls, ["init"]);
    assert.deepEqual(seen2, [0, 45, 90, 90, 100]);
  });

  it("rejects when the engine fails to start (engine_failed)", async () => {
    const broken = { status: () => "idle" as const, init: async () => Promise.reject(new Error("wasm blocked")) };
    await assert.rejects(startEngineWithProgress(broken, "/x.wasm", () => undefined, streamed([], 0)), /wasm blocked/);
  });
});
