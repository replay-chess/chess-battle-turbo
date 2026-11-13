// The worker's provider gates (phase-04 plan §12.1 `gate.test.ts`, §7.7.2, §8.11 429 row; R-CC-02, R-LI-06): one gate
// per provider per process, shared by both I/O lane slots and the lookup endpoint, on the worker clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError, isProviderError } from "@repo/chess-import/errors";
import { PROVIDER_LOOKUP_GATE_WAIT_MS } from "@repo/contracts/internal/provider";
import { FakeClock } from "../../scheduler/clock";
import { ProviderGates } from "../gate";

const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);

describe("provider gates", () => {
  it("never two concurrent requests per provider under 10 parallel callers (imports and lookup fallbacks)", async () => {
    const clock = new FakeClock(T0);
    const gates = new ProviderGates(clock);
    let inFlight = 0;
    let maxSeen = 0;
    const order: string[] = [];
    const call = (who: string, maxWaitMs?: number) =>
      gates.chesscom.run(
        async () => {
          inFlight++;
          maxSeen = Math.max(maxSeen, inFlight);
          order.push(who);
          await clock.sleep(100);
          inFlight--;
          return who;
        },
        maxWaitMs === undefined ? {} : { maxWaitMs },
      );
    const callers = [
      ...Array.from({ length: 8 }, (_, i) => call(`import-${i}`)),
      call("lookup-a", PROVIDER_LOOKUP_GATE_WAIT_MS),
      call("lookup-b", PROVIDER_LOOKUP_GATE_WAIT_MS),
    ];
    // Lichess is a different gate: it runs at the same time as Chess.com.
    let lichessOverlapped = false;
    const lichess = gates.lichess.run(async () => {
      lichessOverlapped = inFlight > 0;
      await clock.sleep(50);
    });
    await clock.advance(1_100);
    const done = await Promise.all(callers);
    await lichess;
    assert.equal(maxSeen, 1);
    assert.equal(gates.chesscom.stats.maxInFlight, 1);
    assert.equal(gates.chesscom.stats.calls, 10);
    assert.deepEqual(done, order, "FIFO");
    assert.equal(lichessOverlapped, true, "one gate per provider, not one for both");
  });

  it("a 429 pauses every caller of that provider until pauseUntil (Chess.com 60 s, Retry-After upwards)", async () => {
    const clock = new FakeClock(T0);
    const gates = new ProviderGates(clock);
    const started: number[] = [];
    const first = gates.chesscom.run(async () => {
      throw new ProviderError("chesscom", "rate_limited", "429", { status: 429, retryAfterSec: 30 });
    });
    await assert.rejects(first, (e: unknown) => isProviderError(e) && e.kind === "rate_limited");
    assert.equal(gates.pauseUntil("chesscom"), T0 + 60_000, "the ladder's 60 s beats Retry-After 30");
    const waiters = [1, 2, 3].map(() => gates.chesscom.run(async () => void started.push(clock.now())));
    await clock.advance(59_999);
    assert.deepEqual(started, []);
    await clock.advance(1);
    await Promise.all(waiters);
    assert.deepEqual(started, [T0 + 60_000, T0 + 60_000, T0 + 60_000]);
    assert.equal(gates.chesscom.stats.pauses, 1);
    // Lichess is untouched by a Chess.com pause.
    assert.ok(gates.pauseUntil("lichess") <= clock.now());
  });

  it("the Lichess back-off ladder: 60 → 120 → 240 → 480 → 900 s, capped, reset by a success", async () => {
    const clock = new FakeClock(T0);
    const gates = new ProviderGates(clock);
    const limited = () =>
      gates.lichess.run(async () => {
        throw new ProviderError("lichess", "rate_limited", "429", { status: 429 });
      });
    const pauses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = limited().catch(() => undefined);
      await clock.advance(Math.max(0, gates.pauseUntil("lichess") - clock.now()));
      await p;
      pauses.push(Math.round((gates.pauseUntil("lichess") - clock.now()) / 1000));
      await clock.advance(Math.max(0, gates.pauseUntil("lichess") - clock.now()));
    }
    assert.deepEqual(pauses, [60, 120, 240, 480, 900, 900]);
    await gates.lichess.run(async () => undefined);
    await limited().catch(() => undefined);
    assert.equal(Math.round((gates.pauseUntil("lichess") - clock.now()) / 1000), 60, "a success resets the ladder");
  });

  it("a lookup that waits more than 5 s for the gate is refused with rate_limited", async () => {
    const clock = new FakeClock(T0);
    const gates = new ProviderGates(clock);
    const release = await gates.chesscom.acquire();
    let outcome: string | null = null;
    const lookup = gates.chesscom
      .run(async () => "ran", { maxWaitMs: PROVIDER_LOOKUP_GATE_WAIT_MS })
      .then(
        (v) => (outcome = v),
        (e: unknown) => (outcome = isProviderError(e) ? e.kind : "other"),
      );
    await clock.advance(PROVIDER_LOOKUP_GATE_WAIT_MS);
    assert.equal(outcome, null);
    await clock.advance(1);
    await lookup;
    assert.equal(outcome, "rate_limited");
    release();
    // A lookup while the gate is paused past its cap is refused at once.
    gates.chesscom.pause(null);
    let refusedAt: number | null = null;
    await gates.chesscom
      .run(async () => "ran", { maxWaitMs: PROVIDER_LOOKUP_GATE_WAIT_MS })
      .catch((e: unknown) => {
        if (isProviderError(e) && e.kind === "rate_limited") refusedAt = clock.now();
      });
    assert.equal(refusedAt, clock.now());
  });
});
