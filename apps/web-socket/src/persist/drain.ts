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
 * Waits (≤ `maxMs`) until every socket sent what is queued for it. `io.close()` closes each engine.io connection with
 * `discard`, dropping its write buffer: only the packet already in flight survived, so with a fast flush the frozen
 * `clock:sync` after the restart notice never reached the players.
 */
export async function flushWrites(io: Server, maxMs: number): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const socket of io.sockets.sockets.values()) {
    const conn = socket.conn as unknown as EngineConn;
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
