// Rematch (phase-02 plan 7.4.4, 8.8, 6.6.6): offer from `ended` (FRIEND/ONLINE, not aborted, both players attached,
// ≤ 3 offers per game, 30 s expiry), crossing offers accept, accept re-checks BOTH memberships from the newest
// tokens (`not_member` for the caller, `paywall` for the other player), and the new game is created with
// `createRematch` (colours swapped). The accept is acked with `{ newRef }` once the row exists; both players get
// `rematch:started` in `game:{ref}`. No rematch creation while draining (`draining`).
import type { CommandAck } from "@repo/contracts/socket/commands";
import { entsOf, fail, playerOf, type CommandTable } from "./context";

export const rematchCommands: CommandTable = {
  async "rematch:offer"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    if (ctx.registry.draining) return fail("draining"); // after the restart notice: no new games
    const ack = await p.session.command({ type: "rematchOffer", side: p.side, ent: entsOf(ctx, p.session) });
    return ack as CommandAck<"rematch:offer">;
  },

  async "rematch:accept"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    if (ctx.registry.draining) return fail("draining"); // after the restart notice: no new games
    const ack = await p.session.command({ type: "rematchAccept", side: p.side, ent: entsOf(ctx, p.session) });
    return ack as CommandAck<"rematch:accept">;
  },

  async "rematch:decline"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "rematchDecline", side: p.side })) as CommandAck<"rematch:decline">;
  },

  async "rematch:cancel"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "rematchCancel", side: p.side })) as CommandAck<"rematch:cancel">;
  },
};
