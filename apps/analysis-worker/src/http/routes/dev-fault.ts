// /internal/dev/fault (phase-04 plan §7.7.3, §7.7.4; testing X12): the worker side of `/dev/import`.
//
//   POST {v:1, provider, mode, ttlSec}  → 200 DevFaultData (the table after the change)
//   GET                                 → 200 DevFaultData (the table as it is)
//
// Signed by the web with kid `webwk` only (CT/internal/auth.ts WORKER_POLICY: ops may not call it). It exists only
// in a worker started with IMPORT_FAULTS_ALLOWED=1 (never production: config/env.ts refuses that boot); without the
// switch http/server.ts answers 404 before reading anything, exactly like an unknown path.
import { DevFaultBody, DevFaultData } from "@repo/contracts/internal/provider";
import type { FaultTable } from "../../dev/faults";
import type { Logger } from "../../obs/log";

export type DevFaultOutcome = { status: 200; body: DevFaultData } | { status: 400; body: { error: "invalid_body" } };

export function devFaultRoute(table: FaultTable, log: Logger) {
  return {
    /** The table as it is (GET). */
    view(): DevFaultOutcome {
      return { status: 200, body: DevFaultData.parse(table.view()) };
    },
    /** Applies a parsed JSON body (POST). */
    apply(json: unknown): DevFaultOutcome {
      const parsed = DevFaultBody.safeParse(json);
      if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
      const after = table.apply(parsed.data);
      log.warn("provider fault table changed", {
        provider: parsed.data.provider,
        mode: parsed.data.mode,
        ttlSec: parsed.data.ttlSec,
      });
      return { status: 200, body: DevFaultData.parse(after) };
    },
  };
}

export type DevFaultRoute = ReturnType<typeof devFaultRoute>;
