// `clock:ping` (phase-02 plan 5.2.7): the client's clock offset probe, `{ c }` → `{ c, s }` (s = server epoch ms).
// The lag credit uses the server's own RTT per socket (engine.io heartbeat, game/presence.ts `watchRtt`), never a
// number the client reports.
import type { CommandTable } from "./context";

export const clockCommands: CommandTable = {
  "clock:ping"(ctx, _socket, { c }) {
    return { ok: true, c, s: ctx.now() };
  },
};
