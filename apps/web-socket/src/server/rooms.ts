// Rooms (phase-02 plan 7.4.3) and the user-room sequence (`session:hello {bootId, useq}`, plan 7.4.1 step 6).
// Room names come only from `ROOM` in @repo/contracts/socket/rooms (lint rule `replay/no-room-literal`).
import { randomBytes } from "node:crypto";
import { ROOM } from "@repo/contracts/socket/rooms";
import type { Server } from "socket.io";

/** Sockets currently in a room (0 when the room does not exist). */
export function roomSize(io: Server, room: string): number {
  return io.of("/").adapter.rooms.get(room)?.size ?? 0;
}

/** A random id per process start (contract: `[A-Za-z0-9_-]{6,32}`). */
export function newBootId(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * The per-user, per-process user-room counter. Every event delivered to `user:{ref}` carries the next `useq`
 * (`WithUseq`); `session:hello` tells a (re)connecting socket the current value, so the client refetches its
 * user-level queries only when `bootId` changed or it sees a gap (api-perf AP-25). P2 sends nothing game-specific
 * to user rooms; `/internal/emit` (WP-D part 2) delivers through `emitToUser`. Counters are
 * never dropped while the process lives (one number per user), so a reconnect never sees a spurious reset.
 */
export class UserRooms {
  private readonly useq = new Map<string, number>();

  constructor(
    private readonly io: Server,
    readonly bootId: string,
  ) {}

  current(userRef: string): number {
    return this.useq.get(userRef) ?? 0;
  }

  /** Sends `event` to every socket of the user with the next `useq`. Returns that `useq`. */
  emitToUser(userRef: string, event: string, data: Record<string, unknown>): number {
    const next = this.current(userRef) + 1;
    this.useq.set(userRef, next);
    this.io.to(ROOM.user(userRef)).emit(event, { ...data, useq: next });
    return next;
  }
}
