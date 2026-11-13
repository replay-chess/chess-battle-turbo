// The worker's provider gates (phase-04 plan §7.7.2 "per-provider mutex with a global pause", §8.6, §8.7, §8.11;
// R-CC-02, R-LI-06). ONE gate per provider per process, shared by every caller in it: both I/O lane slots (two imports
// of the same provider queue behind each other request by request; a Lichess stream holds the gate for its whole
// length) and the Chess.com lookup endpoint (which waits at most PROVIDER_LOOKUP_GATE_WAIT_MS). So this process never
// has two requests in flight to one provider.
//
// The gate itself is `ProviderGate` from @repo/chess-import (serial FIFO, a 429 pauses every caller: Chess.com 60 s,
// Lichess 60 → 120 → 240 → 480 → 900 s, `Retry-After` honoured upwards, a success resets the ladder). This file owns
// the instances, runs them on the worker's clock, and counts what went through them so the tests and the bench can
// prove the "never two concurrent requests" rule from the outside (`maxInFlight`).
import { ProviderGate, type AcquireOptions, type GateSnapshot } from "@repo/chess-import/gate";
import type { Provider } from "@repo/chess-import/errors";
import type { Clock } from "../scheduler/clock";

export type { Provider };
export const PROVIDERS: readonly Provider[] = ["chesscom", "lichess"];

/** What went through one gate since boot (tests, the bench, `/internal/metrics` once part 2 wires it). */
export interface GateStats {
  /** Calls holding the gate right now (0 or 1 by construction). */
  inFlight: number;
  /** The most calls that ever held the gate at once: 1 proves the serial rule. */
  maxInFlight: number;
  calls: number;
  /** 429 pauses started. */
  pauses: number;
}

/** A ProviderGate that counts its holders. Same API: the chess-import clients take it as their `gate`. */
export class CountedGate extends ProviderGate {
  readonly stats: GateStats = { inFlight: 0, maxInFlight: 0, calls: 0, pauses: 0 };

  override acquire(opts: AcquireOptions = {}): Promise<() => void> {
    return super.acquire(opts).then((release) => {
      this.stats.inFlight++;
      this.stats.calls++;
      this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.stats.inFlight);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.stats.inFlight--;
        release();
      };
    });
  }

  override pause(retryAfterSec: number | null = null): number {
    this.stats.pauses++;
    return super.pause(retryAfterSec);
  }
}

/** The process's two gates. */
export class ProviderGates {
  readonly chesscom: CountedGate;
  readonly lichess: CountedGate;

  constructor(clock: Clock) {
    // The worker clock is structurally the chess-import Clock (now + sleep); fake in tests.
    this.chesscom = new CountedGate({ provider: "chesscom", clock });
    this.lichess = new CountedGate({ provider: "lichess", clock });
  }

  of(provider: Provider): CountedGate {
    return provider === "chesscom" ? this.chesscom : this.lichess;
  }

  /** When the provider's global pause ends (epoch ms; ≤ now when not paused). */
  pauseUntil(provider: Provider): number {
    return this.of(provider).pauseUntil;
  }

  snapshot(): Record<Provider, GateSnapshot & { stats: GateStats }> {
    return {
      chesscom: { ...this.chesscom.snapshot(), stats: { ...this.chesscom.stats } },
      lichess: { ...this.lichess.snapshot(), stats: { ...this.lichess.stats } },
    };
  }
}
