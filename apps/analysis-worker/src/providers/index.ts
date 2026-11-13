// The worker's provider clients (phase-04 plan §7.7.2 "thin adapters over CI clients (anonymous), wired to the gate
// and the fault table"; §7.8). One Chess.com and one Lichess client per process, each on its process gate
// (gate.ts), the worker clock (the per-call timeouts and the Lichess stream deadlines run on it, so tests use a fake
// clock), the configured base URL (the e2e upstream mock in test builds; production accepts only the real providers,
// import/settings.ts) and the `UPSTREAM_CONTACT` User-Agent. Never a token: every call is anonymous (D4-21).
//
// `fetch` is the seam for the dev fault table (WK/src/dev/faults.ts, §7.7.4): it wraps the transport so a synthetic
// 503 / 429 / timeout is served before the upstream is called. Tests pass the in-process upstream mock here.
import { ChessComClient } from "@repo/chess-import/chesscom/client";
import type { FetchLike } from "@repo/chess-import/http";
import { LichessClient } from "@repo/chess-import/lichess/client";
import type { ImportSettings } from "../import/settings";
import type { Clock } from "../scheduler/clock";
import { ProviderGates } from "./gate";

export { ProviderGates, CountedGate, PROVIDERS, type GateStats, type Provider } from "./gate";
export type { FetchLike };

export interface ImportProviders {
  readonly gates: ProviderGates;
  readonly chesscom: ChessComClient;
  readonly lichess: LichessClient;
}

export interface ProviderOptions {
  settings: Pick<ImportSettings, "chesscomBaseUrl" | "lichessBaseUrl" | "contact">;
  clock: Clock;
  /** The transport (default: global fetch). The fault table and the tests wrap it. */
  fetch?: FetchLike;
  /** Share gates with another set of clients in the same process (the lookup endpoint). */
  gates?: ProviderGates;
}

export function createProviders(opts: ProviderOptions): ImportProviders {
  const gates = opts.gates ?? new ProviderGates(opts.clock);
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  return {
    gates,
    chesscom: new ChessComClient({
      baseUrl: opts.settings.chesscomBaseUrl,
      contact: opts.settings.contact,
      fetch: fetchImpl,
      clock: opts.clock,
      gate: gates.chesscom,
      caller: "worker",
    }),
    lichess: new LichessClient({
      baseUrl: opts.settings.lichessBaseUrl,
      contact: opts.settings.contact,
      fetch: fetchImpl,
      clock: opts.clock,
      gate: gates.lichess,
    }),
  };
}
