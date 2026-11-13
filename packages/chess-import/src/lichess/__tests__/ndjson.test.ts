// NDJSON splitter (phase-04 plan §8.7 step 2, §12.1 row 3): lines split across chunks, CRLF, multi-byte characters
// split across chunks, a trailing line without a newline, invalid lines skipped and counted, abort mid-stream, the
// idle and total deadlines on the fake clock, and the long-line guard.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FakeClock } from "../../testing/fake-clock";
import { chunkStream, pushStream } from "../../__tests__/helpers";
import { ndjsonLines, StreamAbortedError, StreamTimeoutError, type NdjsonStats } from "../ndjson";

async function collect(stream: ReadableStream<Uint8Array>, stats?: NdjsonStats, opts = {}): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of ndjsonLines(stream, { stats, ...opts })) out.push(v);
  return out;
}

describe("ndjsonLines", () => {
  it("joins lines split across chunks", async () => {
    const stats = { lines: 0, invalid: 0 };
    const out = await collect(chunkStream(['{"a":', '1}\n{"b"', ":2}\n", '{"c":3}\n']), stats);
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    assert.deepEqual(stats, { lines: 3, invalid: 0 });
  });

  it("handles CRLF, blank lines and a trailing line without a newline", async () => {
    const out = await collect(chunkStream(['{"a":1}\r\n\r\n', '{"b":2}\r', '\n{"c":3}']));
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"Schäfer ♞"}\n');
    const cut = bytes.indexOf(0xc3) + 1; // inside "ä"
    const out = await collect(chunkStream([bytes.slice(0, cut), bytes.slice(cut)]));
    assert.deepEqual(out, [{ name: "Schäfer ♞" }]);
  });

  it("skips and counts an invalid line, keeps going", async () => {
    const stats = { lines: 0, invalid: 0 };
    const out = await collect(chunkStream(['{"a":1}\n{not json\n{"b":2}\n']), stats);
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(stats, { lines: 3, invalid: 1 });
  });

  it("drops a line longer than maxLineChars and counts it once", async () => {
    const stats = { lines: 0, invalid: 0 };
    const out = await collect(chunkStream(['{"a":1}\n', "x".repeat(30), "y".repeat(30), '\n{"b":2}\n']), stats, {
      maxLineChars: 40,
    });
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(stats, { lines: 3, invalid: 1 });
  });

  it("stops mid-stream on abort", async () => {
    const s = pushStream();
    const ctl = new AbortController();
    const it = ndjsonLines(s.stream, { signal: ctl.signal });
    s.push('{"a":1}\n');
    assert.deepEqual((await it.next()).value, { a: 1 });
    const next = it.next();
    ctl.abort();
    await assert.rejects(next, StreamAbortedError);
  });

  it("an idle stream times out after idleTimeoutMs on the clock", async () => {
    const clock = new FakeClock();
    const s = pushStream();
    const it = ndjsonLines(s.stream, { clock, idleTimeoutMs: 30_000, totalTimeoutMs: 600_000 });
    s.push('{"a":1}\n');
    assert.deepEqual((await it.next()).value, { a: 1 });
    const next = it.next();
    const check = assert.rejects(next, (e: unknown) => e instanceof StreamTimeoutError && e.which === "idle");
    await clock.advance(29_999);
    s.push('{"b":2}'); // a partial line still counts as activity
    await clock.advance(29_999);
    await clock.advance(1);
    await check;
  });

  it("a stream that keeps trickling still ends at totalTimeoutMs", async () => {
    const clock = new FakeClock();
    const s = pushStream();
    const it = ndjsonLines(s.stream, { clock, idleTimeoutMs: 30_000, totalTimeoutMs: 100_000 });
    const seen: unknown[] = [];
    const run = (async () => {
      for (;;) {
        const r = await it.next();
        if (r.done) return;
        seen.push(r.value);
      }
    })();
    const check = assert.rejects(run, (e: unknown) => e instanceof StreamTimeoutError && e.which === "total");
    for (let i = 0; i < 5; i++) {
      s.push(`{"n":${i}}\n`); // every 20 s: never idle for 30 s
      await clock.advance(20_000);
    }
    await check; // ended at 100 s
    assert.equal(seen.length, 5);
  });

  it("propagates a stream error", async () => {
    const s = pushStream();
    const it = ndjsonLines(s.stream);
    const next = it.next();
    s.error(new Error("socket hang up"));
    await assert.rejects(next, /socket hang up/);
  });
});
