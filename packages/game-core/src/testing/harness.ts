// A deterministic in-memory "server + clients" harness: the server machine (`reduce`) and one client store per
// viewer (White, Black, a spectator) wired the way the socket wires them (game-room events to players,
// spectate-room events to spectators, acks to the sender). It records, per viewer, every step the client store
// received, so a scenario can be exported as a golden transcript (plan 12.3) and replayed by `replayTranscript`.
// Used by the game-core tests, scripts/gen-transcripts.ts and (optionally) WEB's /dev/ui/game demo fixtures.

import { createGame, projectState, type CreateGameInput } from "../machine/create";
import { reduce } from "../machine/reduce";
import {
  DEFAULT_MACHINE_CONFIG,
  type MachineConfig,
  type MachineInput,
  type ReduceResult,
  type ServerGame,
} from "../machine/state";
import type { Ack, GameState, ServerEvent, Side } from "../machine/types";
import {
  createClientGame,
  reduceClient,
  type ClientAction,
  type ClientGame,
  type Command,
  type Out,
} from "../client/reducer";
import { deriveViewState, type DesignState, type ViewState } from "../client/viewState";

export type ViewerId = "w" | "b" | "spect";
export type TranscriptStep = { t: number; event: ServerEvent } | { t: number; action: ClientAction };

export interface ClientTranscript {
  v: 1;
  /** The design state this transcript reaches (plan 4.3). */
  state: DesignState;
  viewer: { role: "player" | "spectator"; color?: Side };
  /** Epoch ms the offsets are relative to. */
  t0: number;
  /** False only for `loading` (the join ack never arrived). */
  joined: boolean;
  /** The join-ack (or RSC) state the client started from. */
  initial: GameState;
  steps: TranscriptStep[];
  /** Offset of the server clock used to derive the view. */
  serverNow: number;
  expect: {
    primary: DesignState;
    zone: ViewState["zone"];
    actions: ViewState["actions"];
    bar: ViewState["bar"];
    toast: string | null;
  };
  /** The server inputs (socket commands, presence, timers) that produced the events, for the server-side replay. */
  commands: { t: number; input: MachineInput }[];
}

const viewerOf = (id: ViewerId): { role: "player" | "spectator"; color?: Side } =>
  id === "spect" ? { role: "spectator" } : { role: "player", color: id };

export class Harness {
  server: ServerGame;
  now: number;
  readonly t0: number;
  readonly clients: Partial<Record<ViewerId, ClientGame>> = {};
  readonly steps: Record<ViewerId, TranscriptStep[]> = { w: [], b: [], spect: [] };
  readonly initial: Partial<Record<ViewerId, GameState>> = {};
  readonly commands: { t: number; input: MachineInput }[] = [];
  last: ReduceResult | null = null;
  private seqId = 0;

  constructor(
    input: CreateGameInput,
    t0 = 1_700_000_000_000,
    readonly config: MachineConfig = DEFAULT_MACHINE_CONFIG,
  ) {
    this.t0 = t0;
    this.now = t0;
    this.server = createGame(input, t0);
  }

  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  /** Runs one server input and delivers its events to the joined viewers. */
  serve(input: MachineInput): ReduceResult {
    this.commands.push({ t: this.now - this.t0, input });
    const r = reduce(this.server, input, this.now, this.config);
    this.server = r.state;
    this.last = r;
    for (const e of r.events) {
      const targets: ViewerId[] = e.room === "game" ? ["w", "b"] : ["spect"];
      for (const v of targets) if (this.clients[v]) this.deliver(v, e.event);
    }
    return r;
  }

  private deliver(v: ViewerId, event: ServerEvent): void {
    this.apply(v, { type: "event", event, now: this.now });
  }

  /** Applies a client action to one viewer and records it. Returns the outgoing effects. */
  apply(v: ViewerId, action: ClientAction): Out[] {
    const store = this.clients[v];
    if (!store) throw new Error(`viewer ${v} has not joined`);
    const step: TranscriptStep =
      action.type === "event" ? { t: this.now - this.t0, event: action.event } : { t: this.now - this.t0, action };
    this.steps[v].push(step);
    const r = reduceClient(store, action);
    this.clients[v] = r.store;
    return r.out;
  }

