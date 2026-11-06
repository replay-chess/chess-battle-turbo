// Client half of the golden socket transcripts (plan 12.3): replays a transcript in WP-C's format
// (PKG/contracts/src/socket/test/transcript.ts, files in PKG/chess-fixtures/socket/transcripts/<state>.json) for one
// role through the client reducer and derives the design state. The server half (WP-D) replays the same commands
// against an in-process server. Plain types here: game-core does not depend on zod or contracts.

import { createClientGame, reduceClient, type ClientAction, type ClientGame, type Command } from "../client/reducer";
import { deriveViewState, type ViewState } from "../client/viewState";
import type { Ack, GameState, ServerEvent } from "../machine/types";

export type GoldenRole = "w" | "b" | "spectator";

export type GoldenStep =
  | { t: number; actor: GoldenRole; snapshot: GameState }
  | { t: number; actor: GoldenRole; send: string; payload: unknown; ack: unknown }
  | { t: number; to: GoldenRole[]; event: string; payload: unknown }
  | { t: number; actor: GoldenRole; local: string; args?: Record<string, unknown> };

export interface GoldenExpectation {
  primary: string;
  modifiers?: string[];
  zone?: string | null;
  actions?: string;
  toast?: string | null;
}

export interface GoldenTranscript {
  format: 1;
  state: string;
  status: "skeleton" | "golden";
  t0: number;
  expect: Partial<Record<GoldenRole, GoldenExpectation>>;
  steps: GoldenStep[];
  todo?: string[];
}

const OPTIMISTIC: Partial<Record<string, (now: number) => ClientAction>> = {
  "study:ready": (now) => ({ type: "ready", now }),
  "draw:offer": (now) => ({ type: "drawOffer", now }),
  "draw:accept": (now) => ({ type: "drawAnswer", accept: true, now }),
  "draw:decline": (now) => ({ type: "drawAnswer", accept: false, now }),
  "rematch:offer": (now) => ({ type: "rematchOffer", now, serverNow: now }),
  "rematch:accept": (now) => ({ type: "rematchAnswer", accept: true, now }),
  "rematch:decline": (now) => ({ type: "rematchAnswer", accept: false, now }),
  "rematch:cancel": (now) => ({ type: "rematchCancel", now }),
  "game:resign": (now) => ({ type: "confirmResign", now }),
  "game:abort": (now) => ({ type: "abort", now }),
};

/** Replays the transcript for `role`; returns the final store and view (derived at the last step's time). */
export function replayGolden(
  tr: GoldenTranscript,
  role: GoldenRole,
): { store: ClientGame | null; view: ViewState | null } {
  let store: ClientGame | null = null;
  let clockShift = 0;
  let lastNow = tr.t0;
  const act = (a: ClientAction) => {
    if (store) store = reduceClient(store, a).store;
  };
  for (const step of tr.steps) {
    const now = tr.t0 + step.t + clockShift;
    lastNow = now;
    if ("snapshot" in step) {
      if (step.actor === role)
        store = createClientGame(step.snapshot, {
          now,
          conn: "connecting",
          joined: false,
          bot: step.snapshot.mode === "BOT",
        });
      if (store && step.actor === role && step.snapshot.mode === "BOT")
        act({ type: "replace", state: step.snapshot, reason: "local", now });
      continue;
    }
    if ("event" in step) {
      if (step.to.includes(role) && store)
        act({ type: "event", event: { name: step.event, payload: step.payload } as ServerEvent, now });
      continue;
    }
    if (step.actor !== role) continue;
    if ("local" in step) {
      const a = step.args ?? {};
      const uci = typeof a.uci === "string" ? a.uci : "";
      switch (step.local) {
        case "disconnect":
          act({ type: "conn", conn: "reconnecting", now });
          break;
        case "reconnect":
          act({ type: "conn", conn: "live", now });
          break;
        case "advance":
          clockShift += Number(a.ms ?? 0);
          lastNow = now + Number(a.ms ?? 0);
          break;
        case "select":
          act({ type: "select", square: String(a.square ?? "") || null });
          break;
        case "premove":
          act({ type: "premove", uci, now });
          break;
        case "cancel_premove":
          act({ type: "premove", uci: null, now, reason: "cancelled" });
          break;
        case "drop_illegal":
          act({ type: "illegal", from: uci.slice(0, 2), to: uci.slice(2, 4), now });
          break;
        case "promotion_open":
          act({ type: "promotion", open: { from: uci.slice(0, 2), to: uci.slice(2, 4) } });
          break;
        case "promotion_cancel":
          act({ type: "promotion", open: null, cancelled: true });
          break;
        case "view_ply":
          act({ type: "view", ply: Number(a.ply ?? 0) });
          break;
        case "back_to_live":
          act({ type: "view", ply: null });
          break;
        case "open_resign_confirm":
          act({ type: "resign", open: true });
          break;
        case "ack_timeout":
        case "sync_failed":
          act({ type: "syncFailed", now });
          break;
      }
      continue;
    }
    // A command (and its ack) sent by this role.
    const ack = step.ack as (Ack<Record<string, unknown>> & { state?: GameState }) | null;
    if (step.send === "game:join" || step.send === "spectate:join" || step.send === "game:sync") {
      const state = ack && ack.ok ? (ack as unknown as { state: GameState }).state : null;
      if (!store) {
        const seed = state ?? null;
        if (!seed) continue;
        store = createClientGame(seed, { now, conn: "live", joined: false });
      }
      if (state) act({ type: "replace", state, reason: step.send === "game:sync" ? "sync" : "join", now });
      continue;
    }
    if (!store) continue;
    if (step.send === "game:move") {
      const p = step.payload as { uci: string; clientMoveId: string; premove?: boolean };
      const s: ClientGame = store;
      // A premove is sent by the reducer itself after the opponent's move; only its ack is fed here.
      const id = p.premove && s.pending ? s.pending.clientMoveId : p.clientMoveId;
      if (!p.premove) act({ type: "move", uci: p.uci, clientMoveId: p.clientMoveId, now, serverNow: now });
      if (ack) act({ type: "moveAck", clientMoveId: id, ack: ack as Ack<Record<string, unknown>>, now });
      continue;
    }
    const optimistic = OPTIMISTIC[step.send];
    if (optimistic) {
      act(optimistic(now));
      if (ack) act({ type: "cmdAck", cmd: step.send as Command, ack: ack as Ack<Record<string, unknown>>, now });
    }
  }
  return { store, view: store ? deriveViewState(store, lastNow) : null };
}
