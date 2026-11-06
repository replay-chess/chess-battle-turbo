// Which games each socket is in, and as what (phase-02 plan 8.6). game-core's reducer owns the presence rules
// (online while ≥ 1 socket of the side is attached, grace 30 s / 10 s when flapping, no grace in study or first
// move, both offline → clocks decide); this index only remembers the memberships so a `disconnect` or a
// `game:leave` detaches the socket from every session it joined, and it measures each socket's RTT from the
// engine.io heartbeat for the lag credit (plan 8.4: `rttEwma[S]`).
import type { Side } from "@repo/game-core";
import type { Socket } from "socket.io";

export type Membership = { role: "player"; side: Side } | { role: "spectator" };

export class SocketIndex {
  private readonly bySocket = new Map<string, Map<string, Membership>>();

  add(socketId: string, ref: string, membership: Membership): void {
    let games = this.bySocket.get(socketId);
    if (!games) {
      games = new Map();
      this.bySocket.set(socketId, games);
    }
    games.set(ref, membership);
  }

  get(socketId: string, ref: string): Membership | undefined {
    return this.bySocket.get(socketId)?.get(ref);
  }

  /** Removes one membership; returns it. */
  remove(socketId: string, ref: string): Membership | undefined {
    const games = this.bySocket.get(socketId);
    const m = games?.get(ref);
    if (games && m) {
      games.delete(ref);
      if (games.size === 0) this.bySocket.delete(socketId);
    }
    return m;
  }

  /** Removes every membership of a socket (on disconnect); returns them. */
  removeSocket(socketId: string): [string, Membership][] {
    const games = this.bySocket.get(socketId);
    this.bySocket.delete(socketId);
    return games ? [...games] : [];
  }

  /** Every game ref a socket is in. */
  refsOf(socketId: string): string[] {
    return [...(this.bySocket.get(socketId)?.keys() ?? [])];
  }

  /** Memberships of a socket as a player (ref → side). */
  playerGames(socketId: string): [string, Side][] {
    const out: [string, Side][] = [];
    for (const [ref, m] of this.bySocket.get(socketId) ?? []) if (m.role === "player") out.push([ref, m.side]);
    return out;
  }

  /** Forgets a game for every socket (session evicted). */
  forgetGame(ref: string): void {
    for (const [socketId, games] of this.bySocket) {
      games.delete(ref);
      if (games.size === 0) this.bySocket.delete(socketId);
    }
  }

  get size(): number {
    return this.bySocket.size;
  }
}

/**
 * Calls `onRtt(ms)` for every engine.io heartbeat round trip of the socket (server `ping` → client `pong`, every
 * PING_INTERVAL_MS). This gives the server its own RTT per socket without trusting a client-reported number.
 */
export function watchRtt(socket: Socket, now: () => number, onRtt: (rttMs: number) => void): void {
  const conn = socket.conn as unknown as {
    on(event: "packetCreate" | "packet", listener: (packet: { type: string }) => void): void;
  };
  let sentAt: number | null = null;
  conn.on("packetCreate", (packet) => {
    if (packet.type === "ping") sentAt = now();
  });
  conn.on("packet", (packet) => {
    if (packet.type === "pong" && sentAt !== null) {
      const rtt = now() - sentAt;
      sentAt = null;
      if (rtt >= 0 && rtt < 30_000) onRtt(rtt);
    }
  });
}
