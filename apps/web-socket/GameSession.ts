import { Chess, Color, Move, Square } from "chess.js";
import { Socket } from "socket.io";
import { ClockManager } from "./ClockManager";
import {
  GameData,
  PlayerConnection,
  PlayerInfo,
  GameStartedPayload,
  MoveMadePayload,
  GameOverPayload,
  GameResult,
  GameEndMethod,
  ClockUpdatePayload,
  AnalysisPhaseStartedPayload,
  SpectatorStatePayload,
  SpectatorCountPayload,
} from "./types";
import { persistMove, completeGame, updateGameState } from "./utils/apiClient";
import { logger } from "./utils/logger";
import { trackGameDuration } from "./utils/sentry";

/**
 * GameSession manages the state and logic for a single chess game
 */
export class GameSession {
  private gameData: GameData;
  private chess: Chess;
  private clockManager: ClockManager;

  private whitePlayer: PlayerConnection | null = null;
  private blackPlayer: PlayerConnection | null = null;
  private creatorPlayer: PlayerConnection | null = null;
  private opponentPlayer: PlayerConnection | null = null;

  private gameStarted: boolean = false;
  private gameEnded: boolean = false;

  // AI game fields
  private isAIGame: boolean = false;
  private humanPlayerColor: Color | null = null;
  private botColor: Color | null = null;
  private aiDifficulty: "easy" | "medium" | "hard" | "expert" = "medium";

  // Timing
  private readonly sessionCreatedAt: number = Date.now();

  // Disconnect handling
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DISCONNECT_GRACE_PERIOD = 30000; // 30 seconds

  // Spectators
  private spectators: Set<Socket> = new Set();
  private lastGameOverPayload: GameOverPayload | null = null;

  // Analysis phase
  private isAnalysisPhase: boolean = false;
  private analysisTickInterval: NodeJS.Timeout | null = null;
  private analysisExpiryTimeout: NodeJS.Timeout | null = null;
  private analysisRemainingSeconds: number = 0;
  private analysisTotalSeconds: number = 0;

  constructor(gameData: GameData) {
    this.gameData = gameData;

    // Initialize chess instance with the starting FEN from database
    this.chess = new Chess(gameData.startingFen);

    // Detect AI game from gameData
    logger.debug("GameSession constructor - detecting game mode", { game: this.gameData.referenceId, gameMode: gameData.gameData?.gameMode || "unknown" });

    if (gameData.gameData?.gameMode === "AI") {
      this.isAIGame = true;
      this.aiDifficulty = (gameData.gameData.difficulty as "easy" | "medium" | "hard" | "expert") || "medium";
      // Player color from gameData
      const playerColor = gameData.gameData.playerColor;
      this.humanPlayerColor = playerColor === "white" ? "w" : "b";
      this.botColor = playerColor === "white" ? "b" : "w";
      logger.info(`AI game detected - Player: ${this.humanPlayerColor}, Bot: ${this.botColor}, Difficulty: ${this.aiDifficulty}`, { game: this.gameData.referenceId });
    } else {
      logger.debug(`Not an AI game - gameMode: ${gameData.gameData?.gameMode}`, { game: this.gameData.referenceId });
    }

    // Initialize clock manager
    this.clockManager = new ClockManager(
      {
        initialTime: gameData.initialTimeSeconds,
        increment: gameData.incrementSeconds,
      },
      gameData.creatorTimeRemaining * 1000,
      gameData.opponentTimeRemaining * 1000
    );

    // Set up clock event handlers
    this.clockManager.setOnClockUpdate((whiteTime, blackTime) => {
      this.broadcastClockUpdate(whiteTime, blackTime);
    });

    this.clockManager.setOnTimeout((color) => {
      this.handleTimeout(color);
    });

    logger.info(`GameSession created with starting FEN: ${gameData.startingFen}`, { game: gameData.referenceId });
  }

  public async setGameData(gameData: GameData): Promise<void> {
    this.gameData = gameData;
  }

  /**
   * Check if player is already in the game
   */
  public isPlayerInGame(userReferenceId: string): boolean {
    return (
      this.creatorPlayer?.userReferenceId === userReferenceId ||
      this.opponentPlayer?.userReferenceId === userReferenceId
    );
  }

  /**
   * Check if game has started
   */
  public isGameStarted(): boolean {
    return this.gameStarted;
  }

