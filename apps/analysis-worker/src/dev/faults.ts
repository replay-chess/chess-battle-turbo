// Provider fault injection (phase-04 plan §7.7.4, §12.1 `faults.test.ts`; testing X12). A dev/test hook: `/dev/import`
// (admin) → `POST /api/dev/import-fault` → the worker's `POST /internal/dev/fault` sets an entry in this process's
// fault table, and the provider transport (`faultingFetch`, wrapped around the real fetch in boot.ts) answers every
// call to that provider from the table until the entry expires:
//
//   5xx      a synthetic 503 (no Retry-After): the import's job back-off, the lookup's 502
//   429      a synthetic 429 with `Retry-After: 30`: the gate's pause, `import:failed {rate_limited}`
//   timeout  the call never answers: the client's own per-call timeout (or the Lichess idle limit) ends it
//   off      clears the provider's entry
//
// Each entry lives at most FAULT_TTL_MAX_SEC (600 s) on the worker clock, so a forgotten fault heals by itself.
//
// This is NOT P3's `WORKER_FAULT` (config/faults.ts, the analysis faults by ply): a different grammar, a different
// switch. The process refuses to boot with `IMPORT_FAULTS_ALLOWED=1` and `APP_ENV=production`
// (`parseFaultsAllowed`, called from config/env.ts), and without the switch the route answers 404 and the transport
// is the plain fetch: production has no fault table at all.
import {
  FAULT_PROVIDERS,
  type DevFaultBody,
  type DevFaultData,
  type FaultMode,
} from "@repo/contracts/internal/provider";
import type { FetchLike } from "@repo/chess-import/http";

export type FaultProvider = (typeof FAULT_PROVIDERS)[number];
export type ActiveFaultMode = Exclude<FaultMode, "off">;

/** The `Retry-After` of a synthetic 429 (§7.7.4). */
export const FAULT_RETRY_AFTER_SEC = 30;

export class FaultsAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaultsAllowedError";
  }
}

type RawEnv = Readonly<Record<string, string | undefined>>;

/**
 * `IMPORT_FAULTS_ALLOWED` (on/off, default off). Throws with APP_ENV=production when it is on: the fault table is a
 * test hook and must never exist in a production worker (testing X12). Never echoes a value it refuses.
 */
export function parseFaultsAllowed(raw: RawEnv, appEnv: string): boolean {
  const v = raw.IMPORT_FAULTS_ALLOWED?.trim().toLowerCase();
  if (!v) return false;
  let on: boolean;
  if (["on", "1", "true", "yes"].includes(v)) on = true;
  else if (["off", "0", "false", "no"].includes(v)) on = false;
  else throw new FaultsAllowedError("IMPORT_FAULTS_ALLOWED must be on or off");
  if (on && appEnv === "production") {
    throw new FaultsAllowedError("IMPORT_FAULTS_ALLOWED is a test hook: it is refused with APP_ENV=production");
  }
  return on;
}

interface Entry {
  mode: ActiveFaultMode;
  untilMs: number;
}

/** The process's provider fault table. All times on the worker clock. */
export class FaultTable {
  private readonly entries = new Map<FaultProvider, Entry>();
  /** Calls answered from the table, per provider (tests, the dev page). */
  readonly served: Record<FaultProvider, number> = { chesscom: 0, lichess: 0 };

  constructor(private readonly nowMs: () => number) {}

  /** Applies one `DevFaultBody` and returns the table after the change. */
  apply(body: Pick<DevFaultBody, "provider" | "mode" | "ttlSec">): DevFaultData {
    if (body.mode === "off") this.entries.delete(body.provider);
    else this.entries.set(body.provider, { mode: body.mode, untilMs: this.nowMs() + body.ttlSec * 1000 });
    return this.view();
  }

  /** The active fault of a provider (an expired entry is dropped here). */
  active(provider: FaultProvider): ActiveFaultMode | null {
    const e = this.entries.get(provider);
    if (!e) return null;
    if (e.untilMs <= this.nowMs()) {
      this.entries.delete(provider);
      return null;
    }
    return e.mode;
  }

  view(): DevFaultData {
    const faults: DevFaultData["faults"] = [];
    for (const provider of FAULT_PROVIDERS) {
      const mode = this.active(provider);
      const e = this.entries.get(provider);
      if (mode && e) faults.push({ provider, mode, until: new Date(e.untilMs).toISOString() });
    }
    return { faults };
  }
}

/** Which provider a URL belongs to, by the configured base URLs (null: not a provider call). */
export function providerOfUrl(url: string, bases: Readonly<Record<FaultProvider, string>>): FaultProvider | null {
  for (const provider of FAULT_PROVIDERS) {
    const base = bases[provider];
    if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) return provider;
  }
  return null;
}

/** A call that never answers on its own: it settles only when the caller's signal aborts (its timeout). */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    if (!signal) return; // the caller races its own deadline (chess-import withDeadline)
    const fail = () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    if (signal.aborted) return fail();
    signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * The provider transport with the fault table in front of it: a call to a provider with an active fault is answered
 * synthetically and never reaches `inner`; every other call passes through untouched.
 */
export function faultingFetch(
  inner: FetchLike,
  table: FaultTable,
  bases: Readonly<Record<FaultProvider, string>>,
): FetchLike {
  return (input, init) => {
    const provider = providerOfUrl(input, bases);
    const mode = provider ? table.active(provider) : null;
    if (!provider || !mode) return inner(input, init);
    table.served[provider]++;
    switch (mode) {
      case "5xx":
        return Promise.resolve(
          new Response(JSON.stringify({ error: "injected fault" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        );
      case "429":
        return Promise.resolve(
          new Response(JSON.stringify({ error: "injected rate limit" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": String(FAULT_RETRY_AFTER_SEC) },
          }),
        );
      case "timeout":
        return hang(init.signal);
    }
  };
}
