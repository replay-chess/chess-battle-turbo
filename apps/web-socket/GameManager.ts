import { Socket } from "socket.io";
import { GameSession } from "./GameSession";
import { GameData } from "./types";
import { fetchGameByRef } from "./utils/apiClient";
import {
  setGameTraceContext,
  removeGameTraceContext,
} from "./utils/traceContext";
import { logger } from "./utils/logger";
import { trackActiveGames } from "./utils/sentry";

/**
 * GameManager manages all active game sessions
 * Routes socket events to appropriate game sessions
 */
export class GameManager {
  private games: Map<string, GameSession> = new Map();
  // Map socket ID to game reference IDs for quick lookup on disconnect
  private socketToGames: Map<string, Set<string>> = new Map();

  /**
   * Handle a player joining a game
   */
  public async handleJoinGame(
    socket: Socket,
    gameReferenceId: string,
    userReferenceId: string
  ): Promise<void> {
    try {
      logger.info(
        `Player ${userReferenceId} attempting to join game`,
        { game: gameReferenceId, user: userReferenceId }
      );

      // Get or create game session
      let gameSession = this.games.get(gameReferenceId);
      let isReconnection = false;
      let gameData: GameData;

      if (!gameSession) {
        // Fetch game data from API
        gameData = await fetchGameByRef(gameReferenceId);

        // Re-check after async fetch — safe because Node.js is single-threaded;
        // the only yield point is the await above, so no synchronous interleaving
        gameSession = this.games.get(gameReferenceId);
        if (gameSession) {
          isReconnection = gameSession.isPlayerInGame(userReferenceId);
          // Update session with our fresh data (covers concurrent join)
          await gameSession.setGameData(gameData);
          logger.info(`Session created by concurrent join, isReconnection: ${isReconnection}`, { game: gameReferenceId, user: userReferenceId });
        } else {
          // Extract and store trace context for distributed tracing
          const traceContext = gameData.gameData?.traceContext;
          if (traceContext) {
            setGameTraceContext(gameReferenceId, traceContext);
          }

          logger.debug(`Fetched game data: gameMode=${gameData.gameData?.gameMode}`, { game: gameReferenceId });

          // Validate game status
          if (
            gameData.status !== "WAITING_FOR_OPPONENT" &&
            gameData.status !== "IN_PROGRESS"
          ) {
            socket.emit("error", {
              message: `Game is not available (status: ${gameData.status})`,
            });
            return;
          }

          // Create new game session
          gameSession = new GameSession(gameData);
          this.games.set(gameReferenceId, gameSession);
          trackActiveGames(this.games.size);

          logger.info(`Created new game session`, { game: gameReferenceId });
        }
      } else {
        // Session exists — fetch fresh data (opponent may have been set since creation)
        isReconnection = gameSession.isPlayerInGame(userReferenceId);
        gameData = await fetchGameByRef(gameReferenceId);
        await gameSession.setGameData(gameData);
        logger.info(`Is reconnection: ${isReconnection}`, { game: gameReferenceId, user: userReferenceId });
      }

      // Track socket to game mapping BEFORE adding player
      if (!this.socketToGames.has(socket.id)) {
        this.socketToGames.set(socket.id, new Set());
      }
      this.socketToGames.get(socket.id)!.add(gameReferenceId);

      // Handle reconnection vs new join
      if (isReconnection) {
        logger.info(`Handling reconnection for ${userReferenceId}`, { game: gameReferenceId });
        gameSession.handleReconnect(socket, userReferenceId);
      } else {
        logger.info(`Handling new player join for ${userReferenceId}`, { game: gameReferenceId });
        // Add player to session
        await gameSession.addPlayer(socket, userReferenceId);

        // If game is waiting for opponent, emit waiting status
        if (
          gameData.status === "WAITING_FOR_OPPONENT" &&
          !gameSession.hasBothPlayers()
        ) {
          socket.emit("waiting_for_opponent", { gameReferenceId });
          logger.info(`Player waiting for opponent`, { game: gameReferenceId });
        }
      }
    } catch (error) {
      logger.error("Error handling join game", error, { game: gameReferenceId });
      socket.emit("error", {
        message: error instanceof Error ? error.message : "Failed to join game",
      });
    }
  }

  /**
   * Handle a move attempt
   */
  public async handleMove(
    socket: Socket,
    gameReferenceId: string,
    from: string,
    to: string,
    promotion?: "q" | "r" | "b" | "n"
  ): Promise<void> {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("move_error", { message: "Game not found" });
      return;
    }

