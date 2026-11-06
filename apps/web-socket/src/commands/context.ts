// What every v2 command handler gets (phase-02 plan 7.4.4), and the helpers they share.
import type { AckError, CommandAck, CommandName, ParsedCommand } from "@repo/contracts/socket/commands";
import type { Side, SocketErrorCode } from "@repo/game-core";
import type { Server, Socket } from "socket.io";
import type { ServerEnv } from "../config/env";
import type { Timing } from "../config/timing";
import type { LiveSession } from "../game/LiveSession";
import type { SocketIndex } from "../game/presence";
import type { SessionRegistry } from "../game/SessionRegistry";
import type { Logger, Metrics } from "../ports";
import type { SocketData } from "../server/handshake";
import type { UserRooms } from "../server/rooms";

/** The newest `ent` per user, from the handshake and `session:refresh_token` (rematch checks both players). */
export class EntitlementStore {
  private readonly ent = new Map<string, number>();

  /** Keeps the newest token's value (a refresh may lower it: a lapsed membership). */
  set(userRef: string, ent: number): void {
    this.ent.set(userRef, ent);
  }

  get(userRef: string | null): number {
    return userRef ? (this.ent.get(userRef) ?? 0) : 0;
  }
}

export interface CommandContext {
  io: Server;
  env: Pick<ServerEnv, "appEnv" | "socketKeys">;
  timing: Timing;
  registry: SessionRegistry;
  index: SocketIndex;
  userRooms: UserRooms;
  ents: EntitlementStore;
  now(): number;
  log: Logger;
  metrics: Metrics;
}

export type CommandHandler<N extends CommandName> = (
  ctx: CommandContext,
  socket: Socket,
  payload: ParsedCommand<N>,
) => CommandAck<N> | Promise<CommandAck<N>>;

export type CommandTable = { [N in CommandName]?: CommandHandler<N> };

export function fail(code: SocketErrorCode, extra: Omit<AckError, "ok" | "code"> = {}): AckError {
  return { ok: false, code, ...extra };
}

export function dataOf(socket: Socket): SocketData {
  return socket.data as SocketData;
}

/** Unix seconds now. */
export function nowSec(ctx: Pick<CommandContext, "now">): number {
  return ctx.now() / 1000;
}

/**
 * The session and the caller's seat for a player command. The seat comes from the session's own record and the
 * verified token (plan 11.2 rules 1–2); the socket does not need to have joined (multi-tab).
 */
export function playerOf(
  ctx: CommandContext,
  socket: Socket,
  ref: string,
): { ok: true; session: LiveSession; side: Side } | { ok: false; ack: AckError } {
  const session = ctx.registry.get(ref);
  if (!session) return { ok: false, ack: fail("not_found") };
  const side = session.sideOf(dataOf(socket).userRef);
  if (!side) return { ok: false, ack: fail("forbidden") };
  return { ok: true, session, side };
}

/** Both players' newest `ent` (unix s) for the rematch membership checks. */
export function entsOf(ctx: CommandContext, session: LiveSession): { w: number; b: number } {
  return { w: ctx.ents.get(session.state.seats.w.ref), b: ctx.ents.get(session.state.seats.b.ref) };
}
