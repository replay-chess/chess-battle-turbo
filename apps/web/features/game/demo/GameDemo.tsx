"use client";

// The /dev/ui/game client root (P2 plan 4.9): the real game screen (GameView: bars, board, panel, result card,
// hotkeys, sounds, live regions) over a demo controller fed by one fixture. `debug=1` adds a readout with the
// requested and derived state, the zone, the actions variant, the modifiers and the board size.

import { useState, useSyncExternalStore } from "react";
import type { DesignState } from "@repo/game-core/client/viewState";
import type { Side } from "@repo/game-core/machine/types";
import { GameView } from "../screen/GameView";
import { viewSourceFor } from "../viewState";
import { createDemoController } from "./controller";
import { buildDemoFixture, type DemoMode, type DemoVariant } from "./fixtures";

export type GameDemoProps = {
  state: DesignState;
  side: Side | null;
  mode: DemoMode;
  variant: DemoVariant | null;
  stress: boolean;
  flip: boolean;
  freeze: boolean;
  toasts: "hold" | "auto";
  debug: boolean;
};

export function GameDemo(p: GameDemoProps) {
  const [{ fixture, controller }] = useState(() => {
    const f = buildDemoFixture({ state: p.state, side: p.side, mode: p.mode, variant: p.variant, stress: p.stress });
    return { fixture: f, controller: createDemoController(f, { freeze: p.freeze, toasts: p.toasts }) };
  });
  return (
    <div
      style={{ display: "contents" }}
      data-testid="game-demo"
      data-demo-state={fixture.requested}
      data-demo-derived={fixture.derived}
      data-demo-lit={fixture.lit ? "true" : "false"}
      data-demo-viewer={fixture.viewer}
    >
      <GameView controller={controller} initialFlipped={p.flip} />
      {p.debug ? <DemoReadout controller={controller} requested={fixture.requested} notes={fixture.notes} /> : null}
    </div>
  );
}

const noop = () => () => {};

function boardPx(): number | null {
  const el = document.querySelector('[data-testid="chess-board"]');
  return el ? Math.round(el.getBoundingClientRect().width) : null;
}

function DemoReadout({
  controller,
  requested,
  notes,
}: {
  controller: ReturnType<typeof createDemoController>;
  requested: DesignState;
  notes: string[];
}) {
  const source = viewSourceFor(controller);
  const view = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot);
  // Client only (the board size needs layout): null during the server render and hydration.
  const px = useSyncExternalStore(noop, boardPx, () => null);
  const vw = useSyncExternalStore(noop, () => `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`, () => null);
  if (px === null && vw === null) return null;
  const mods = [...view.modifiers].join(", ") || "none";
  return (
    <output
      data-rc-allow-overflow=""
      data-testid="game-demo-debug"
      className="fixed bottom-2 left-2 z-[var(--cb-z-toast)] max-w-[min(420px,calc(100vw-16px))] border border-cb-border-strong bg-cb-surface px-2 py-1 font-mono text-label tabular-nums text-cb-text shadow-pop"
    >
      <div>
        {requested}
        {view.primary !== requested ? ` → ${view.primary}` : ""} · zone {view.zone || "none"} · actions {view.actions}
      </div>
      <div>
        mods {mods} · {vw} · board {px ?? "?"}px
      </div>
      {notes.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </output>
  );
}