    await gameSession.makeMove(socket, from as any, to as any, promotion);
  }

  /**
   * Handle resignation
   */
  public async handleResign(
    socket: Socket,
    gameReferenceId: string
  ): Promise<void> {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    await gameSession.handleResignation(socket);

    // Clean up game session after resignation
    setTimeout(() => {
      this.removeGame(gameReferenceId);
    }, 5000); // Give time for clients to receive game_over event
  }

  /**
   * Handle draw offer
   */
  public handleOfferDraw(socket: Socket, gameReferenceId: string): void {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    gameSession.handleDrawOffer(socket);
  }

  /**
   * Handle draw acceptance
   */
  public async handleAcceptDraw(
    socket: Socket,
    gameReferenceId: string
  ): Promise<void> {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    await gameSession.handleDrawAcceptance(socket);

    // Clean up game session after draw
    setTimeout(() => {
      this.removeGame(gameReferenceId);
    }, 5000);
  }

  /**
   * Handle draw decline
   */
  public handleDeclineDraw(socket: Socket, gameReferenceId: string): void {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    gameSession.handleDrawDecline(socket);
    logger.info(`Draw declined`, { game: gameReferenceId });
  }

  /**
   * Handle a spectator joining a game
   */
  public async handleSpectateGame(
    socket: Socket,
    gameReferenceId: string
  ): Promise<void> {
    try {
      logger.info(`Spectator attempting to watch game`, { game: gameReferenceId, socket: socket.id });

      const gameSession = this.games.get(gameReferenceId);

      if (!gameSession) {
        socket.emit("error", { message: "Game session not available for spectating" });
        return;
      }

      // Track socket to game mapping
      if (!this.socketToGames.has(socket.id)) {
        this.socketToGames.set(socket.id, new Set());
      }
      this.socketToGames.get(socket.id)!.add(gameReferenceId);

      gameSession.addSpectator(socket);
    } catch (error) {
      logger.error("Error handling spectate game", error, { game: gameReferenceId });
      socket.emit("error", {
        message: error instanceof Error ? error.message : "Failed to spectate game",
      });
    }
  }

  /**
   * Handle socket disconnection
   */
  public handleDisconnect(socket: Socket): void {
    const gameIds = this.socketToGames.get(socket.id);

    if (!gameIds) {
      return;
    }

    logger.info(`Socket ${socket.id} disconnected from ${gameIds.size} game(s)`);

    // Notify all games this socket was part of
    gameIds.forEach((gameReferenceId) => {
      const gameSession = this.games.get(gameReferenceId);
      if (gameSession) {
        // isSpectator check happens inside handleDisconnect
        gameSession.handleDisconnect(socket);
      }
    });

    // Clean up socket mapping
    this.socketToGames.delete(socket.id);
  }

  /**
   * Handle socket reconnection to a game
   */
  public async handleReconnect(
    socket: Socket,
    gameReferenceId: string,
    userReferenceId: string
  ): Promise<void> {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", { message: "Game not found or has ended" });
      return;
    }

    gameSession.handleReconnect(socket, userReferenceId);

    // Track socket to game mapping
    if (!this.socketToGames.has(socket.id)) {
      this.socketToGames.set(socket.id, new Set());
    }
    this.socketToGames.get(socket.id)!.add(gameReferenceId);
  }

  /**
   * Remove a game session (cleanup after game ends)
   */
  private removeGame(gameReferenceId: string): void {
    const gameSession = this.games.get(gameReferenceId);

    if (gameSession) {
      gameSession.destroy();
      this.games.delete(gameReferenceId);
      trackActiveGames(this.games.size);
      removeGameTraceContext(gameReferenceId);
      logger.info(`Removed game session`, { game: gameReferenceId });
    }
  }

  /**
   * Get count of active games
   */
  public getActiveGameCount(): number {
    return this.games.size;
  }

  /**
   * Get game session by reference ID (for debugging)
   */
  public getGame(gameReferenceId: string): GameSession | undefined {
    return this.games.get(gameReferenceId);
  }

  /**
   * Flush all live games' clock state to the DB and notify clients of an imminent
   * restart. Called on a Spot interruption notice before graceful shutdown.
   */
  public async flushAllGames(): Promise<void> {
    const sessions = Array.from(this.games.values());
    logger.info(`Flushing ${sessions.length} active game(s) before shutdown`);
    await Promise.allSettled(
      sessions.map((session) => {
        session.notifyServerRestart();
        return session.flushStateToDb();
      })
    );
  }

  /**
   * Clean up all games (for server shutdown)
   */
  public destroy(): void {
    this.games.forEach((gameSession, gameReferenceId) => {
      gameSession.destroy();
      removeGameTraceContext(gameReferenceId);
    });
    this.games.clear();
    this.socketToGames.clear();
    logger.info("GameManager destroyed");
  }
}