  /**
   * Add a player to the game session
   */
  public async addPlayer(
    socket: Socket,
    userReferenceId: string
  ): Promise<void> {
    const isCreator = userReferenceId === this.gameData.creator.userReferenceId;
    const isOpponent = userReferenceId === this.gameData.opponent?.userReferenceId;

    logger.debug(`Attempting to add player: ${userReferenceId}, isCreator=${isCreator}, isOpponent=${isOpponent}, isAIGame=${this.isAIGame}`, { game: this.gameData.referenceId });

    if (!isCreator && !isOpponent) {
      throw new Error(`User ${userReferenceId} is not part of game ${this.gameData.referenceId}. Creator: ${this.gameData.creator.userReferenceId}, Opponent: ${this.gameData.opponent?.userReferenceId || 'null'}`);
    }

    // Store creator or opponent
    if (isCreator) {
      const playerInfo = this.gameData.creator;
      this.creatorPlayer = {
        socket,
        userReferenceId,
        color: "w", // Will be assigned properly when game starts
        playerInfo,
      };
      socket.join(this.gameData.referenceId);
      logger.info(`Creator joined game`, { game: this.gameData.referenceId });
    } else if (isOpponent) {
      const playerInfo = this.gameData.opponent!;
      this.opponentPlayer = {
        socket,
        userReferenceId,
        color: "b", // Will be assigned properly when game starts
        playerInfo,
      };
      socket.join(this.gameData.referenceId);
      logger.info(`Opponent joined game`, { game: this.gameData.referenceId });
    }

    // For AI games, start immediately when the human player joins
    if (this.isAIGame && !this.gameStarted && this.gameData.status === "IN_PROGRESS") {
      // Determine which player is the human
      const humanPlayerReferenceId = this.gameData.gameData?.playerReferenceId;
      const isHumanPlayer = userReferenceId === humanPlayerReferenceId;

      if (isHumanPlayer) {
        logger.info("Human player joined AI game - starting immediately", { game: this.gameData.referenceId });
        await this.startAIGame(socket, userReferenceId);
        return;
      }
    }

    // For regular games, wait for both players
    if (
      this.creatorPlayer &&
      this.opponentPlayer &&
      !this.gameStarted &&
      this.gameData.status === "IN_PROGRESS"
    ) {
      await this.startGame();
    }
  }

  /**
   * Start the game when both players are connected
   */
  private async startGame(): Promise<void> {
    if (!this.creatorPlayer || !this.opponentPlayer) {
      throw new Error("Both players must be present to start game");
    }

    // Randomly assign colors to players
    const creatorGetsWhite = Math.random() < 0.5;
    if (creatorGetsWhite) {
      this.whitePlayer = this.creatorPlayer;
      this.blackPlayer = this.opponentPlayer;
    } else {
      this.whitePlayer = this.opponentPlayer;
      this.blackPlayer = this.creatorPlayer;
    }
    this.whitePlayer.color = "w";
    this.blackPlayer.color = "b";

    // Enter analysis phase instead of starting immediately
    this.isAnalysisPhase = true;

    const analysisTime = this.getAnalysisTime();
    const positionInfo = this.gameData.gameData?.positionInfo;

    // Emit analysis_phase_started to both players
    const whitePayload: AnalysisPhaseStartedPayload = {
      gameReferenceId: this.gameData.referenceId,
      analysisTimeSeconds: analysisTime,
      yourColor: "w",
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      whitePlayer: this.whitePlayer.playerInfo,
      blackPlayer: this.blackPlayer.playerInfo,
      positionInfo: positionInfo || undefined,
    };

    const blackPayload: AnalysisPhaseStartedPayload = {
      ...whitePayload,
      yourColor: "b",
    };

    this.whitePlayer.socket.emit("analysis_phase_started", whitePayload);
    this.blackPlayer.socket.emit("analysis_phase_started", blackPayload);

    // Broadcast to spectators without yourColor
    const { yourColor: _, ...spectatorPayload } = whitePayload;
    this.broadcastToSpectators("analysis_phase_started", spectatorPayload);

    // Start server-authoritative countdown
    this.startAnalysisTimer();

    logger.info(`Entering analysis phase (${analysisTime}s) - server timer started`, { game: this.gameData.referenceId });
  }

