// ProviderGate (phase-04 plan §7.7.2, §8.11, R-CC-02, R-LI-06): serial per provider under many parallel callers,
// FIFO, a 429 pauses everyone, the back-off ladder (Chess.com 60 s; Lichess 60 → 120 → 240 → 480 → 900 s) with
// Retry-After honoured upwards, the reset after a success, the caller's wait cap, aborts and spacing. Fake clock.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ProviderError } from "../errors";
import { PAUSE_LADDER_SEC, ProviderGate } from "../gate";
import { FakeClock, flush } from "../testing/fake-clock";

const rateLimited = (retryAfterSec: number | null = null) =>
  new ProviderError("lichess", "rate_limited", "429", { status: 429, retryAfterSec });

describe("ProviderGate", () => {
  it("never runs two calls at once under 10 parallel callers, and serves them in arrival order", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const calls = Array.from({ length: 10 }, (_, i) =>
      gate.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(i);
        await clock.sleep(100 + (i % 3) * 50);
        active -= 1;
        return i;
      }),
    );
    await clock.advance(5_000);
    assert.deepEqual(await Promise.all(calls), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(maxActive, 1);
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(gate.snapshot(), { held: false, waiting: 0, pauseUntil: 0, strikes: 0 });
  });

  it("a 429 pauses every waiting caller until the pause ends (Chess.com 60 s)", async () => {
    const clock = new FakeClock();
    const t0 = clock.now();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    const started: number[] = [];
    const first = gate.run(async () => {
      started.push(clock.now() - t0);
      throw new ProviderError("chesscom", "rate_limited", "429", { status: 429 });
    });
    const others = [1, 2, 3].map(() =>
      gate.run(async () => {
        started.push(clock.now() - t0);
      }),
    );
    await assert.rejects(first, (e: unknown) => e instanceof ProviderError && e.kind === "rate_limited");
    assert.equal(gate.pauseUntil, t0 + 60_000);
    await clock.advance(59_999);
    assert.deepEqual(started, [0]);
    await clock.advance(1);
    await Promise.all(others);
    assert.deepEqual(started, [0, 60_000, 60_000, 60_000]);
  });

  it("walks the Lichess ladder 60 → 120 → 240 → 480 → 900 → 900 s and resets after a success", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "lichess", clock });
    assert.deepEqual(PAUSE_LADDER_SEC.lichess, [60, 120, 240, 480, 900]);
    const pauses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = clock.now();
      const p = gate.run(async () => {
        throw rateLimited();
      });
      await assert.rejects(p);
      pauses.push((gate.pauseUntil - before) / 1000);
      await clock.advance(gate.pauseUntil - clock.now());
    }
    assert.deepEqual(pauses, [60, 120, 240, 480, 900, 900]);
    await gate.run(async () => "ok");
    assert.equal(gate.snapshot().strikes, 0);
    const before = clock.now();
    await assert.rejects(gate.run(async () => Promise.reject(rateLimited())));
    assert.equal((gate.pauseUntil - before) / 1000, 60);
  });

  it("honours a longer Retry-After and ignores a shorter one", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "lichess", clock });
    const t0 = clock.now();
    await assert.rejects(gate.run(async () => Promise.reject(rateLimited(300))));
    assert.equal(gate.pauseUntil, t0 + 300_000);
    await clock.advance(300_000);
    const t1 = clock.now();
    await assert.rejects(gate.run(async () => Promise.reject(rateLimited(5))));
    assert.equal(gate.pauseUntil, t1 + 120_000, "second strike: the 120 s step beats Retry-After 5");
  });

  it("refuses a capped waiter at once when the gate is paused past its cap", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    gate.pause();
    await assert.rejects(
      gate.acquire({ maxWaitMs: 5_000 }),
      (e: unknown) => e instanceof ProviderError && e.kind === "rate_limited" && e.retryAfterSec === 60,
    );
  });

  it("refuses a capped waiter that waits more than its cap behind a long call (the 5 s lookup rule)", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    const long = gate.run(() => clock.sleep(20_000));
    let settledAt: number | null = null;
    const t0 = clock.now();
    const lookup = gate.run(async () => "served", { maxWaitMs: 5_000 }).finally(() => {
      settledAt = clock.now() - t0;
    });
    const rejected = assert.rejects(lookup, (e: unknown) => e instanceof ProviderError && e.kind === "rate_limited");
    await clock.advance(6_000);
    await rejected;
    assert.ok(settledAt !== null && settledAt > 5_000 && settledAt <= 5_001, `refused at ${settledAt}`);
    await clock.advance(20_000);
    await long;
    assert.equal(gate.snapshot().waiting, 0);
  });

  it("a capped waiter that gets the gate in time is served", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    const short = gate.run(() => clock.sleep(2_000));
    const lookup = gate.run(async () => "served", { maxWaitMs: 5_000 });
    await clock.advance(2_000);
    await short;
    assert.equal(await lookup, "served");
  });

  it("an aborted waiter leaves the queue and the next one is served", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "lichess", clock });
    const hold = gate.run(() => clock.sleep(1_000));
    const ctl = new AbortController();
    const gone = gate.run(async () => "never", { signal: ctl.signal });
    const next = gate.run(async () => "next");
    ctl.abort();
    await assert.rejects(gone, (e: unknown) => e instanceof ProviderError && e.kind === "aborted");
    await clock.advance(1_000);
    await hold;
    assert.equal(await next, "next");
  });

  it("spaces call starts by minIntervalMs", async () => {
    const clock = new FakeClock();
    const t0 = clock.now();
    const gate = new ProviderGate({ provider: "chesscom", clock, minIntervalMs: 1_000 });
    const starts: number[] = [];
    const calls = [0, 1, 2].map(() => gate.run(async () => void starts.push(clock.now() - t0)));
    await clock.advance(3_000);
    await Promise.all(calls);
    assert.deepEqual(starts, [0, 1_000, 2_000]);
  });

  it("release is idempotent and a thrown non-429 error does not pause", async () => {
    const clock = new FakeClock();
    const gate = new ProviderGate({ provider: "chesscom", clock });
    const release = await gate.acquire();
    release();
    release();
    await assert.rejects(gate.run(async () => Promise.reject(new ProviderError("chesscom", "upstream", "503"))));
    assert.equal(gate.pauseUntil, 0);
    await flush();
    assert.equal(gate.snapshot().held, false);
  });
});
