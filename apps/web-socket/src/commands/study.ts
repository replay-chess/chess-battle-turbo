// `study:ready` (phase-02 plan 7.4.4, 8.2): "I'm ready" during the study phase; both ready ends it early.
import type { CommandAck } from "@repo/contracts/socket/commands";
import { playerOf, type CommandTable } from "./context";

export const studyCommands: CommandTable = {
  async "study:ready"(ctx, socket, { ref }) {
    const p = playerOf(ctx, socket, ref);
    if (!p.ok) return p.ack;
    return (await p.session.command({ type: "ready", side: p.side })) as CommandAck<"study:ready">;
  },
};
