// The socket binding of a live game (P2 plan 5.2.2–5.2.8): the room join (re-run after every reconnect), event
// handlers with per-game `seq` checking (in the reducer), acked commands, the resync path (`game:sync` is the only
// recovery path; 3 failures → `server_error`), clock pings, and the effects the reducer asks for.
// Framework-free so it can be driven by tests; useLiveGame.ts wraps it in a React hook.

import type { ClientAction, Command, Out } from "@repo/game-core/client/reducer";
import { CLIENT_PING_EVERY_MS } from "@repo/game-core/constants";
import type { GameState, ServerEvent, ServerEventName } from "@repo/game-core/machine/types";
import type { BoardMove } from "@/components/board/types";
import { getRealtime, type RealtimeConnection } from "@/lib/realtime/connection";
import { loadFrameValidator, type FrameValidator } from "@/lib/realtime/validate.dev";
import { ServerClock } from "../clock/serverClock";
import type { GameController } from "../controller";
import { createGameStore, nextClientMoveId, type GameStore } from "../store";
import { withTelemetry } from "../telemetryLazy";

/** Server events of the game and spectate rooms (plan 7.4.5). `session:hello` is handled by the connection. */
export const GAME_EVENT_NAMES: readonly ServerEventName[] = [
  "game:snapshot",
  "game:phase",
  "study:ready",
  "move:applied",
  "clock:sync",
  "presence:update",
  "draw:offered",
  "draw:declined",
  "draw:cancelled",
  "game:ended",
  "game:result",
  "rematch:offered",
  "rematch:declined",
  "rematch:cancelled",
  "rematch:expired",
  "rematch:started",
  "spectators:update",
  "game:error",
  "server:restarting",
];

/** Join failures the screen handles outside the store. */
export type JoinFailure = "not_found" | "forbidden" | "not_member";

export interface LiveDeps {
  navigate(to: string): void;
  /** A hard reload of the route (the second step of "Reload game"). */
  refresh(): void;
  onJoinFailure(code: JoinFailure): void;
  /** Called once when the game ends while this page is open (plan 5.2.9). */
  onEnded?(ref: string): void;
  /** Defaults to the tab singleton. */
  realtime?: () => RealtimeConnection | null;
}

const JOIN_RETRY_MS = 2_000;
/**
 * Joins get a longer ack timeout than other commands (5 s): a restarted server holds them behind its boot restore
 * (plan 7.6, one Neon round trip per restored game from Mumbai), and a join answered late is still the snapshot the
 * player needs at once; a timed-out join is retried (`round`).
 */
export const JOIN_TIMEOUT_MS = 15_000;
/** A `rate_limited` move is resent at most this many times, each after the limiter's `retryAfterMs` (capped). */
const MOVE_RATE_RETRIES = 3;
const MOVE_RETRY_MAX_MS = 1_000;

export interface LiveController extends GameController {
  kind: "live";
  /** Binds the socket (acquire, handlers, room); returns the unbind. Idempotent per call pair (StrictMode). */
  attach(): () => void;
}

/** Refs of rematches this tab accepted (client navigation keeps the module; a reload forgets, which is harmless). */
const acceptedRematches = new Set<string>();

