// The demo controller (P2 plan 4.9): renders a fixture store with no server. Time starts at the fixture's server
// clock and runs in real time (or stays frozen with `freeze`), so clocks, study and grace countdowns move as in a
// live game and Playwright's page.clock controls them. Commands act locally so the optimistic states can be clicked
// through: a move is played on the board, offers and answers go through the client reducer (their socket sends
// are dropped), resign/abort close their confirmation. Toasts stay up (toast-led states would otherwise return to
// their base state after 4 s) unless `toasts: "auto"`.

import { applyMoveToState } from "@repo/game-core/client/reducer";
import type { ClientAction, Out } from "@repo/game-core/client/reducer";
import type { BoardMove } from "@/components/board/types";
import type { GameController } from "../controller";
import { createGameStore } from "../store";
import type { DemoFixture } from "./fixtures";

export interface DemoControllerOptions {
  freeze?: boolean;
  toasts?: "hold" | "auto";
  /** Wall clock at creation (tests pass a fixed value). */
  startedAt?: number;
}

export function createDemoController(f: DemoFixture, opts: DemoControllerOptions = {}): GameController {
  const g = f.game;
  const store = createGameStore(g.state, { joined: g.joined, conn: g.conn, bot: g.bot !== null, now: f.serverNow });
  store.setState(g, true);
  const startedAt = opts.startedAt ?? Date.now();
  const serverNow = opts.freeze ? () => f.serverNow : () => f.serverNow + (Date.now() - startedAt);

  const raw = store.dispatch;
  const hold = (opts.toasts ?? "hold") === "hold";
  store.dispatch = (a: ClientAction): Out[] => (hold && a.type === "toastClear" ? [] : raw(a));
  const act = (a: ClientAction) => {
    store.dispatch(a);
  };
  const now = () => serverNow();

  const bot = g.bot !== null;
  const controller: GameController = {
    kind: "demo",
    store,
    serverNow,
    move(m: BoardMove) {
      const cur = store.getState();
      const r = applyMoveToState(cur.state, m.uci);
      if (!r) {
        act({ type: "illegal", from: m.from, to: m.to, now: now() });
        return;
      }
      const t = now();
      const s = cur.state;
      const mover = s.turn;
      const clocks =
        s.clocks.run === mover
          ? {
              ...s.clocks,
              [mover]: Math.max(0, s.clocks[mover] - (t - s.clocks.at)) + (s.tc?.incrementMs ?? 0),
              run: r.state.turn,
              at: t,
            }
          : s.clocks;
      store.setState(
        {
          ...cur,
          state: { ...r.state, clocks, drawOffer: null },
          selected: null,
          promotion: null,
          premove: null,
          view: null,
          toast: null,
          animate: true,
        },
        true,
      );
    },
    setPremove(m) {
      if (m) act({ type: "premove", uci: m.uci, now: now() });
      else act({ type: "premove", uci: null, now: now(), reason: "cancelled" });
    },
    ready: () => act({ type: "ready", now: now() }),
    abort: () => act({ type: "abort", now: now() }),
    resign: () => act({ type: "resign", open: false }),
    offerDraw: () => act({ type: "drawOffer", now: now() }),
    answerDraw: (accept) => act({ type: "drawAnswer", accept, now: now() }),
    offerRematch: () => act({ type: "rematchOffer", now: now(), serverNow: now() }),
    answerRematch: (accept) => act({ type: "rematchAnswer", accept, now: now() }),
    cancelRematch: () => act({ type: "rematchCancel", now: now() }),
    sync: () => {},
    destroy: () => {},
  };
  if (bot) {
    // Bot CTAs and buttons render only when the controller has them (Restart, Hint, Undo).
    controller.hint = () => {
      const level = store.getState().bot?.hint?.level === 1 ? 2 : 1;
      act({
        type: "bot",
        patch: {
          hint: {
            level,
            text: level === 1 ? "Hint 1 of 2: look at your king." : "Hint 2 of 2: castle long, O-O-O.",
            arrow: level === 2 ? { from: "e1", to: "c1", color: "green" } : null,
          },
        },
      });
    };
    controller.undo = () => {};
    controller.restart = () => {};
  }
  return controller;
}
