"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const ro = new ResizeObserver(onChange);
  ro.observe(document.documentElement);
  const board = document.querySelector('[data-testid="chess-board"]');
  if (board) ro.observe(board);
  addEventListener("resize", onChange);
  return () => {
    ro.disconnect();
    removeEventListener("resize", onChange);
  };
}

function read(): string {
  const de = document.documentElement;
  const inner = document.querySelector(".rc-stage__in");
  const mode = inner ? getComputedStyle(inner).getPropertyValue("--rc-mode").trim() || "?" : "none";
  const board = document.querySelector('[data-testid="chess-board"]');
  const px = board ? Math.round(board.getBoundingClientRect().width * 10) / 10 : 0;
  const dpr = Math.round(devicePixelRatio * 1000) / 1000;
  return `${de.clientWidth}×${de.clientHeight} · DPR ${dpr} · ${mode} · board ${px}px`;
}

/** `debug=1` readout (SPEC 10.4): client only, rendered after hydration. */
export function DebugReadout() {
  const text = useSyncExternalStore(subscribe, read, () => null);
  if (text == null) return null;
  return (
    <output
      data-rc-allow-overflow=""
      data-testid="stage-debug"
      className="fixed right-2 bottom-2 z-[var(--cb-z-toast)] border border-cb-border-strong bg-cb-surface px-2 py-1 font-mono text-label tabular-nums text-cb-text shadow-pop"
    >
      {text}
    </output>
  );
}