  /** The viewer connects and its join ack replaces the store (players attach to the game first). */
  join(v: ViewerId, opts: { attach?: boolean; joined?: boolean } = {}): this {
    if (v !== "spect" && opts.attach !== false)
      this.serve({ type: "attach", side: v, socketId: `${v}-${++this.seqId}` });
    const state = projectState(this.server, viewerOf(v), this.now);
    this.initial[v] = state;
    this.clients[v] = createClientGame(state, { now: this.now, conn: "live", joined: false });
    if (opts.joined !== false) this.apply(v, { type: "replace", state, reason: "join", now: this.now });
    return this;
  }

  /** Both players join; the spectator too unless `spect: false`. */
  joinAll(opts: { spect?: boolean } = {}): this {
    this.join("w").join("b");
    if (opts.spect !== false) this.join("spect");
    return this;
  }

  /** A player's own move through the client (optimistic) and the server (ack). */
  move(side: Side, uci: string): Ack<Record<string, unknown>> | undefined {
    const clientMoveId = `cm-${side}-${++this.seqId}`;
    const out = this.apply(side, { type: "move", uci, clientMoveId, now: this.now, serverNow: this.now });
    const send = out.find((o): o is Extract<Out, { type: "send" }> => o.type === "send" && o.cmd === "game:move");
    if (!send) {
      // Not sent (outbox while offline, illegal, promotion picker): the server never sees it.
      return undefined;
    }
    const p = send.payload as { ply: number; uci: string; clientMoveId: string; premove: boolean };
    const ack = this.serve({
      type: "move",
      side,
      ply: p.ply,
      uci: p.uci,
      clientMoveId: p.clientMoveId,
      premove: p.premove,
    });
    if (ack.ack) this.apply(side, { type: "moveAck", clientMoveId: p.clientMoveId, ack: ack.ack, now: this.now });
    return ack.ack;
  }

  /** A player's command through the client (optimistic) and the server, with the ack fed back. */
  command(
    side: Side,
    action: ClientAction,
    cmd: Command,
    input: MachineInput,
  ): Ack<Record<string, unknown>> | undefined {
    const out = this.apply(side, action);
    if (!out.some((o) => o.type === "send")) return undefined; // the client refused it locally
    const ack = this.serve(input).ack;
    if (ack) this.apply(side, { type: "cmdAck", cmd, ack, now: this.now });
    return ack;
  }

  /** Delivers outgoing `send`s produced by a client action (e.g. a premove firing) to the server. */
  flush(side: Side, out: Out[]): void {
    for (const o of out) {
      if (o.type !== "send" || o.cmd !== "game:move") continue;
      const p = o.payload as { ply: number; uci: string; clientMoveId: string; premove: boolean };
      const r = this.serve({
        type: "move",
        side,
        ply: p.ply,
        uci: p.uci,
        clientMoveId: p.clientMoveId,
        premove: p.premove,
      });
      if (r.ack) this.apply(side, { type: "moveAck", clientMoveId: p.clientMoveId, ack: r.ack, now: this.now });
    }
  }

  view(v: ViewerId, serverNow = this.now): ViewState {
    const store = this.clients[v];
    if (!store) throw new Error(`viewer ${v} has not joined`);
    return deriveViewState(store, serverNow);
  }

  store(v: ViewerId): ClientGame {
    const s = this.clients[v];
    if (!s) throw new Error(`viewer ${v} has not joined`);
    return s;
  }

  transcript(v: ViewerId, state: DesignState, serverNow = this.now): ClientTranscript {
    const view = this.view(v, serverNow);
    const store = this.store(v);
    return {
      v: 1,
      state,
      viewer: viewerOf(v),
      t0: this.t0,
      joined: store.joined,
      initial: this.initial[v]!,
      steps: this.steps[v],
      serverNow: serverNow - this.t0,
      expect: {
        primary: view.primary,
        zone: view.zone,
        actions: view.actions,
        bar: view.bar,
        toast: view.toast?.code ?? null,
      },
      commands: this.commands,
    };
  }
}

/** Replays a client transcript (plan 12.3, the client half): same events in, same design state out. */
export function replayTranscript(t: ClientTranscript): { store: ClientGame; view: ViewState } {
  let store = createClientGame(t.initial, { now: t.t0, conn: "live", joined: false });
  for (const step of t.steps) {
    const now = t.t0 + step.t;
    const action: ClientAction = "event" in step ? { type: "event", event: step.event, now } : step.action;
    store = reduceClient(store, action).store;
  }
  return { store, view: deriveViewState(store, t.t0 + t.serverNow) };
}
