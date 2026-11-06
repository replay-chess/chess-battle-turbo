// Registers the protocol v2 commands on a socket (phase-02 plan 7.4.4, 7.4.7, 7.4.8). Every command:
//   1. passes the per-socket limits (shared bucket + its own window; sustained flooding disconnects),
//   2. has its payload parsed with the contract schema (an invalid one → `{ok:false, code:"internal"}` and
//      `ws.invalid_payload{event}`, never a crash),
//   3. runs its handler; an exception → `internal`, logged with the game ref, never the payload.
import { COMMAND_NAMES, parseCommand, type CommandAck, type CommandName } from "@repo/contracts/socket/commands";
import type { Socket } from "socket.io";
import { CommandLimiter } from "../server/rateLimit";
import { clockCommands } from "./clock";
import { fail, type CommandContext, type CommandHandler, type CommandTable } from "./context";
import { drawCommands } from "./draw";
import { gameCommands } from "./game";
import { liveCommands } from "./live";
import { rematchCommands } from "./rematch";
import { sessionCommands } from "./session";
import { spectateCommands } from "./spectate";
import { studyCommands } from "./study";

export const COMMAND_TABLE: CommandTable = {
  ...gameCommands,
  ...studyCommands,
  ...drawCommands,
  ...rematchCommands,
  ...spectateCommands,
  ...liveCommands,
  ...clockCommands,
  ...sessionCommands,
};

type Reply = (response: unknown) => void;

export function registerCommands(socket: Socket, ctx: CommandContext, table: CommandTable = COMMAND_TABLE): void {
  const limiter = new CommandLimiter(ctx.now());
  for (const name of COMMAND_NAMES) {
    const handler = table[name] as CommandHandler<CommandName> | undefined;
    if (!handler) continue;
    socket.on(name, (rawPayload: unknown, rawAck?: unknown) => {
      // socket.io passes the ack last; a client that sent no payload puts it first.
      let payload = rawPayload;
      let ack = rawAck;
      if (typeof payload === "function" && ack === undefined) {
        ack = payload;
        payload = undefined;
      }
      const reply: Reply = typeof ack === "function" ? (ack as Reply) : () => undefined;

      const limit = limiter.check(name, ctx.now());
      if (!limit.ok) {
        ctx.metrics.count("ws.rate_limited", { cmd: name });
        reply(fail("rate_limited", { retryAfterMs: limit.retryAfterMs }));
        if (limit.disconnect) {
          ctx.log.warn("socket disconnected for flooding", { cmd: name, user: (socket.data as { userRef?: string }).userRef });
          socket.disconnect(true);
        }
        return;
      }
      const parsed = parseCommand(name, payload);
      if (!parsed.success) {
        ctx.metrics.count("ws.invalid_payload", { event: name });
        reply(fail("internal"));
        return;
      }
      ctx.metrics.count("ws.socket_event", { proto: 2, event: name });
      let result: CommandAck<CommandName> | Promise<CommandAck<CommandName>>;
      try {
        result = handler(ctx, socket, parsed.data);
      } catch (error) {
        onError(ctx, name, parsed.data, error);
        reply(fail("internal"));
        return;
      }
      if (result instanceof Promise) {
        result.then(reply, (error: unknown) => {
          onError(ctx, name, parsed.data, error);
          reply(fail("internal"));
        });
      } else {
        reply(result);
      }
    });
  }
}

function onError(ctx: CommandContext, name: CommandName, payload: unknown, error: unknown): void {
  const ref = payload && typeof payload === "object" ? (payload as { ref?: unknown }).ref : undefined;
  ctx.metrics.count("ws.command_error", { cmd: name });
  ctx.log.error("command failed", { cmd: name, game: typeof ref === "string" ? ref : undefined }, error);
}