  /**
   * Start an AI game when the human player connects
   * In AI games, the bot doesn't have a socket - moves are sent from the client
   */
  private async startAIGame(socket: Socket, userReferenceId: string): Promise<void> {
    // Create bot player info
    const botPlayerInfo: PlayerInfo = {
      userReferenceId: this.gameData.gameData?.botReferenceId || "bot",
      name: this.gameData.gameData?.botName || "Chess Bot",
      code: "BOT",
      profilePictureUrl: null,
    };

    // Determine human player info
    const isCreator = userReferenceId === this.gameData.creator.userReferenceId;
    const humanPlayerInfo = isCreator ? this.gameData.creator : this.gameData.opponent!;

    // Create player connection for human
    const humanPlayer: PlayerConnection = {
      socket,
      userReferenceId,
      color: this.humanPlayerColor!,
      playerInfo: humanPlayerInfo,
    };

    // Assign white/black players based on configured color
    if (this.humanPlayerColor === "w") {
      this.whitePlayer = humanPlayer;
      // Create a virtual black player for the bot (no socket)
      this.blackPlayer = {
        socket: socket, // Use human's socket for broadcasts
        userReferenceId: botPlayerInfo.userReferenceId,
        color: "b",
        playerInfo: botPlayerInfo,
      };
    } else {
      this.blackPlayer = humanPlayer;
      // Create a virtual white player for the bot
      this.whitePlayer = {
        socket: socket, // Use human's socket for broadcasts
        userReferenceId: botPlayerInfo.userReferenceId,
        color: "w",
        playerInfo: botPlayerInfo,
      };
    }

    // Store references
    if (isCreator) {
      this.creatorPlayer = humanPlayer;
    } else {
      this.opponentPlayer = humanPlayer;
    }

    // Enter analysis phase instead of starting immediately
    this.isAnalysisPhase = true;

    const analysisTime = this.getAnalysisTime();
    const positionInfo = this.gameData.gameData?.positionInfo;

    // Emit analysis_phase_started to the human player
    const payload: AnalysisPhaseStartedPayload = {
      gameReferenceId: this.gameData.referenceId,
      analysisTimeSeconds: analysisTime,
      yourColor: this.humanPlayerColor!,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      whitePlayer: this.whitePlayer!.playerInfo,
      blackPlayer: this.blackPlayer!.playerInfo,
      isAIGame: true,
      difficulty: this.aiDifficulty,
      positionInfo: positionInfo || undefined,
    };

    socket.emit("analysis_phase_started", payload);

    // Broadcast to spectators without yourColor
    const { yourColor: _, ...spectatorPayload } = payload;
    this.broadcastToSpectators("analysis_phase_started", spectatorPayload);

    // Start server-authoritative countdown
    this.startAnalysisTimer();

    logger.info(`AI game entering analysis phase (${analysisTime}s) - Human: ${this.humanPlayerColor}, Bot: ${this.botColor}, server timer started`, { game: this.gameData.referenceId });
  }

  /**
   * Handle a move attempt from a player
   */
  public async makeMove(
    socket: Socket,
    from: Square,
    to: Square,
    promotion?: "q" | "r" | "b" | "n"
  ): Promise<void> {
    if (this.gameEnded) {
      socket.emit("move_error", { message: "Game has ended", fen: this.chess.fen() });
      return;
    }

    // Block moves during analysis phase
    if (this.isAnalysisPhase) {
      socket.emit("move_error", {
        message: "Analysis in progress. Please wait for the countdown to finish.",
        fen: this.chess.fen(),
      });
      return;
    }

    if (!this.gameStarted) {
      socket.emit("move_error", { message: "Game has not started yet", fen: this.chess.fen() });
      return;
    }

    // Verify it's this player's turn
    const currentTurn = this.chess.turn();
    const player = this.getPlayerBySocket(socket);

    if (!player) {
      socket.emit("move_error", { message: "You are not in this game", fen: this.chess.fen() });
      return;
    }

    // In AI games, allow the human player's socket to make moves for both sides
    // The client sends bot moves from the human's socket
    if (this.isAIGame) {
      // In AI games, the human player can make moves for both colors
      // (they send their own moves AND the bot's moves computed client-side)
      const isHumanPlayer = player.color === this.humanPlayerColor;
      if (!isHumanPlayer) {
        socket.emit("move_error", { message: "You are not in this game", fen: this.chess.fen() });
        return;
      }
      // Allow the move regardless of whose turn it is
      // The client will only send moves at the appropriate time
    } else {
      // Regular game: strict turn checking
      if (player.color !== currentTurn) {
        socket.emit("move_error", { message: "It's not your turn", fen: this.chess.fen() });
        return;
      }
    }

    // Attempt the move
    let move: Move;
    try {
      move = this.chess.move({ from, to, promotion: promotion || "q" });
    } catch (error) {
      socket.emit("move_error", { message: "Invalid move", fen: this.chess.fen() });
      return;
    }

    logger.info(`Move made: ${move.san}${this.isAIGame ? " (AI game)" : ""}`, { game: this.gameData.referenceId });

    // Stop current player's clock and add increment
    this.clockManager.stopClock();
    this.clockManager.addIncrement(currentTurn);

    // Start opponent's clock
    const nextTurn = this.chess.turn();
    this.clockManager.startClock(nextTurn);

    // Prepare move payload
    const moveMadePayload: MoveMadePayload = {
      from: move.from,
      to: move.to,
      san: move.san,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      turn: nextTurn,
      promotion: move.promotion,
    };

    // Broadcast to player (in AI games, just emit to the human player)
    if (this.isAIGame) {
      socket.emit("move_made", moveMadePayload);
    } else {
      this.broadcast("move_made", moveMadePayload);
    }
    this.broadcastToSpectators("move_made", moveMadePayload);

    // Check for game end conditions
    if (this.chess.isGameOver()) {
      await this.handleGameOver();
      return;
    }

    // Persist move to database (async, non-blocking)
    // For AI games, use the appropriate player reference ID
    const movePlayerId = this.isAIGame && currentTurn === this.botColor
      ? this.gameData.gameData?.botReferenceId || player.userReferenceId
      : player.userReferenceId;

    this.persistMoveToDb(movePlayerId, move).catch((error) => {
      logger.error("Error persisting move to DB", error, { game: this.gameData.referenceId });
    });
  }

