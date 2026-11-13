// `entitlement:changed` to the member's user room (phase-04 plan 7.6, 8.5.4 step 1; D4-24, AP-44): P2's
// `POST /internal/emit` body `{v:1, targets:[{userRef}], event, data}`, signed by internalFetch() with kid `web` (only
// the web may emit this event: CT/internal/auth.ts INTERNAL_POLICY). The payload is validated against
// CT/socket/user.ts first, so a malformed emit fails here, not on the socket. Never throws: a lost emit only costs the
// live update (the activation pages poll as well, plan 5.7).
import { EntitlementChangedEvent } from "@repo/contracts/socket/user";
import { InternalFetchConfigError, internalFetch } from "@/lib/internal/fetch";
import { logger } from "@/lib/logger";

let fetchImpl: typeof fetch | undefined;

/** Test seam: the transport internalFetch uses for this emit; returns a restore function. */
export function setEntitlementEmitTransport(next: typeof fetch | undefined): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

function warn(message: string, context: Record<string, string>): void {
  try {
    logger.warn(message, context);
  } catch {
    // Logging never fails an emit.
  }
}

export async function emitEntitlementChanged(userRef: string, data: EntitlementChangedEvent): Promise<boolean> {
  if (!userRef) return false;
  const payload = EntitlementChangedEvent.safeParse(data);
  if (!payload.success) {
    warn("billing.emit_invalid", { event: "entitlement:changed" });
    return false;
  }
  try {
    const res = await internalFetch("/internal/emit", {
      body: { v: 1, targets: [{ userRef }], event: "entitlement:changed", data: payload.data },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) warn("billing.emit_refused", { event: "entitlement:changed", status: String(res.status) });
    return res.ok;
  } catch (err) {
    warn("billing.emit_failed", {
      event: "entitlement:changed",
      reason: err instanceof InternalFetchConfigError ? err.message : err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}
