// Legacy tournament lobby rooms (phase-02 plan 3.1: kept until P12). The legacy lobby page joins `tournament:{ref}`
// with `join_tournament_lobby` (v1 and v2 sockets alike) and the web app pushes lobby events through
// `/internal/tournament-event`. After a v2 tournament game finishes, the socket emits `tournament_game_ended`
// in-process (plan 6.6.4), replacing the web → socket notify that `chess/game-over` made.
import { ROOM } from "@repo/contracts/socket/rooms";
import type { Server, Socket } from "socket.io";
import type { Logger } from "../ports";

export interface TournamentLobbyPayload {
  tournamentReferenceId: string;
}

/** The room of a tournament, or null for an id that is not a valid room id (ignored, never thrown). */
function lobbyRoom(tournamentReferenceId: unknown): string | null {
  if (typeof tournamentReferenceId !== "string") return null;
  try {
    return ROOM.tournament(tournamentReferenceId);
  } catch {
    return null;
  }
}

export class TournamentManager {
  /** Which lobbies each socket joined (cleanup on disconnect). */
  private readonly socketToTournaments = new Map<string, Set<string>>();

  constructor(
    private readonly io: Server,
    private readonly log: Logger,
  ) {}

  /** Registers the lobby handlers on any socket (v1 or v2). */
  attach(socket: Socket): void {
    socket.on("join_tournament_lobby", (payload: TournamentLobbyPayload | undefined) =>
      this.handleJoinLobby(socket, payload?.tournamentReferenceId),
    );
    socket.on("leave_tournament_lobby", (payload: TournamentLobbyPayload | undefined) =>
      this.handleLeaveLobby(socket, payload?.tournamentReferenceId),
    );
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  handleJoinLobby(socket: Socket, tournamentReferenceId: unknown): void {
    const room = lobbyRoom(tournamentReferenceId);
    if (!room) return;
    void socket.join(room);
    let joined = this.socketToTournaments.get(socket.id);
    if (!joined) {
      joined = new Set();
      this.socketToTournaments.set(socket.id, joined);
    }
    joined.add(room);
  }

  handleLeaveLobby(socket: Socket, tournamentReferenceId: unknown): void {
    const room = lobbyRoom(tournamentReferenceId);
    if (!room) return;
    void socket.leave(room);
    this.socketToTournaments.get(socket.id)?.delete(room);
  }

  handleDisconnect(socket: Socket): void {
    this.socketToTournaments.delete(socket.id);
  }

  private emit(tournamentReferenceId: string, event: string, data: unknown): boolean {
    const room = lobbyRoom(tournamentReferenceId);
    if (!room) return false;
    this.io.to(room).emit(event, data);
    return true;
  }

  /** Legacy payload: the web sends the player, the lobby receives `{ player }`. */
  emitPlayerJoined(tournamentReferenceId: string, player: unknown): void {
    this.emit(tournamentReferenceId, "tournament_player_joined", { player });
  }

  emitTournamentStarted(tournamentReferenceId: string, data: unknown): void {
    this.emit(tournamentReferenceId, "tournament_started", data);
  }

  emitGameStarted(tournamentReferenceId: string, data: unknown): void {
    this.emit(tournamentReferenceId, "tournament_game_started", data);
  }

  /** Leaderboard refresh after a tournament game (legacy payload `{ gameReferenceId, result }`). */
  emitGameEnded(tournamentReferenceId: string, data: { gameReferenceId: string; result: string }): void {
    this.emit(tournamentReferenceId, "tournament_game_ended", data);
  }

  emitTournamentEnded(tournamentReferenceId: string): void {
    this.emit(tournamentReferenceId, "tournament_ended", { tournamentReferenceId });
  }

  /** The legacy `/internal/tournament-event` body. False for an unknown event name. */
  emitLegacyEvent(event: string, tournamentReferenceId: string, data: unknown): boolean {
    switch (event) {
      case "game_ended":
        this.emit(tournamentReferenceId, "tournament_game_ended", data);
        return true;
      case "game_started":
        this.emitGameStarted(tournamentReferenceId, data);
        return true;
      case "tournament_started":
        this.emitTournamentStarted(tournamentReferenceId, data);
        return true;
      case "tournament_ended":
        this.emitTournamentEnded(tournamentReferenceId);
        return true;
      case "player_joined":
        this.emitPlayerJoined(tournamentReferenceId, data);
        return true;
      default:
        this.log.warn("unknown legacy tournament event", { event });
        return false;
    }
  }

  destroy(): void {
    this.socketToTournaments.clear();
  }
}