  /**
   * Handle resignation
   */
  public async handleResignation(socket: Socket): Promise<void> {
    if (this.gameEnded) {
      return;
    }

    const player = this.getPlayerBySocket(socket);
    if (!player) {
      return;
    }

    const winner = player.color === "w" ? "b" : "w";
    const result: GameResult = this.getGameResult(winner);

    await this.endGame(result, winner, "resignation");
  }

  /**
   * Handle draw offer
   */
  public handleDrawOffer(socket: Socket): void {
    if (this.gameEnded) {
      return;
    }

    const player = this.getPlayerBySocket(socket);
    if (!player) {
      return;
    }

    // Notify opponent
    const opponent = player.color === "w" ? this.blackPlayer : this.whitePlayer;
    if (opponent) {
      opponent.socket.emit("draw_offered", {});
    }
  }

  /**
   * Handle draw acceptance
   */
  public async handleDrawAcceptance(socket: Socket): Promise<void> {
    if (this.gameEnded) {
      return;
    }

    await this.endGame("DRAW", null, "draw_agreement");
  }

  /**
   * Handle draw decline
   */
  public handleDrawDecline(socket: Socket): void {
    if (this.gameEnded) {
      return;
    }

    const player = this.getPlayerBySocket(socket);
    if (!player) {
      return;
    }

    // Notify the opponent who offered the draw that it was declined
    const opponent = player.color === "w" ? this.blackPlayer : this.whitePlayer;
    if (opponent) {
      opponent.socket.emit("draw_declined", {});
    }
  }

  /**
   * Handle player disconnection
   */
  public handleDisconnect(socket: Socket): void {
    // Check if this is a spectator first
    if (this.isSpectator(socket)) {
      this.removeSpectator(socket);
      return;
    }

    const player = this.getPlayerBySocket(socket);
    if (!player) {
      return;
    }

    logger.info(`Player ${player.userReferenceId} disconnected`, { game: this.gameData.referenceId });

    // In AI games, if the human disconnects, end the game (bot wins)
    if (this.isAIGame && this.gameStarted && !this.gameEnded) {
      const isHumanPlayer = player.color === this.humanPlayerColor;
      if (isHumanPlayer) {
        logger.info("Human player disconnected from AI game - starting grace period", { game: this.gameData.referenceId });
        // Start disconnect timer - if human doesn't reconnect, bot wins
        const timer = setTimeout(async () => {
          logger.info("Human player did not reconnect to AI game - bot wins", { game: this.gameData.referenceId });
          const result: GameResult = this.botColor === "w" ? "CREATOR_WON" : "OPPONENT_WON";
          await this.endGame(result, this.botColor, "timeout");
        }, this.DISCONNECT_GRACE_PERIOD);
        this.disconnectTimers.set(player.userReferenceId, timer);
      }
      return;
    }

    // Regular game disconnect handling
    // Notify opponent
    const opponent =
      player === this.whitePlayer ? this.blackPlayer : this.whitePlayer;
    if (opponent && this.gameStarted && !this.gameEnded) {
      opponent.socket.emit("opponent_disconnected", {});

      // Start disconnect timer
      const timer = setTimeout(async () => {
        logger.info(`Player ${player.userReferenceId} did not reconnect in time`, { game: this.gameData.referenceId });
        // Player forfeits
        const result: GameResult =
          player.color === "w" ? "OPPONENT_WON" : "CREATOR_WON";
        await this.endGame(result, opponent.color, "timeout");
      }, this.DISCONNECT_GRACE_PERIOD);

      this.disconnectTimers.set(player.userReferenceId, timer);
    }
  }

