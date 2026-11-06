// The clock store (P2 plan 5.2.1, 5.2.7): a separate external store so a running clock never re-renders the
// screen. One requestAnimationFrame loop runs while a clock is running and the tab is visible; only the two
// ClockChips subscribe, and each is notified only when its own text or tone changes (tenths under 10 s).
//
// remaining(side) = clocks[side] − (clocks.run === side ? serverNow − clocks.at : 0), clamped at 0. The client
// never flags on its own; it shows 0:00 and waits for `game:ended`.

import { remaining } from "@repo/game-core/clock/clock";
import { clockTone, formatClock, type ClockTone } from "@repo/game-core/clock/format";
import { LOW_TIME_MS } from "@repo/game-core/constants";
import type { Side } from "@repo/game-core/machine/types";
import type { GameController } from "../controller";

export interface ClockView {
  /** "4:01", "0:09.6", "STUDY", or "–" for untimed games. */
  text: string;
  ms: number;
  tone: ClockTone;
  running: boolean;
  /** Not started, frozen, or the study phase: the digits read muted. */
  idle: boolean;
  low: boolean;
}

export interface ClockSource {
  subscribe(side: Side, listener: () => void): () => void;
  get(side: Side): ClockView;
  /** Deterministic value for the server render and hydration: the clocks at the snapshot's own `serverNow`. */
  initial(side: Side): ClockView;
}

const sources = new WeakMap<GameController, ClockSource>();

export function clockSourceFor(controller: GameController): ClockSource {
  const existing = sources.get(controller);
  if (existing) return existing;

  const { store } = controller;
  const snapNow = store.getState().state.serverNow;
  const initial: Record<Side, ClockView> = { w: compute("w", snapNow), b: compute("b", snapNow) };
  const views: Record<Side, ClockView> = { ...initial };
  const listeners: Record<Side, Set<() => void>> = { w: new Set(), b: new Set() };
  let raf: number | null = null;
  let unsubStore: (() => void) | null = null;
  let unsubVis: (() => void) | null = null;

  function compute(side: Side, at: number = controller.serverNow()): ClockView {
    const s = store.getState().state;
    if (!s.tc) return { text: "–", ms: Infinity, tone: "default", running: false, idle: true, low: false };
    if (s.phase === "study") return { text: "STUDY", ms: s.clocks[side], tone: "default", running: false, idle: true, low: false };
    const running = s.phase === "playing" && !s.frozen && s.clocks.run === side;
    const ms = running ? remaining(s.clocks, side, at) : Math.max(0, s.clocks[side]);
    const idle = !running && (s.frozen !== null || s.clocks.run === null || s.phase !== "playing");
    return { text: formatClock(ms), ms, tone: clockTone(ms, running), running, idle, low: running && ms < LOW_TIME_MS };
  }

  function refresh(): boolean {
    let anyRunning = false;
    for (const side of ["w", "b"] as const) {
      const next = compute(side);
      const prev = views[side];
      anyRunning ||= next.running;
      if (next.text !== prev.text || next.tone !== prev.tone || next.running !== prev.running || next.idle !== prev.idle) {
        views[side] = next;
        for (const l of listeners[side]) l();
      } else {
        views[side] = { ...prev, ms: next.ms };
      }
    }
    return anyRunning;
  }

  function hasListeners(): boolean {
    return listeners.w.size + listeners.b.size > 0;
  }

  function loop(): void {
    raf = null;
    const anyRunning = refresh();
    if (anyRunning && hasListeners() && !hidden()) raf = requestAnimationFrame(loop);
  }

  function kick(): void {
    if (raf !== null || typeof requestAnimationFrame === "undefined") {
      refresh();
      return;
    }
    loop();
  }

  function start(): void {
    unsubStore = store.subscribe(kick);
    if (typeof document !== "undefined") {
      const onVis = () => kick();
      document.addEventListener("visibilitychange", onVis);
      unsubVis = () => document.removeEventListener("visibilitychange", onVis);
    }
    kick();
  }

  function stop(): void {
    unsubStore?.();
    unsubVis?.();
    unsubStore = null;
    unsubVis = null;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  const source: ClockSource = {
    subscribe(side, listener) {
      const first = !hasListeners();
      listeners[side].add(listener);
      if (first) start();
      return () => {
        listeners[side].delete(listener);
        if (!hasListeners()) stop();
      };
    },
    get(side) {
      return views[side];
    },
    initial(side) {
      return initial[side];
    },
  };
  sources.set(controller, source);
  return source;
}

function hidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}
