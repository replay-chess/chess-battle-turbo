"use client";

// The browser engine (phase-02 plan 5.3.2, 9.5, 13.1 WP-H): one lazy Stockfish 18 lite worker per tab, shared by
// every bot game the tab opens. Only the bot game chunk imports this file (BotGameScreen → useLocalGame), so PvP
// and spectator pages never download the engine; nothing is fetched until a bot game calls `init()` or a search.
//
// The worker is the same-origin shim /workers/engine-shim.js (manifest.ts), which loads the hashed engine from R2
// (NEXT_PUBLIC_ENGINE_BASE_URL) or the origin copy. If the R2 attempt fails as a whole, init retries once with the
// origin copy only. `engine_init {cached, ms, ok, elo_floor, source}` is sent once per init chain; a failure is
// also reported to Sentry. The worker is terminated 60 s after the last bot game released it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import type { EventProps } from "@repo/analytics";
import { trackGame } from "@/lib/analytics/game-events";
import { ENGINE_HASH, ENGINE_SW_CACHE, engineUrls, remoteBase } from "./manifest";
import { createEngineClient, type EngineAttempt, type EngineClient, type EngineInitInfo } from "./uci";

/** Idle time after the last release before the worker is terminated. */
export const ENGINE_IDLE_TERMINATE_MS = 60_000;

/** Client telemetry for the engine and bot assists (plan 10.1). Never throws; never sends FEN or moves. */
export function trackEngineEvent<N extends "engine_init" | "hint_used" | "undo_used">(name: N, props: EventProps<N>): void {
  trackGame(name, props);
}

/** The shim attempts for this build: R2 first when configured, then the same-origin copy. */
export function engineAttempts(): EngineAttempt[] {
  const remote = remoteBase(undefined, ENGINE_HASH);
  const origin = engineUrls({ remote: null });
  if (!remote) return [{ url: origin.worker, source: "origin" }];
  return [{ url: engineUrls({ remote }).worker, source: "r2" }, { url: origin.worker, source: "origin" }];
}

function spawnWorker(url: string, events: { line(l: string): void; meta(m: Record<string, unknown>): void; error(e: unknown): void }) {
  const w = new Worker(url, { name: "rc-engine" });
  w.onmessage = (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d === "string") events.line(d);
    else if (d && typeof d === "object" && (d as { rc?: unknown }).rc === "engine-init") events.meta(d as Record<string, unknown>);
  };
  w.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    events.error(new Error(e.message || "engine worker error"));
  };
  w.onmessageerror = () => events.error(new Error("engine worker message error"));
  return { post: (c: string) => w.postMessage(c), terminate: () => w.terminate() };
}

export interface SharedEngine extends EngineClient {
  /** Keeps the worker alive while a bot game is open; returns the release. */
  retain(): () => void;
  /** Clears a failure, drops the engine files from the Service Worker cache and starts over ("Try again"). */
  retry(): Promise<EngineInitInfo>;
}

function createSharedEngine(): SharedEngine {
  const client = createEngineClient({
    spawn: spawnWorker,
    attempts: engineAttempts,
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    onInit: (r) => {
      if (r.ok) {
        trackEngineEvent("engine_init", {
          ok: true,
          cached: r.info.cached,
          ms: r.info.ms,
          elo_floor: r.info.eloFloor,
          source: r.info.source,
        });
      } else {
        trackEngineEvent("engine_init", { ok: false, cached: false, ms: r.ms, elo_floor: null, source: r.source });
        Sentry.captureException(r.error, { tags: { area: "engine", engine_hash: ENGINE_HASH } });
      }
    },
  });
  let holds = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  return {
    ...client,
    retain() {
      holds++;
      if (idle) {
        clearTimeout(idle);
        idle = null;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
        if (holds === 0) {
          idle = setTimeout(() => {
            idle = null;
            if (holds === 0) client.dispose();
          }, ENGINE_IDLE_TERMINATE_MS);
        }
      };
    },
    async retry() {
      client.reset();
      await clearEngineCache();
      return client.init();
    },
  };
}

/** Best effort: removes the engine entries from the Service Worker cache (plan 4.7 "clears the cache entry"). */
export async function clearEngineCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(ENGINE_SW_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.filter((r) => r.url.includes("/sf18-")).map((r) => cache.delete(r)));
  } catch {
    // no Cache Storage (private mode, insecure origin)
  }
}

let shared: SharedEngine | null = null;

/** The tab's engine. Creating it starts nothing: the worker spawns on the first `init()` or search. */
export function getEngine(): SharedEngine {
  if (typeof window === "undefined") throw new Error("getEngine() is browser-only");
  shared ??= createSharedEngine();
  return shared;
}

const EngineContext = createContext<SharedEngine | null>(null);

/**
 * Optional provider for screens that want the engine through context (P3/P8 analysis surfaces reuse it). It
 * holds the worker while mounted; bot games use `getEngine()` through useBotEngine and do not need it.
 */
export function EngineProvider({ children, warm = false }: { children: ReactNode; warm?: boolean }) {
  const [engine, setEngine] = useState<SharedEngine | null>(null);
  useEffect(() => {
    const e = getEngine();
    const release = e.retain();
    setEngine(e);
    if (warm) void e.init().catch(() => {});
    return release;
  }, [warm]);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** The engine from the nearest EngineProvider (null until it mounted on the client). */
export function useEngine(): SharedEngine | null {
  return useContext(EngineContext);
}