  /**
   * Handle player reconnection
   */
  public handleReconnect(socket: Socket, userReferenceId: string): void {
    const isCreator = userReferenceId === this.gameData.creator.userReferenceId;
    const isOpponent = userReferenceId === this.gameData.opponent?.userReferenceId;

    logger.info(`Player ${userReferenceId} reconnecting (isCreator=${isCreator}, isOpponent=${isOpponent}, gameStarted=${this.gameStarted})`, { game: this.gameData.referenceId });

    // Clear disconnect timer if exists
    const timer = this.disconnectTimers.get(userReferenceId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(userReferenceId);
      logger.info(`Cleared disconnect timer for ${userReferenceId}`, { game: this.gameData.referenceId });
    }

    // Update socket references
    if (isCreator && this.creatorPlayer) {
      this.creatorPlayer.socket = socket;
      if (this.whitePlayer?.userReferenceId === userReferenceId) {
        this.whitePlayer.socket = socket;
      }
      if (this.blackPlayer?.userReferenceId === userReferenceId) {
        this.blackPlayer.socket = socket;
      }
      socket.join(this.gameData.referenceId);
    } else if (isOpponent && this.opponentPlayer) {
      this.opponentPlayer.socket = socket;
      if (this.whitePlayer?.userReferenceId === userReferenceId) {
        this.whitePlayer.socket = socket;
      }
      if (this.blackPlayer?.userReferenceId === userReferenceId) {
        this.blackPlayer.socket = socket;
      }
      socket.join(this.gameData.referenceId);
    }

    // Notify opponent of reconnection if game has started
    if (this.gameStarted) {
      const opponent =
        this.whitePlayer?.userReferenceId === userReferenceId
          ? this.blackPlayer
          : this.whitePlayer;

      if (opponent) {
        opponent.socket.emit("opponent_reconnected", {});
        logger.info("Notified opponent of reconnection", { game: this.gameData.referenceId });
      }

      // Send current game state to reconnected player
      const positionInfo = this.gameData.gameData?.positionInfo;
      socket.emit("game_started", {
        gameReferenceId: this.gameData.referenceId,
        yourColor:
          this.whitePlayer?.userReferenceId === userReferenceId ? "w" : "b",
        fen: this.chess.fen(),
        whiteTime: this.clockManager.getTimeInSeconds("w"),
        blackTime: this.clockManager.getTimeInSeconds("b"),
        whitePlayer: this.whitePlayer!.playerInfo,
        blackPlayer: this.blackPlayer!.playerInfo,
        positionInfo: positionInfo || undefined,
      });
      logger.info("Sent game state to reconnected player", { game: this.gameData.referenceId });
    } else if (this.isAnalysisPhase) {
      // Reconnecting during analysis phase — send analysis state + current tick
      const reconnectColor = this.whitePlayer?.userReferenceId === userReferenceId ? "w" : "b";
      const positionInfo = this.gameData.gameData?.positionInfo;

      const payload: AnalysisPhaseStartedPayload = {
        gameReferenceId: this.gameData.referenceId,
        analysisTimeSeconds: this.analysisTotalSeconds,
        yourColor: reconnectColor as "w" | "b",
        fen: this.chess.fen(),
        whiteTime: this.clockManager.getTimeInSeconds("w"),
        blackTime: this.clockManager.getTimeInSeconds("b"),
        whitePlayer: this.whitePlayer!.playerInfo,
        blackPlayer: this.blackPlayer!.playerInfo,
        isAIGame: this.isAIGame || undefined,
        difficulty: this.isAIGame ? this.aiDifficulty : undefined,
        positionInfo: positionInfo || undefined,
      };
      socket.emit("analysis_phase_started", payload);

      // Send current tick so client knows where the countdown is
      socket.emit("analysis_tick", {
        remainingSeconds: this.analysisRemainingSeconds,
        totalSeconds: this.analysisTotalSeconds,
      });

      // Notify opponent of reconnection
      if (!this.isAIGame) {
        const opponent = this.whitePlayer?.userReferenceId === userReferenceId
          ? this.blackPlayer
          : this.whitePlayer;
        opponent?.socket.emit("opponent_reconnected", {});
      }

      logger.info(`Sent analysis phase state to reconnected player, remaining: ${this.analysisRemainingSeconds}s`, { game: this.gameData.referenceId });
    } else {
      // Game hasn't started yet, just send waiting status
      socket.emit("waiting_for_opponent", {
        gameReferenceId: this.gameData.referenceId
      });
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.clearAnalysisTimers();
    this.clockManager.destroy();
    this.disconnectTimers.forEach((timer) => clearTimeout(timer));
    this.disconnectTimers.clear();
    this.spectators.clear();
    logger.info("GameSession destroyed", { game: this.gameData.referenceId });
  }

  /**
   * Persist the current (ticking) clocks to the DB so a server restart doesn't
   * roll the game back to the last move's clock values. Used on Spot interruption.
   */
  public async flushStateToDb(): Promise<void> {
    if (!this.gameStarted || this.gameEnded) return;
    await updateGameState({
      gameReferenceId: this.gameData.referenceId,
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      lastMoveAt: new Date(),
    });
  }

  /**
   * Tell players and spectators that the server is restarting so clients can
   * show a "reconnecting" state; socket.io then auto-reconnects to the new box.
   */
  public notifyServerRestart(): void {
    const payload = { gameReferenceId: this.gameData.referenceId };
    this.broadcast("server_restarting", payload);
    this.broadcastToSpectators("server_restarting", payload);
  }

  /**
   * Check if both players are present (or for AI games, just the human player)
   */
  public hasBothPlayers(): boolean {
    if (this.isAIGame) {
      // For AI games, we only need the human player
      return this.gameStarted;
    }
    return this.creatorPlayer !== null && this.opponentPlayer !== null;
  }

  /**
   * Check if this is an AI game
   */
  public getIsAIGame(): boolean {
    return this.isAIGame;
  }

  /**
   * Get game reference ID
   */
  public getGameReferenceId(): string {
    return this.gameData.referenceId;
  }

  // ============================================
  // SPECTATOR METHODS
  // ============================================

  public addSpectator(socket: Socket): void {
    this.spectators.add(socket);

    // Build and emit current state snapshot
    const moveHistory = this.chess.history({ verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      promotion: m.promotion || undefined,
    }));

    const payload: SpectatorStatePayload = {
      gameReferenceId: this.gameData.referenceId,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      whitePlayer: this.whitePlayer?.playerInfo || this.gameData.creator,
      blackPlayer: this.blackPlayer?.playerInfo || this.gameData.opponent || this.gameData.creator,
      moveHistory,
      startingFen: this.gameData.startingFen,
      gameStarted: this.gameStarted,
      isAnalysisPhase: this.isAnalysisPhase,
      analysisRemainingSeconds: this.isAnalysisPhase ? this.analysisRemainingSeconds : undefined,
      analysisTotalSeconds: this.isAnalysisPhase ? this.analysisTotalSeconds : undefined,
      spectatorCount: this.spectators.size,
      positionInfo: this.gameData.gameData?.positionInfo || undefined,
      gameOver: this.gameEnded,
      gameOverPayload: this.lastGameOverPayload || undefined,
    };

    socket.emit("spectator_state", payload);
    this.broadcastSpectatorCount();
    logger.info(`Spectator added (total: ${this.spectators.size})`, { game: this.gameData.referenceId });
  }

