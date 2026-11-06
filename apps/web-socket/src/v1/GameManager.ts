import { Socket } from "socket.io";
import * as Sentry from "@sentry/node";
import { GameSession, GameSessionOptions, RestoreError, SocketError, errorPayload } from "./GameSession";
import { GameData } from "./types";
import { ApiError, fetchGameByRef } from "./utils/apiClient";
import { logger } from "./utils/logger";
import { trackActiveGames } from "./utils/sentry";

export interface GameManagerOptions {
  /** How long an ended session stays in memory (rematch window, late joins). Default 60 s. */
  evictAfterEndMs?: number;
  /** Passed to every GameSession (tests shorten the grace period and the study phase). */
  session?: Omit<GameSessionOptions, "onEnded">;
}

/** Turns any error into the `error` payload a client may see: a code and a message without ids. */
function joinErrorPayload(error: unknown) {
  if (error instanceof SocketError) return errorPayload(error.code, error.message);
  if (error instanceof ApiError && error.status === 404) return errorPayload("not_found", "Game not found");
  return errorPayload("internal", "Failed to join game");
}

/**
 * GameManager manages all active game sessions
 * Routes socket events to appropriate game sessions
 */
export class GameManager {
  private games: Map<string, GameSession> = new Map();
  // Map socket ID to game reference IDs for quick lookup on disconnect
  private socketToGames: Map<string, Set<string>> = new Map();
  // Eviction timers of ended sessions (H6 #8)
  private evictionTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly evictAfterEndMs: number;
  private readonly sessionOptions: Omit<GameSessionOptions, "onEnded">;

  constructor(options: GameManagerOptions = {}) {
    this.evictAfterEndMs = options.evictAfterEndMs ?? 60_000;
    this.sessionOptions = options.session ?? {};
  }

  private createSession(gameData: GameData): GameSession {
    return new GameSession(gameData, {
      ...this.sessionOptions,
      onEnded: (gameReferenceId) => this.scheduleEviction(gameReferenceId),
    });
  }

  /**
   * Handle a player joining a game. `userReferenceId` is the verified identity (index.ts
   * resolves it from the handshake token).
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

      // An ended session answers with the result, never with a live board (H6 #8).
      if (gameSession?.isEnded()) {
        this.emitGameOverSnapshot(socket, gameSession);
        return;
      }

      if (!gameSession) {
        // Fetch game data from API
        gameData = await fetchGameByRef(gameReferenceId);

        // Re-check after async fetch — safe because Node.js is single-threaded;
        // the only yield point is the await above, so no synchronous interleaving
        gameSession = this.games.get(gameReferenceId);
        if (gameSession) {
          if (gameSession.isEnded()) {
            this.emitGameOverSnapshot(socket, gameSession);
            return;
          }
          isReconnection = gameSession.isPlayerInGame(userReferenceId);
          // Update session with our fresh data (covers concurrent join)
          await gameSession.setGameData(gameData);
          logger.info(`Session created by concurrent join, isReconnection: ${isReconnection}`, { game: gameReferenceId, user: userReferenceId });
        } else {
          logger.debug(`Fetched game data: gameMode=${gameData.gameData?.gameMode}`, { game: gameReferenceId });

          // Validate game status
          if (gameData.status === "COMPLETED") {
            socket.emit("error", errorPayload("game_completed", "Game is not available (status: COMPLETED)"));
            return;
          }
          if (
            gameData.status !== "WAITING_FOR_OPPONENT" &&
            gameData.status !== "IN_PROGRESS"
          ) {
            socket.emit("error", errorPayload("game_unavailable", `Game is not available (status: ${gameData.status})`));
            return;
          }

          // Bot games moved to the client-run v3 screen (phase-02 plan 3.1: the v1 AI path is deleted).
          if (gameData.gameData?.gameMode === "AI") {
            socket.emit("error", errorPayload("game_unavailable", "Bot games are played on the new game screen."));
            return;
          }

          // Create new game session (an IN_PROGRESS game is restored by replaying its moves;
          // an unreadable history throws RestoreError and no session is created).
          gameSession = this.createSession(gameData);
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
      if (error instanceof RestoreError) {
        // Refuse the restore: keep the DB row as it is, tell the client (plan §8.8).
        logger.error(`restore_failed at ply ${error.ply}`, undefined, { game: gameReferenceId });
        Sentry.captureMessage("restore_failed", {
          level: "error",
          tags: { "game.referenceId": gameReferenceId },
          extra: { ply: error.ply },
        });
      } else if (!(error instanceof SocketError)) {
        logger.error("Error handling join game", error, { game: gameReferenceId });
      }
      socket.emit("error", joinErrorPayload(error));
    }
  }

  private emitGameOverSnapshot(socket: Socket, gameSession: GameSession): void {
    const snapshot = gameSession.getGameOverSnapshot();
    if (snapshot) {
      socket.emit("game_over", snapshot);
    } else {
      socket.emit("error", errorPayload("game_completed", "Game is not available (status: COMPLETED)"));
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
      socket.emit("move_error", { code: "not_found", message: "Game not found" });
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
      socket.emit("error", errorPayload("not_found", "Game not found"));
      return;
    }

    // Eviction is scheduled by the session's onEnded callback.
    await gameSession.handleResignation(socket);
  }

  /**
   * Handle draw offer
   */
  public handleOfferDraw(socket: Socket, gameReferenceId: string): void {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", errorPayload("not_found", "Game not found"));
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
      socket.emit("error", errorPayload("not_found", "Game not found"));
      return;
    }

