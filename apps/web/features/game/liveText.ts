// The text of one screen-reader live region (P2 plan 4.4 LiveRegions, WCAG 4.1.3). A message stays only long enough
// to be read, then the region empties: a region that keeps its last message holds stale text for anyone who reads
// the page later ("Connection lost. Reconnecting." was still there a minute after the game was back: dev recheck
// 2026-11-12). Emptying a region is not announced. A message equal to the one still shown alternates a trailing
// no-break space so it is announced again.

export const LIVE_HOLD_MS = 5_000;
const NBSP = " ";

export interface LiveText {
  say(text: string): void;
  dispose(): void;
}

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createLiveText(set: (text: string) => void, holdMs = LIVE_HOLD_MS, timers: Timers = realTimers): LiveText {
  let shown = "";
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  return {
    say(text) {
      if (!text) return;
      shown = shown === text ? `${text}${NBSP}` : text;
      set(shown);
      stop();
      timer = timers.setTimeout(() => {
        timer = null;
        shown = "";
        set("");
      }, holdMs);
    },
    dispose: stop,
  };
}