  public removeSpectator(socket: Socket): void {
    this.spectators.delete(socket);
    this.broadcastSpectatorCount();
    logger.info(`Spectator removed (total: ${this.spectators.size})`, { game: this.gameData.referenceId });
  }

  public isSpectator(socket: Socket): boolean {
    return this.spectators.has(socket);
  }

  private broadcastToSpectators(event: string, payload: any): void {
    this.spectators.forEach((socket) => {
      socket.emit(event, payload);
    });
  }

  private broadcastSpectatorCount(): void {
    const payload: SpectatorCountPayload = { count: this.spectators.size };
    this.broadcast("spectator_count", payload);
    this.broadcastToSpectators("spectator_count", payload);
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Determine the correct GameResult based on winner color.
   * Looks up whether the winner is the creator or opponent by reference ID,
   * rather than assuming white=creator.
   */
  private getGameResult(winner: Color): GameResult {
    const winnerRefId = winner === "w"
      ? this.whitePlayer?.userReferenceId
      : this.blackPlayer?.userReferenceId;
    return winnerRefId === this.gameData.creator.userReferenceId
      ? "CREATOR_WON"
      : "OPPONENT_WON";
  }

  private getPlayerBySocket(socket: Socket): PlayerConnection | null {
    // In AI games, both players share the human's socket.
    // Any action from this socket belongs to the human player.
    if (this.isAIGame) {
      const humanPlayer = this.humanPlayerColor === "w" ? this.whitePlayer : this.blackPlayer;
      if (humanPlayer?.socket.id === socket.id) return humanPlayer;
      return null;
    }
    if (this.whitePlayer?.socket.id === socket.id) {
      return this.whitePlayer;
    }
    if (this.blackPlayer?.socket.id === socket.id) {
      return this.blackPlayer;
    }
    return null;
  }

  private broadcast(event: string, payload: any): void {
    if (this.whitePlayer) {
      this.whitePlayer.socket.emit(event, payload);
    }
    if (this.blackPlayer) {
      this.blackPlayer.socket.emit(event, payload);
    }
  }

  private broadcastClockUpdate(whiteTime: number, blackTime: number): void {
    const payload: ClockUpdatePayload = { whiteTime, blackTime };
    this.broadcast("clock_update", payload);
    this.broadcastToSpectators("clock_update", payload);
  }

  /**
   * Get analysis time based on game time control
   * Bullet (<3min): 15s, Blitz (<10min): 20s, Rapid: 30s
   */
  private getAnalysisTime(): number {
    const initialTime = this.gameData.initialTimeSeconds;
    if (initialTime < 180) return 15;      // Bullet: 15s
    else if (initialTime < 600) return 20; // Blitz: 20s
    else return 30;                        // Rapid: 30s
  }

  /**
   * Start the server-authoritative analysis phase timer.
   * Emits analysis_tick every second and auto-transitions to game_started on expiry.
   */
  private startAnalysisTimer(): void {
    const analysisTime = this.getAnalysisTime();
    this.analysisTotalSeconds = analysisTime;
    this.analysisRemainingSeconds = analysisTime;

    // Emit the first tick immediately so clients see the full countdown from the start
    this.emitAnalysisTick();

    // Tick every 1 second
    this.analysisTickInterval = setInterval(() => {
      this.analysisRemainingSeconds--;

      if (this.analysisRemainingSeconds > 0) {
        this.emitAnalysisTick();
      } else {
        // Final tick reached 0 — clean up interval (setTimeout handles the transition)
        if (this.analysisTickInterval) {
          clearInterval(this.analysisTickInterval);
          this.analysisTickInterval = null;
        }
      }
    }, 1000);

    // Hard expiry after the full analysis duration
    this.analysisExpiryTimeout = setTimeout(() => {
      this.clearAnalysisTimers();
      if (this.isAnalysisPhase) {
        if (this.isAIGame) {
          this.endAnalysisPhaseForAI();
        } else {
          this.endAnalysisPhase();
        }
      }
    }, analysisTime * 1000);

    logger.info(`Analysis timer started: ${analysisTime}s`, { game: this.gameData.referenceId });
  }

  private emitAnalysisTick(): void {
    const payload = {
      remainingSeconds: this.analysisRemainingSeconds,
      totalSeconds: this.analysisTotalSeconds,
    };

    if (this.isAIGame) {
      const humanPlayer = this.humanPlayerColor === "w" ? this.whitePlayer : this.blackPlayer;
      humanPlayer?.socket.emit("analysis_tick", payload);
    } else {
      this.broadcast("analysis_tick", payload);
    }
    this.broadcastToSpectators("analysis_tick", payload);
  }

  private clearAnalysisTimers(): void {
    if (this.analysisTickInterval) {
      clearInterval(this.analysisTickInterval);
      this.analysisTickInterval = null;
    }
    if (this.analysisExpiryTimeout) {
      clearTimeout(this.analysisExpiryTimeout);
      this.analysisExpiryTimeout = null;
    }
  }

  /**
   * End the analysis phase and start the actual game (PvP)
   */
  private endAnalysisPhase(): void {
    this.clearAnalysisTimers();
    this.isAnalysisPhase = false;
    this.gameStarted = true;

    // Start clock for whoever's turn (from FEN)
    const currentTurn = this.chess.turn();
    this.clockManager.startClock(currentTurn);

    // Emit game_started to both players
    const positionInfo = this.gameData.gameData?.positionInfo;

    const whitePayload: GameStartedPayload = {
      gameReferenceId: this.gameData.referenceId,
      yourColor: "w",
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      whitePlayer: this.whitePlayer!.playerInfo,
      blackPlayer: this.blackPlayer!.playerInfo,
      positionInfo: positionInfo || undefined,
    };

    this.whitePlayer!.socket.emit("game_started", whitePayload);
    this.blackPlayer!.socket.emit("game_started", { ...whitePayload, yourColor: "b" as const });

    // Broadcast to spectators without yourColor
    const { yourColor: _, ...spectatorPayload } = whitePayload;
    this.broadcastToSpectators("game_started", spectatorPayload);

    logger.info(`Analysis phase ended, game started - clock started for ${currentTurn === "w" ? "white" : "black"}`, { game: this.gameData.referenceId });
  }

  /**
   * End the analysis phase for AI games
   */
  private endAnalysisPhaseForAI(): void {
    this.clearAnalysisTimers();
    this.isAnalysisPhase = false;
    this.gameStarted = true;

    // Start the clock for whoever's turn it is according to the FEN
    const currentTurn = this.chess.turn();
    this.clockManager.startClock(currentTurn);

    // Get current socket from player reference (handles reconnection)
    const humanPlayer = this.humanPlayerColor === "w" ? this.whitePlayer : this.blackPlayer;
    if (!humanPlayer) {
      logger.error("No human player found when ending analysis phase", undefined, { game: this.gameData.referenceId });
      return;
    }

    // Emit game_started to the human player with AI game info
    const positionInfo = this.gameData.gameData?.positionInfo;
    const payload: GameStartedPayload = {
      gameReferenceId: this.gameData.referenceId,
      yourColor: this.humanPlayerColor!,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      whitePlayer: this.whitePlayer!.playerInfo,
      blackPlayer: this.blackPlayer!.playerInfo,
      isAIGame: true,
      difficulty: this.aiDifficulty,
      positionInfo: positionInfo || undefined,
    };

    humanPlayer.socket.emit("game_started", payload);

    // Broadcast to spectators without yourColor
    const { yourColor: _, ...spectatorPayload } = payload;
    this.broadcastToSpectators("game_started", spectatorPayload);

    logger.info(`AI game analysis phase ended - clock started for ${currentTurn === "w" ? "white" : "black"}`, { game: this.gameData.referenceId });
  }

  private async handleTimeout(color: Color): Promise<void> {
    logger.info(`Timeout for ${color === "w" ? "White" : "Black"}`, { game: this.gameData.referenceId });

    const winner = color === "w" ? "b" : "w";
    const result: GameResult = this.getGameResult(winner);

    await this.endGame(result, winner, "timeout");
  }

  private async handleGameOver(): Promise<void> {
    let result: GameResult;
    let winner: Color | null = null;
    let method: GameEndMethod;

    if (this.chess.isCheckmate()) {
      // Opponent of current turn wins
      const loser = this.chess.turn();
      winner = loser === "w" ? "b" : "w";
      result = this.getGameResult(winner);
      method = "checkmate";
    } else if (this.chess.isStalemate()) {
      result = "DRAW";
      method = "stalemate";
    } else if (this.chess.isInsufficientMaterial()) {
      result = "DRAW";
      method = "insufficient_material";
    } else if (this.chess.isDraw()) {
      result = "DRAW";
      method = "draw_agreement";
    } else {
      // Shouldn't reach here, but handle it
      result = "DRAW";
      method = "draw_agreement";
    }

    await this.endGame(result, winner, method);
  }

  private async endGame(
    result: GameResult,
    winner: Color | null,
    method: GameEndMethod
  ): Promise<void> {
    if (this.gameEnded) {
      return;
    }

    this.gameEnded = true;
    this.clearAnalysisTimers();
    this.isAnalysisPhase = false;
    this.clockManager.stopClock();

    // Track game duration
    const durationSeconds = Math.round((Date.now() - this.sessionCreatedAt) / 1000);
    trackGameDuration(durationSeconds, { result, method });

    const gameOverPayload: GameOverPayload = {
      result,
      winner,
      method,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
    };

    this.lastGameOverPayload = gameOverPayload;
    this.broadcast("game_over", gameOverPayload);
    this.broadcastToSpectators("game_over", gameOverPayload);

    logger.info(`Game ended: ${result} by ${method}`, { game: this.gameData.referenceId });

    // Persist game result to database
    const winnerId =
      winner === "w"
        ? this.whitePlayer?.userReferenceId
        : winner === "b"
        ? this.blackPlayer?.userReferenceId
        : undefined;

    await completeGame({
      gameReferenceId: this.gameData.referenceId,
      result,
      winnerId,
      method,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
    }).catch((error) => {
      logger.error("Error completing game in DB", error, { game: this.gameData.referenceId });
    });
  }

  private async persistMoveToDb(
    userReferenceId: string,
    move: Move
  ): Promise<void> {
    await persistMove({
      gameReferenceId: this.gameData.referenceId,
      userReferenceId,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      fen: this.chess.fen(),
      moveHistory: this.chess.history({ verbose: true }),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
    });
  }
}
