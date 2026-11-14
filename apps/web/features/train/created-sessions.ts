// Sessions this tab has just created (W2 from the hub, the bank or the theme picker; phase-05 plan §5.2, §10.1). The
// creator navigates to the runner with `?s=<ref>`, which the runner page cannot tell from a resume or a deep link, so
// `train_session_started` reported `source: "deeplink", resumed: true` for every new plan, bank and picker session
// (regression: train-session-started-source, WP-I D-I1). The creator notes the ref and its source here; the runner reads
// it when it reports the start. Module state of the tab (a reload or another tab is a real resume), bounded.
import type { SessionSource } from "@repo/contracts/http/train";

const MAX_NOTED = 20;
const created = new Map<string, SessionSource>();

/** Called by the surface that created the session, before it opens the runner. */
export function noteCreatedSession(ref: string, source: SessionSource): void {
  created.delete(ref);
  created.set(ref, source);
  while (created.size > MAX_NOTED) {
    const oldest = created.keys().next().value;
    if (oldest === undefined) break;
    created.delete(oldest);
  }
}

/** The source of a session this tab created, or null (a resume, a deep link, another tab). */
export function createdSessionSource(ref: string): SessionSource | null {
  return created.get(ref) ?? null;
}
