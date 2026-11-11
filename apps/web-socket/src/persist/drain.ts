// The drain (phase-02 plan 7.6 "Drain", 7.11), run on SIGTERM/SIGINT and by `POST /internal/drain`:
//   1. `draining`: no new sessions, no rematch creation (acks answer `draining`);
//   2. every running clock is frozen at the same instant (the reducer journals `freeze` and asks for a checkpoint);
//   3. the journal is fsynced and every outbox flushed (checkpoints in parallel, ≤ 8 at a time), v1 sessions too;
//   4. every queued event leaves its socket (`flushWrites`), then `io.close()`; the caller exits 0.
// Budget ≤ 20 s inside compose's `stop_grace_period: 30s`; whatever is still unwritten after it is in the journal,
// which the next process restores.
import type { Server as HttpServer } from "node:http";
import type { Server } from "socket.io";
import type { SessionRegistry } from "../game/SessionRegistry";
import type { LivePersistence, Logger, Metrics } from "../ports";
import type { V1Runtime } from "../v1/runtime";

export const DRAIN_BUDGET_MS = 20_000;
/** `io.close()` waits for every connection to end; after this long the rest are cut (a peer that never answers the
 * WebSocket close handshake, a proxy holding a keep-alive) so the drain always finishes inside its budget. */
export const CLOSE_CONNECTIONS_AFTER_MS = 2_000;
/** How long the drain waits for the last events (restart notice, frozen clocks) to leave each socket. */
export const FLUSH_WRITES_MAX_MS = 1_000;

export interface DrainDeps {
  registry: SessionRegistry;
  persistence: LivePersistence;
  io: Server;
  /** The HTTP server under `io` (lingering connections are cut after CLOSE_CONNECTIONS_AFTER_MS). */
  httpServer?: HttpServer;
  v1: V1Runtime | null;
  log: Logger;
  metrics: Metrics;
  now(): number;
  budgetMs?: number;
}

export interface DrainReport {
  sessions: number;
  /** False when the budget ran out before every write settled. */
  flushed: boolean;
  ms: number;
}

type EngineConn = { writeBuffer?: unknown[]; once(event: "drain", listener: () => void): unknown };

/**
 * Waits (≤ `maxMs`) until every engine.io connection has handed what is queued for it to its transport.
 *
 * Why: `io.close()` closes each connection with `discard`, which drops the connection's write buffer. A WebSocket
 * transport sends one batch at a time and buffers the rest until the previous `send` completed, so of the events the
 * drain emits in one tick (the restart notice, then the frozen `clock:sync`) only the first left: the players never
 * saw their clocks frozen (found by persistence.test.ts "SIGTERM drain", which fails without this wait).
 *
 * What engine.io's `drain` event guarantees: the connection's write buffer is empty because the transport took every
 * packet (WebSocket: each frame was passed to the socket, so the close that follows is queued after it; polling: the
 * pending GET answered with them). It does NOT mean the client received or processed them, and a polling client with
 * no GET in flight only drains on its next poll, which the `maxMs` cap bounds. Connections are walked on the engine,
 * not per namespace: one engine connection carries every namespace's sockets (the server only uses "/" today) and the
 * v1 sockets too.
 */
export async function flushWrites(io: Server, maxMs: number): Promise<void> {
  const waits: Promise<void>[] = [];
  const clients = (io.engine as unknown as { clients?: Record<string, EngineConn> } | undefined)?.clients ?? {};
  for (const conn of Object.values(clients)) {
    if (conn.writeBuffer && conn.writeBuffer.length > 0) waits.push(new Promise<void>((resolve) => void conn.once("drain", resolve)));
  }
  if (waits.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    Promise.all(waits),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
}

export async function drainSessions(deps: DrainDeps): Promise<DrainReport> {
  const { registry, persistence, io, v1, log, metrics, now } = deps;
  const budgetMs = deps.budgetMs ?? DRAIN_BUDGET_MS;
  const started = now();
  registry.draining = true;
  registry.stop();
  let sessions = 0;
  for (const session of registry.all()) {
    sessions++;
    try {
      session.dispatch({ type: "freeze", reason: "drain" });
    } catch (error) {
      log.error("freeze failed", { game: session.ref }, error);
    }
  }
  const work: Promise<unknown>[] = [];
  if (persistence.flushAll) work.push(persistence.flushAll());
  if (v1) work.push(v1.drain(budgetMs));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flushed = await Promise.race([
    Promise.allSettled(work).then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), budgetMs);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!flushed) log.error("drain budget exhausted; the journal keeps what is unwritten", { op: "drain" });
  await flushWrites(io, FLUSH_WRITES_MAX_MS);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
    closeTimer = setTimeout(() => {
      deps.httpServer?.closeAllConnections();
      resolve();
    }, CLOSE_CONNECTIONS_AFTER_MS);
    closeTimer.unref?.();
  });
  if (closeTimer) clearTimeout(closeTimer);
  registry.destroyAll();
  const ms = now() - started;
  metrics.sample("ws.drain.ms", ms);
  log.info("drained", { sessions, flushed, ms });
  return { sessions, flushed, ms };
}