    // Rejected accepts leave the game running; eviction follows only a real end (onEnded).
    await gameSession.handleDrawAcceptance(socket);
  }

  /**
   * Handle draw decline
   */
  public handleDeclineDraw(socket: Socket, gameReferenceId: string): void {
    const gameSession = this.games.get(gameReferenceId);

    if (!gameSession) {
      socket.emit("error", errorPayload("not_found", "Game not found"));
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
        socket.emit("error", errorPayload("not_found", "Game session not available for spectating"));
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
      socket.emit("error", errorPayload("internal", "Failed to spectate game"));
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
      socket.emit("error", errorPayload("not_found", "Game not found or has ended"));
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
   * Evict an ended session after the rematch window (every end path calls this through the
   * session's onEnded callback).
   */
  private scheduleEviction(gameReferenceId: string): void {
    if (this.evictionTimers.has(gameReferenceId)) return;
    const timer = setTimeout(() => {
      this.evictionTimers.delete(gameReferenceId);
      this.removeGame(gameReferenceId);
    }, this.evictAfterEndMs);
    timer.unref?.();
    this.evictionTimers.set(gameReferenceId, timer);
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
      logger.info(`Removed game session`, { game: gameReferenceId });
    }
  }

  /** True when the socket plays or watches at least one game here. */
  public hasSocket(socketId: string): boolean {
    return (this.socketToGames.get(socketId)?.size ?? 0) > 0;
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
   * Drain before shutdown (H6 #13, AS F-16): tell every game's players and spectators that the
   * server is restarting, save the running clocks, and wait for every web write still in flight,
   * all within `timeoutMs`. The next server restores the games by replaying their stored moves.
   */
  public async drain(timeoutMs: number): Promise<void> {
    const sessions = Array.from(this.games.values());
    logger.info(`Draining ${sessions.length} game session(s) before shutdown`);
    const deadline = Date.now() + timeoutMs;

    for (const session of sessions) {
      // Freeze clocks and refuse new moves first, so the saved clocks are exact and no
      // timeout fires while the server is going away.
      session.beginDrain();
      session.notifyServerRestart();
    }
    // Start the clock flushes (tracked as pending writes), then wait for every write.
    for (const session of sessions) {
      session.flushStateToDb().catch((error) => {
        logger.error("Clock flush failed during drain", error, { game: session.getGameReferenceId() });
      });
    }
    const results = await Promise.all(
      sessions.map((session) => session.flushPendingWrites(Math.max(0, deadline - Date.now())))
    );
    const unfinished = results.filter((done) => !done).length;
    if (unfinished > 0) {
      logger.warn(`Drain deadline passed with writes still pending in ${unfinished} game(s)`);
    }
  }

  /**
   * Clean up all games (for server shutdown)
   */
  public destroy(): void {
    this.evictionTimers.forEach((timer) => clearTimeout(timer));
    this.evictionTimers.clear();
    this.games.forEach((gameSession) => {
      gameSession.destroy();
    });
    this.games.clear();
    this.socketToGames.clear();
    logger.info("GameManager destroyed");
  }
}
