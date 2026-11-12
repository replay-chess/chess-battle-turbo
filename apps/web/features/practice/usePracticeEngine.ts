"use client";

// Practice's engine (phase-03 plan §4.8, §5.9): P2's shared browser engine (features/engine, the tab's one lazy
// Stockfish worker) through the bot's search helpers (useBotEngine: the Elo ladder rung for the replies, the
// full-strength 300 ms search for hints). It is started on mount with the metered download (engine-load.ts), held while
// the page is open (`retain`), and released on leave (the worker ends 60 s later unless another screen holds it).
// `engine_init {cached, ms, ok}` is P2's event, sent by the shared engine itself.
import { useEffect, useState } from "react";
import { clearEngineCache, getEngine } from "@/features/engine/EngineProvider";
import { engineUrls } from "@/features/engine/manifest";
import { createBotEngine, type BotEngine } from "@/features/game/local/useBotEngine";
import { startEngineWithProgress } from "./engine-load";

export type PracticeEngineStatus = "loading" | "ready" | "failed";

export interface PracticeEngine {
  status: PracticeEngineStatus;
  /** 0–100 while loading. */
  pct: number;
  bot: BotEngine;
  retry(): void;
}

/** The demo's forced states (no worker is started for them). */
export type ForcedEngine = { status: "loading"; pct: number } | { status: "failed" } | null;

export function usePracticeEngine(forced: ForcedEngine = null): PracticeEngine {
  const [bot] = useState(() => createBotEngine(getEngine));
  const [status, setStatus] = useState<PracticeEngineStatus>(forced ? forced.status : "loading");
  const [pct, setPct] = useState(forced?.status === "loading" ? forced.pct : 0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (forced) return;
    const release = bot.retain();
    return release;
  }, [bot, forced]);

  useEffect(() => {
    if (forced) return;
    let live = true;
    const engine = getEngine();
    const run = async () => {
      if (attempt > 0) {
        // Retry: drop the failed worker and the cached engine files, then start over (P2's "Try again").
        engine.reset();
        await clearEngineCache();
      }
      await startEngineWithProgress(engine, engineUrls().wasm, (p) => {
        if (live) setPct(p);
      });
    };
    setStatus("loading");
    run().then(
      () => {
        if (live) setStatus("ready");
      },
      () => {
        if (live) setStatus("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [attempt, forced]);

  return {
    status,
    pct,
    bot,
    retry: () => {
      if (forced) return;
      setPct(0);
      setAttempt((n) => n + 1);
    },
  };
}
