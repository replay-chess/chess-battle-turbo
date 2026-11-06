// Draw offers (phase-02 plan 7.4.4, 8.7): offer (a counter-offer accepts), accept and decline only by the receiver
// of an open offer (socket F-01), cooldown `canOfferAtPly` after a decline (explicit or by moving).
import type { CommandAck } from "@repo/contracts/socket/commands";
import { playerOf, type CommandTable } from "./context";

export const drawCommands: CommandTable = {
  async "draw:offer"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "drawOffer", side: p.side })) as CommandAck<"draw:offer">;
  },

  async "draw:accept"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "drawAccept", side: p.side })) as CommandAck<"draw:accept">;
  },

  async "draw:decline"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "drawDecline", side: p.side })) as CommandAck<"draw:decline">;
  },
};
