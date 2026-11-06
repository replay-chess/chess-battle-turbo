// Player commands of protocol v2 (phase-02 plan 7.4.4): join, leave, sync, move, abort, resign.
import type { CommandAck } from "@repo/contracts/socket/commands";
import { ROOM } from "@repo/contracts/socket/rooms";
import type { Socket } from "socket.io";
import type { LiveSession } from "../game/LiveSession";
import { dataOf, fail, playerOf, type CommandContext, type CommandTable } from "./context";

/** Detaches a socket from one game (leave, disconnect, eviction of its membership). */
export function detachFrom(ctx: CommandContext, socket: Socket, ref: string): void {
  const m = ctx.index.remove(socket.id, ref);
  const session = ctx.registry.get(ref);
  if (!m) return;
  if (m.role === "player") {
    void socket.leave(ROOM.game(ref));
    session?.dispatch({ type: "detach", side: m.side, socketId: socket.id });
  } else {
    void socket.leave(ROOM.spectate(ref));
    if (session?.spectators.remove(socket.id)) session.dispatch({ type: "spectators", count: session.spectators.count });
  }
}

/** Attaches a player's socket. The room is joined after the attach, so the ack's snapshot is the socket's start. */
export function attachPlayer(ctx: CommandContext, socket: Socket, session: LiveSession): CommandAck<"game:join"> {
  const side = session.sideOf(dataOf(socket).userRef);
  if (!side) return fail("forbidden");
  // A socket that was spectating the game becomes a player view (a player is never a spectator, plan 7.4.4).
  if (ctx.index.get(socket.id, session.ref)?.role === "spectator") detachFrom(ctx, socket, session.ref);
  // A side that was attached before and has no socket now is coming back (plan 10.2 `ws.reconnect{phase}`).
  const p = session.state.presence[side];
  if (p.sockets.length === 0 && p.detaches.length > 0) ctx.metrics.count("ws.reconnect", { phase: session.phase });
  session.dispatch({ type: "attach", side, socketId: socket.id });
  ctx.index.add(socket.id, session.ref, { role: "player", side });
  void socket.join(ROOM.game(session.ref));
  ctx.metrics.count("ws.join", { role: "player", phase: session.phase });
  return withLiveState({ ok: true, role: "player", color: side }, () => session.project({ role: "player", color: side })) as CommandAck<"game:join">;
}

/**
 * A seat was filled from the DB row (the friend joined through the web): the sockets already in the rooms (the
 * creator, early spectators) hold a state without that player, and no room event carries names or ratings, so each
 * gets its own projection as `game:snapshot` (the client replaces its state; no seq check). Regression: the creator
 * saw "?" and no name for the opponent for the whole game (INTEGRATE-2 smoke).
 */
export function pushSnapshots(ctx: CommandContext, session: LiveSession, exceptSocketId: string): void {
  for (const room of [ROOM.game(session.ref), ROOM.spectate(session.ref)]) {
    for (const id of ctx.io.sockets.adapter.rooms.get(room) ?? []) {
      if (id === exceptSocketId) continue;
      const m = ctx.index.get(id, session.ref);
      const s = ctx.io.sockets.sockets.get(id);
      if (!m || !s) continue;
      s.emit("game:snapshot", m.role === "player" ? session.project({ role: "player", color: m.side }) : session.project({ role: "spectator" }));
    }
  }
}

/**
 * The join ack's `state`, projected when socket.io serialises the ack, not when the handler returned. The reply
 * goes out a microtask later; joins released together (the boot restore gate) attach in between and their room
 * events reach this socket first. A snapshot taken at return time would then be older than those events and the
 * client (which ignores events at or below its own seq) would keep it: found by INTEGRATE-2's restart smoke (the
 * first player back saw the opponent "Disconnected" and frozen clocks after both had rejoined).
 */
export function withLiveState<T extends object, S>(ack: T, project: () => S): T & { state: S } {
  return Object.defineProperty(ack, "state", { get: project, enumerable: true, configurable: true }) as T & { state: S };
}

export const gameCommands: CommandTable = {
  async "game:join"(ctx, socket, { ref }) {
    const opened = await ctx.registry.open(ref);
    if (!opened.ok) return fail(opened.code);
    const session = opened.session;
    const userRef = dataOf(socket).userRef;
    let seatFilled = false;
    if (!session.sideOf(userRef)) {
      // The friend may have joined through the web after the session was loaded (one re-read).
      const side = await ctx.registry.refreshSeats(session, userRef);
      if (!side) return fail("forbidden");
      seatFilled = true;
    }
    if (!socket.connected) return fail("internal");
    const ack = attachPlayer(ctx, socket, session);
    if (seatFilled && ack.ok) pushSnapshots(ctx, session, socket.id);
    return ack;
  },

  "game:leave"(ctx, socket, { ref }) {
    detachFrom(ctx, socket, ref);
    return { ok: true };
  },

  "game:sync"(ctx, socket, { ref }) {
    const session = ctx.registry.get(ref);
    const m = ctx.index.get(socket.id, ref);
    if (!session || !m) return fail("not_found");
    const state =
      m.role === "player" ? session.project({ role: "player", color: m.side }) : session.project({ role: "spectator" });
    return { ok: true, state } as CommandAck<"game:sync">;
  },

  async "game:move"(ctx, socket, { ref, ply, uci, clientMoveId, premove }) {
    const started = ctx.now();
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    const ack = await p.session.command({
      type: "move",
      side: p.side,
      ply,
      uci,
      clientMoveId,
      ...(premove ? { premove: true } : {}),
    });
    // Receive → room emit (plan 9.1: p50 ≤ 1 ms, p99 ≤ 5 ms): the reducer only, no I/O.
    ctx.metrics.sample("ws.move_latency_ms", ctx.now() - started);
    return ack as CommandAck<"game:move">;
  },

  async "game:abort"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "abort", side: p.side })) as CommandAck<"game:abort">;
  },

  async "game:resign"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "resign", side: p.side })) as CommandAck<"game:resign">;
  },
};
