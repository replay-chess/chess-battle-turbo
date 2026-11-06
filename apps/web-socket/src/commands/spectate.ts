// `spectate:join` (phase-02 plan 7.4.4, 8.10, 11.1): members (`ent > now`) may watch a watchable game (live modes:
// FRIEND, ONLINE, TOURNAMENT; bot games never reach the socket). A player is answered as `game:join`. Spectators
// join `spectate:{ref}`, which gets moves one ply late and never offers or rematch internals.
import type { CommandAck } from "@repo/contracts/socket/commands";
import { ROOM } from "@repo/contracts/socket/rooms";
import { attachPlayer, withLiveState } from "./game";
import { dataOf, fail, nowSec, type CommandTable } from "./context";

export const spectateCommands: CommandTable = {
  async "spectate:join"(ctx, socket, { ref }) {
    const data = dataOf(socket);
    const opened = await ctx.registry.open(ref);
    if (!opened.ok) return fail(opened.code === "draining" ? "not_found" : opened.code);
    const session = opened.session;
    if (session.sideOf(data.userRef)) return attachPlayer(ctx, socket, session) as CommandAck<"spectate:join">;
    if (!(ctx.ents.get(data.userRef) > nowSec(ctx))) return fail("not_member");
    if (!socket.connected) return fail("internal");
    if (!ctx.index.get(socket.id, ref)) {
      ctx.index.add(socket.id, ref, { role: "spectator" });
      if (session.spectators.add(socket.id)) session.dispatch({ type: "spectators", count: session.spectators.count });
      ctx.metrics.count("ws.join", { role: "spectator", phase: session.phase });
    }
    void socket.join(ROOM.spectate(ref));
    // Projected when the ack is sent (see withLiveState in ./game).
    return withLiveState({ ok: true, role: "spectator" }, () => session.project({ role: "spectator" })) as CommandAck<"spectate:join">;
  },
};
