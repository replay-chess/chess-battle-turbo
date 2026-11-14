// The web's Train side effects after a commit (phase-05 plan §7.3 W1 step 6, §7.4, §10.1): the `bank:due_changed`
// emit to the member's other devices and the server event `train_attempts_applied`. Both run inside `after()` and
// never throw: a lost emit costs a live update (other tabs get crossTab, other devices refresh on focus), a lost
// event costs a data point.
//
// The emit is P2's `/internal/emit` body (`{v:1, targets:[{userRef}], event, data, dedupeKey}`) signed by
// internalFetch() with kid `web`; the payload is validated against the CT schema first. The dedupe key is per user
// and minute (`bank:<userRef>:<minute>`), so a burst of flushes is one event. The signature keeps the wall clock (the
// socket's replay window), never the request clock an e2e run may have moved.
import { trainServerEvents } from "@repo/analytics";
import { BankDueChangedEvent } from "@repo/contracts/socket/user";
import { getRouteDeps } from "@/lib/api/context";
import type { Viewer } from "@/lib/auth/viewer";
import { InternalFetchConfigError, internalFetch } from "@/lib/internal/fetch";
import { capOf } from "./badges.server";
import { loadTrainState } from "./day.server";
import { trainDeps, type TrainDeps } from "./db.server";

let fetchImpl: typeof fetch | undefined;

/** Test seam: the transport the emits use; returns a restore function. */
export function setTrainEmitTransport(next: typeof fetch | undefined): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

export type BankDueData = { bankDue: number; dueRaw: number; total: number; nextAt: string | null };

/** The event's counts at `now` (the training state batch: statement (a), the profile and today's counters). */
export async function bankDueNow(viewer: Pick<Viewer, "id" | "onboarding" | "user">, now: Date, deps: TrainDeps = trainDeps()): Promise<BankDueData> {
  const s = await loadTrainState(deps.db, viewer, now);
  const cap = capOf(s.due, s.profile, s.counters);
  return { bankDue: cap.dueShown, dueRaw: cap.dueRaw, total: s.due.total, nextAt: s.due.nextBatchAt ? s.due.nextBatchAt.toISOString() : null };
}

/** `bank:due_changed` to the member's user room. */
export async function emitBankDueChanged(userRef: string, data: BankDueData, now: Date): Promise<boolean> {
  const deps = getRouteDeps();
  const payload = BankDueChangedEvent.safeParse({ v: 1, ...data });
  if (!payload.success) {
    deps.log("warn", "train.emit_invalid", { event: "bank:due_changed" });
    return false;
  }
  try {
    const res = await internalFetch("/internal/emit", {
      body: {
        v: 1,
        targets: [{ userRef }],
        event: "bank:due_changed",
        data: payload.data,
        dedupeKey: `bank:${userRef}:${Math.floor(now.getTime() / 60_000)}`,
      },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) deps.log("warn", "train.emit_refused", { event: "bank:due_changed", status: res.status });
    return res.ok;
  } catch (err) {
    deps.log("warn", "train.emit_failed", {
      event: "bank:due_changed",
      reason: err instanceof InternalFetchConfigError ? err.message : err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

// ── Server telemetry (posthog-node, `distinct_id` = the member's ref; validated against the registry first) ────
type Capturer = {
  capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

type TrainServerEventName = keyof typeof trainServerEvents;
export type TrainEventSink = (event: TrainServerEventName, properties: Record<string, unknown>, distinctId: string) => void;

let capturer: Capturer | null | undefined;
let sink: TrainEventSink | null = null;

/** Test seam: records events instead of sending them; returns a restore function. */
export function setTrainEventSink(next: TrainEventSink | null): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

async function getCapturer(): Promise<Capturer | null> {
  if (capturer !== undefined) return capturer;
  const key = process.env.POSTHOG_PROJECT_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    capturer = null;
    return capturer;
  }
  const { PostHog } = await import("posthog-node");
  capturer = new PostHog(key, { host: process.env.POSTHOG_HOST || "https://us.i.posthog.com", flushAt: 1, flushInterval: 0, disableGeoip: true });
  return capturer;
}

function appEnv(): "local" | "dev" | "test" | "production" {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return env === "dev" || env === "test" || env === "production" ? env : "local";
}

export async function captureTrainServerEvent(event: "train_attempts_applied", props: Record<string, number>, distinctId: string): Promise<void> {
  try {
    const parsed = trainServerEvents[event].safeParse(props);
    if (!parsed.success) return;
    const properties = { ...(parsed.data as Record<string, unknown>), app_env: appEnv() };
    if (sink) {
      sink(event, properties, distinctId);
      return;
    }
    const client = await getCapturer();
    if (!client) return;
    client.capture({ distinctId, event, properties });
    await client.flush();
  } catch {
    // Telemetry never fails a request.
  }
}