export function createLiveController(snapshot: GameState, deps: LiveDeps): LiveController {
  const ref = snapshot.ref;
  const spectator = snapshot.you.role === "spectator";
  const clock = new ServerClock();
  clock.seed(snapshot.serverNow, Date.now());
  const rtOf = deps.realtime ?? getRealtime;
  const store: GameStore = createGameStore(snapshot, {
    joined: false,
    conn: "connecting",
    now: Date.now(),
    acceptedRematch: acceptedRematches.has(ref),
  });
  let validator: FrameValidator | null = null;
  let detach: (() => void) | null = null;
  let endedNotified = snapshot.phase === "ended";
  let viewed = false;
  let spectateLeft: (() => void) | null = null;
  let spectateStarted = false;
  let syncing = false;
  // One join round per (re)connect: `round` counts the room's join callbacks, `joinedRound` is the last round whose
  // join was answered. The store's `joined` stays true after the first join, so it cannot tell a re-join after a
  // reconnect that timed out (a restarted server holds joins until its restore finishes, which can take longer than
  // the 5 s command timeout) from one that succeeded; that player then kept the pre-restart state ("Disconnected",
  // frozen clocks) for good (INTEGRATE-2 restart smoke).
  let round = 0;
  let joinedRound = 0;

  const dispatch = (a: ClientAction) => run(store.dispatch(a));

  function run(outs: Out[]): void {
    for (const o of outs) {
      if (o.type === "send") send(o.cmd, o.payload);
      else if (o.type === "sync") void doSync();
      else {
        // The new game's page reads this to know that this tab accepted the rematch (no "X accepted" toast there).
        if (o.acceptedRematch) acceptedRematches.add(o.to.slice(o.to.lastIndexOf("/") + 1));
        deps.navigate(o.to);
      }
    }
  }

  function send(cmd: Command, payload: Record<string, unknown>): void {
    const rt = rtOf();
    if (!rt) return;
    if (cmd === "game:move") {
      const clientMoveId = String(payload.clientMoveId);
      // A move refused with `rate_limited` (the per-socket bucket, plan 7.4.8) is resent once the limiter allows it,
      // while it is still the pending move: dropping it rolled the move back without a word (REGRESSION-2: fast
      // play and premove chains lost a move to a 92 ms retry window).
      const attempt = (left: number) =>
        rt.command("game:move", payload as never).then(
          (ack) => {
            const a = ack as { ok: boolean; code?: string; retryAfterMs?: number };
            if (!a.ok && a.code === "rate_limited" && left > 0 && store.getState().pending?.clientMoveId === clientMoveId) {
              const wait = Math.min(MOVE_RETRY_MAX_MS, Math.max(0, a.retryAfterMs ?? MOVE_RETRY_MAX_MS));
              setTimeout(() => {
                if (store.getState().pending?.clientMoveId === clientMoveId && rtOf()) void attempt(left - 1);
                else dispatch({ type: "moveAck", clientMoveId, ack: ack as never, now: Date.now() });
              }, wait);
              return;
            }
            dispatch({ type: "moveAck", clientMoveId, ack: ack as never, now: Date.now() });
          },
          () => dispatch({ type: "moveTimeout", clientMoveId }),
        );
      void attempt(MOVE_RATE_RETRIES);
      return;
    }
    rt.command(cmd, payload as never).then(
      (ack) => dispatch({ type: "cmdAck", cmd, ack: ack as never, now: Date.now() }),
      () => {
        // A lost ack (timeout) or a command that never left (not connected) is the same as an `internal` answer:
        // the optimistic draw / rematch / ready flag rolls back (plan 5.2.8, G5) and the snapshot decides. While
        // the socket is down the sync it asks for is skipped (doSync); the room re-join replaces the state anyway.
        dispatch({ type: "cmdAck", cmd, ack: { ok: false, code: "internal" }, now: Date.now() });
      },
    );
  }

  async function doSync(): Promise<boolean> {
    const rt = rtOf();
    if (!rt || syncing) return false;
    // Not live: the re-join after the reconnect is the resync. Counting this as a failed sync would push a player
    // with a flaky network into server_error.
    if (!rt.isLive()) return false;
    syncing = true;
    const sentAt = Date.now();
    try {
      const ack = await rt.command("game:sync", { ref });
      if (ack.ok) {
        clock.seed(ack.state.serverNow, sentAt);
        dispatch({ type: "replace", state: ack.state as GameState, reason: "sync", now: Date.now() });
        return true;
      }
      dispatch({ type: "syncFailed", now: Date.now() });
      return false;
    } catch {
      dispatch({ type: "syncFailed", now: Date.now() });
      return false;
    } finally {
      syncing = false;
    }
  }

  async function join(r: number): Promise<void> {
    const rt = rtOf();
    if (!rt || r !== round || joinedRound === r) return;
    const sentAt = Date.now();
    try {
      const ack = spectator
        ? await rt.command("spectate:join", { ref }, JOIN_TIMEOUT_MS)
        : await rt.command("game:join", { ref, lastSeq: store.getState().state.seq }, JOIN_TIMEOUT_MS);
      if (ack.ok) {
        if (r !== round || joinedRound === r) return;
        joinedRound = r;
        clock.seed(ack.state.serverNow, sentAt);
        dispatch({ type: "replace", state: ack.state as GameState, reason: "join", now: Date.now() });
        const ackAt = performance.now();
        withTelemetry((t) => t.markJoinAck(ref, ackAt));
        if (spectator && !spectateStarted) {
          spectateStarted = true;
          withTelemetry((t) => {
            spectateLeft = t.trackSpectateStarted();
          });
        }
        return;
      }
      if (ack.code === "not_found" || ack.code === "forbidden" || ack.code === "not_member") {
        deps.onJoinFailure(ack.code);
        return;
      }
      if (ack.code === "draining") dispatch({ type: "toast", code: "draining", now: Date.now() });
      dispatch({ type: "syncFailed", now: Date.now() });
    } catch {
      dispatch({ type: "syncFailed", now: Date.now() });
    }
    // This round is not joined yet: try again while the socket is up and the store has not given up.
    setTimeout(() => {
      if (detach && r === round && joinedRound !== r && !store.getState().serverError && rtOf()?.isLive()) void join(r);
    }, JOIN_RETRY_MS);
  }

  function attach(): () => void {
    if (detach) return detach;
    const rt = rtOf();
    if (!rt) {
      dispatch({ type: "syncFailed", now: Date.now() });
      return () => {};
    }
    void loadFrameValidator().then((v) => {
      validator = v;
    });
    if (!viewed) {
      viewed = true;
      const accepted = acceptedRematches.has(ref);
      withTelemetry((t) => t.trackGameViewed(snapshot, accepted));
    }

    const offs: (() => void)[] = [];
    for (const name of GAME_EVENT_NAMES) {
      offs.push(
        rt.on(name, (payload: { ref?: string }) => {
          if (name !== "server:restarting" && payload?.ref !== ref) return;
          validator?.(name, payload);
          dispatch({ type: "event", event: { name, payload } as ServerEvent, now: Date.now() });
        }),
      );
    }

    const onConn = () => dispatch({ type: "conn", conn: rt.getState(), now: Date.now() });
    offs.push(rt.subscribe(onConn));

    // Notify once when the game ends while this page is open (prefetch, cache invalidation, analytics).
    offs.push(
      store.subscribe((g) => {
        if (!endedNotified && g.state.phase === "ended" && g.sawEnd) {
          endedNotified = true;
          deps.onEnded?.(ref);
        }
      }),
    );

    const release = rt.acquire("game");
    onConn();
    const leaveRoom = rt.room(
      `live-game/${ref}`,
      () => join(++round),
      () => rt.emit("game:leave", { ref }),
    );

    // Clock offset pings while the page is visible and a clock or countdown matters.
    const ping = setInterval(() => {
      const p = store.getState().state.phase;
      if (typeof document !== "undefined" && document.hidden) return;
      if (p !== "study" && p !== "first_move" && p !== "playing") return;
      const c = Date.now();
      rt.command("clock:ping", { c }).then(
        (ack) => {
          if (ack.ok) clock.sample(ack.c, ack.s, Date.now());
        },
        () => {},
      );
    }, CLIENT_PING_EVERY_MS);

    detach = () => {
      spectateLeft?.();
      spectateLeft = null;
      spectateStarted = false;
      clearInterval(ping);
      for (const off of offs) off();
      leaveRoom();
      release();
      detach = null;
    };
    return detach;
  }

  const controller: LiveController = {
    kind: "live",
    store,
    serverNow: clock.now,
    attach,
    move(m: BoardMove) {
      dispatch({ type: "move", uci: m.uci, clientMoveId: nextClientMoveId(), now: Date.now(), serverNow: clock.now() });
    },
    setPremove(m) {
      if (m) dispatch({ type: "premove", uci: m.uci, now: Date.now() });
      else dispatch({ type: "premove", uci: null, now: Date.now(), reason: "cancelled" });
    },
    ready: () => dispatch({ type: "ready", now: Date.now() }),
    abort: () => dispatch({ type: "abort", now: Date.now() }),
    resign: () => dispatch({ type: "confirmResign", now: Date.now() }),
    offerDraw: () => dispatch({ type: "drawOffer", now: Date.now() }),
    answerDraw: (accept) => dispatch({ type: "drawAnswer", accept, now: Date.now() }),
    offerRematch: () => dispatch({ type: "rematchOffer", now: Date.now(), serverNow: clock.now() }),
    answerRematch: (accept) => dispatch({ type: "rematchAnswer", accept, now: Date.now() }),
    cancelRematch: () => dispatch({ type: "rematchCancel", now: Date.now() }),
    sync() {
      // "Reload game": game:sync first, then a hard reload of the route if that fails (plan 5.2.2).
      void doSync().then((ok) => {
        if (!ok) deps.refresh();
      });
    },
    destroy() {
      detach?.();
    },
  };
  return controller;
}
