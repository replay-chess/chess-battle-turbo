// Room names (phase-02 plan §7.4.3). Rooms are built only here; an ESLint rule (@repo/eslint-config, rule
// `replay/no-room-literal`) refuses hand-built room strings anywhere else. P9 (R2) and P12 import ROOM.
import { z } from "zod";

export const ROOM_KINDS = ["game", "spectate", "user", "tournament"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export type GameRoom = `game:${string}`;
export type SpectateRoom = `spectate:${string}`;
export type UserRoom = `user:${string}`;
export type TournamentRoom = `tournament:${string}`;
export type RoomName = GameRoom | SpectateRoom | UserRoom | TournamentRoom;

/** A room id: a cuid ref or a tournament slug. No `:` so a name always splits in two. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function build<K extends RoomKind>(kind: K, id: string): `${K}:${string}` {
  if (!ID.test(id)) throw new Error(`ROOM.${kind}: invalid id`);
  return `${kind}:${id}`;
}

export const ROOM = {
  /** Every socket of both players (multi-tab aware). */
  game: (ref: string): GameRoom => build("game", ref),
  /** Spectators of a watchable game (one ply behind). */
  spectate: (ref: string): SpectateRoom => build("spectate", ref),
  /** Every socket of one user, joined by the server at connect. */
  user: (ref: string): UserRoom => build("user", ref),
  /** Legacy lobby room until P12. */
  tournament: (slug: string): TournamentRoom => build("tournament", slug),
} as const;

/** Splits a room name. Null for anything that is not a valid room. */
export function parseRoom(name: string): { kind: RoomKind; id: string } | null {
  const i = name.indexOf(":");
  if (i <= 0) return null;
  const kind = name.slice(0, i);
  const id = name.slice(i + 1);
  if (!(ROOM_KINDS as readonly string[]).includes(kind) || !ID.test(id)) return null;
  return { kind: kind as RoomKind, id };
}

/** A room name on the wire (`/internal/emit` targets). */
export const RoomNameSchema = z.custom<RoomName>(
  (v) => typeof v === "string" && v.length <= 80 && parseRoom(v) !== null,
  { message: "not a room name" },
);
