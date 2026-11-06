import { Chess, Color, Move, Square } from "chess.js";
import { Socket } from "socket.io";
import * as Sentry from "@sentry/node";
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

// ============================================
// ERROR CODES (plan §7.5 #3, protocol v1)
// ============================================

/**
 * Codes sent as `error { code, message }`. Messages never carry user or game ids. The web
 * client maps codes, not message text (`GamePageContent.tsx`). The messages keep the old
 * wording fragments ("not part of", "status: COMPLETED") so clients built before the code
 * mapping still behave until the web deploy lands (deploy order: socket first).
 */
export type SocketErrorCode =
  | "unauthorized"
  | "bad_request"
  | "not_player"
  | "not_found"
  | "game_completed"
  | "game_unavailable"
  | "no_pending_offer"
  | "restore_failed"
  | "internal";

export class SocketError extends Error {
  constructor(
    readonly code: SocketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SocketError";
  }
}

/** Payload of the `error` event. */
export function errorPayload(code: SocketErrorCode, message: string): { code: SocketErrorCode; message: string } {
  return { code, message };
}

// ============================================
// RESTORE BY REPLAY (plan §7.5 #12, §8.8)
// ============================================

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

type ReplayableMove = { from: string; to: string; promotion?: string } | string;

/** Normalises one stored `moveHistory` entry (verbose chess.js move, SAN or UCI string). */
function toReplayableMove(entry: unknown): ReplayableMove | null {
  if (typeof entry === "string") {
    const uci = UCI_MOVE.exec(entry);
    if (uci) return { from: uci[1]!, to: uci[2]!, promotion: uci[3] };
    return entry;
  }
  if (entry && typeof entry === "object") {
    const { from, to, promotion, san } = entry as { from?: unknown; to?: unknown; promotion?: unknown; san?: unknown };
    if (typeof from === "string" && typeof to === "string") {
      return { from, to, promotion: typeof promotion === "string" ? promotion : undefined };
    }
    if (typeof san === "string") return san;
  }
  return null;
}

/** Thrown when a stored history cannot be replayed from the starting FEN. */
export class RestoreError extends SocketError {
  constructor(readonly ply: number) {
    super("restore_failed", `The saved moves of this game could not be restored (ply ${ply}).`);
    this.name = "RestoreError";
  }
}

/**
 * Rebuilds a game by replaying `moveHistory` from `startingFen` (never by loading a FEN, so
 * repetition detection keeps working). Throws `RestoreError` at the first illegal or
 * unreadable entry; the caller then refuses the restore instead of starting over.
 */
export function replayMoveHistory(startingFen: string, history: readonly unknown[]): Chess {
  const chess = new Chess(startingFen);
  history.forEach((entry, index) => {
    const move = toReplayableMove(entry);
    if (move === null) throw new RestoreError(index + 1);
    try {
      chess.move(move);
    } catch {
      throw new RestoreError(index + 1);
    }
  });
  return chess;
}

// ============================================
// SESSION
// ============================================

export interface GameSessionOptions {
  /** Time a disconnected player has to come back before forfeiting. Default 30 s. */
  disconnectGraceMs?: number;
  /** Replaces the 15/20/30 s study phase (tests only). */
  analysisSecondsOverride?: number;
  /** Called once when the game ends by any path (GameManager evicts the session later). */
  onEnded?: (gameReferenceId: string) => void;
}

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

  // Timing
  private readonly sessionCreatedAt: number = Date.now();

  // Disconnect handling
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DISCONNECT_GRACE_PERIOD: number; // default 30 seconds

  // Spectators
  private spectators: Set<Socket> = new Set();
  private lastGameOverPayload: GameOverPayload | null = null;

  // Analysis phase
  private isAnalysisPhase: boolean = false;
  private analysisTickInterval: NodeJS.Timeout | null = null;
  private analysisExpiryTimeout: NodeJS.Timeout | null = null;
  private analysisRemainingSeconds: number = 0;
  private analysisTotalSeconds: number = 0;

  // Draw offer (plan §8.8): the userReferenceId of the player with a pending offer.
  // Cleared by any move, a decline, or the end of the game.
  private drawOfferBy: string | null = null;

  // Plies replayed from the stored history at creation (H6 #12). A restored game skips the
  // study phase and resumes play as soon as its players are back.
  private readonly restoredPlies: number;

  // Web writes still in flight (moves, clock flushes, the result), awaited before the result
  // is sent and on drain (H6 #7, #13).
  private pendingWrites: Set<Promise<unknown>> = new Set();

  // Set by beginDrain() when the server is shutting down.
  private draining: boolean = false;

  private readonly options: GameSessionOptions;

  constructor(gameData: GameData, options: GameSessionOptions = {}) {
    this.gameData = gameData;
    this.options = options;
    this.DISCONNECT_GRACE_PERIOD = options.disconnectGraceMs ?? 30000;

    // Initialize chess instance with the starting FEN from database, replaying the stored
    // moves of a game that is already in progress (restart, deploy, eviction).
    const storedHistory = gameData.gameData?.moveHistory;
    if (gameData.status === "IN_PROGRESS" && Array.isArray(storedHistory) && storedHistory.length > 0) {
      this.chess = replayMoveHistory(gameData.startingFen, storedHistory);
      this.restoredPlies = storedHistory.length;
      const storedFen = gameData.gameData?.fen;
      if (storedFen && storedFen !== this.chess.fen()) {
        logger.warn(`Restored position differs from the stored FEN; the replay wins`, {
          game: gameData.referenceId,
          plies: String(this.restoredPlies),
        });
      }
      logger.info(`Restored game by replaying ${this.restoredPlies} plies`, { game: gameData.referenceId });
    } else {
      this.chess = new Chess(gameData.startingFen);
      this.restoredPlies = 0;
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

    logger.debug(`Attempting to add player: ${userReferenceId}, isCreator=${isCreator}, isOpponent=${isOpponent}`, { game: this.gameData.referenceId });

    if (!isCreator && !isOpponent) {
      logger.info(`Join refused: user is not a player`, { game: this.gameData.referenceId, user: userReferenceId });
      throw new SocketError("not_player", "You are not part of this game.");
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

    // Colours were fixed by the web at creation (`gameData.creatorColor`, H6 #11); never
    // randomise here. Games created before that field existed: the creator plays White, which
    // is what quick, tournament and AI games always did.
    if (this.creatorPlaysWhite()) {
      this.whitePlayer = this.creatorPlayer;
      this.blackPlayer = this.opponentPlayer;
    } else {
      this.whitePlayer = this.opponentPlayer;
      this.blackPlayer = this.creatorPlayer;
    }
    this.whitePlayer.color = "w";
    this.blackPlayer.color = "b";

    // A restored game resumes play directly (no second study phase).
    if (this.restoredPlies > 0) {
      logger.info(`Resuming restored game after ${this.restoredPlies} plies`, { game: this.gameData.referenceId });
      this.endAnalysisPhase();
      // The stored moves already end the game (the result call was lost): finish it now.
      if (this.chess.isGameOver()) await this.handleGameOver();
      return;
    }

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

    if (this.draining) {
      socket.emit("move_error", { message: "The server is restarting. Your game will resume.", fen: this.chess.fen() });
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

    if (player.color !== currentTurn) {
      socket.emit("move_error", { message: "It's not your turn", fen: this.chess.fen() });
      return;
    }

    // Attempt the move
    let move: Move;
    try {
      move = this.chess.move({ from, to, promotion: promotion || "q" });
    } catch (error) {
      socket.emit("move_error", { message: "Invalid move", fen: this.chess.fen() });
      return;
    }

    logger.info(`Move made: ${move.san}`, { game: this.gameData.referenceId });

    // Any move clears a pending draw offer (plan §8.8).
    this.drawOfferBy = null;

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

    this.broadcast("move_made", moveMadePayload);
    this.broadcastToSpectators("move_made", moveMadePayload);

    // Persist the move (async, non-blocking for play). For AI games, use the appropriate
    // player reference ID. The final move is persisted too, before the result (H6 #7):
    // endGame() waits for every in-flight write before it calls game-over.
    const movePlayerId = player.userReferenceId;

    this.trackWrite(
      this.persistMoveToDb(movePlayerId, move).catch((error) => {
        logger.error("Error persisting move to DB", error, { game: this.gameData.referenceId });
      })
    );

    // Check for game end conditions
    if (this.chess.isGameOver()) {
      await this.handleGameOver();
    }
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

    // One offer may be pending at a time.
    if (this.drawOfferBy !== null) {
      return;
    }

    this.drawOfferBy = player.userReferenceId;

    // Notify opponent
    const opponent = player.color === "w" ? this.blackPlayer : this.whitePlayer;
    if (opponent) {
      opponent.socket.emit("draw_offered", {});
    }
  }

  /**
   * Handle draw acceptance (plan §7.5 #1, AS F-01): valid only from a player, and only when the
   * other player has a pending offer. Anything else is rejected and the game continues.
   * Returns true when the game ended in a draw.
   */
  public async handleDrawAcceptance(socket: Socket): Promise<boolean> {
    if (this.gameEnded) {
      return false;
    }

    const player = this.getPlayerBySocket(socket);
    const offerBy = this.drawOfferBy;
    if (!player || offerBy === null || offerBy === player.userReferenceId) {
      const reason = !player ? "not_player" : offerBy === null ? "no_offer" : "own_offer";
      logger.warn(`draw_rejected (${reason})`, { game: this.gameData.referenceId, socket: socket.id });
      Sentry.captureMessage("draw_rejected", {
        level: "warning",
        tags: { "game.referenceId": this.gameData.referenceId, reason },
      });
      socket.emit("error", errorPayload("no_pending_offer", "There is no draw offer to accept."));
      return false;
    }

    await this.endGame("DRAW", null, "draw_agreement");
    return true;
  }

  /**
   * Handle draw decline: only the receiver of a pending offer can decline it.
   */
  public handleDrawDecline(socket: Socket): void {
    if (this.gameEnded) {
      return;
    }

    const player = this.getPlayerBySocket(socket);
    if (!player) {
      return;
    }

    if (this.drawOfferBy === null || this.drawOfferBy === player.userReferenceId) {
      return;
    }
    this.drawOfferBy = null;

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

    // During a shutdown drain every socket disconnects; nobody forfeits for that.
    if (this.draining) {
      return;
    }

    logger.info(`Player ${player.userReferenceId} disconnected`, { game: this.gameData.referenceId });

    // Regular game disconnect handling
    // Notify opponent
    const opponent =
      player === this.whitePlayer ? this.blackPlayer : this.whitePlayer;
    if (opponent && this.gameStarted && !this.gameEnded) {
      opponent.socket.emit("opponent_disconnected", {});

      // Start disconnect timer
      const timer = setTimeout(async () => {
        logger.info(`Player ${player.userReferenceId} did not reconnect in time`, { game: this.gameData.referenceId });
        // Player forfeits: the connected player wins. The result comes from who is creator,
        // not from the colour (H6 #6, AS F-10); the method stays `timeout` until protocol v2.
        await this.endGame(this.getGameResult(opponent.color), opponent.color, "timeout");
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

      // Send current game state to reconnected player.
      const positionInfo = this.gameData.gameData?.positionInfo;
      const reconnectPayload: GameStartedPayload = {
        gameReferenceId: this.gameData.referenceId,
        yourColor:
          this.whitePlayer?.userReferenceId === userReferenceId ? "w" : "b",
        fen: this.chess.fen(),
        whiteTime: this.clockManager.getTimeInSeconds("w"),
        blackTime: this.clockManager.getTimeInSeconds("b"),
        whitePlayer: this.whitePlayer!.playerInfo,
        blackPlayer: this.blackPlayer!.playerInfo,
        positionInfo: positionInfo || undefined,
      };
      socket.emit("game_started", reconnectPayload);
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
        positionInfo: positionInfo || undefined,
      };
      socket.emit("analysis_phase_started", payload);

      // Send current tick so client knows where the countdown is
      socket.emit("analysis_tick", {
        remainingSeconds: this.analysisRemainingSeconds,
        totalSeconds: this.analysisTotalSeconds,
      });

      // Notify opponent of reconnection
      const opponent = this.whitePlayer?.userReferenceId === userReferenceId
        ? this.blackPlayer
        : this.whitePlayer;
      opponent?.socket.emit("opponent_reconnected", {});

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
    await this.trackWrite(
      updateGameState({
        gameReferenceId: this.gameData.referenceId,
        whiteTime: this.clockManager.getTimeInSeconds("w"),
        blackTime: this.clockManager.getTimeInSeconds("b"),
        lastMoveAt: new Date(),
      })
    );
  }

  /**
   * Waits for every web write still in flight (moves, clock flush, result), up to
   * `timeoutMs`. Returns false when the deadline passed first.
   */
  public async flushPendingWrites(timeoutMs: number): Promise<boolean> {
    if (this.pendingWrites.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const settled = Promise.allSettled(Array.from(this.pendingWrites)).then(() => true as const);
    try {
      return await Promise.race([settled, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Shutdown drain (H6 #13): stop the clocks and the study countdown, cancel forfeit timers,
   * and refuse further moves. The next server restores the game from the stored moves.
   */
  public beginDrain(): void {
    this.draining = true;
    this.clearAnalysisTimers();
    this.clockManager.stopClock();
    this.disconnectTimers.forEach((timer) => clearTimeout(timer));
    this.disconnectTimers.clear();
  }

  /** True once the game has ended by any path. */
  public isEnded(): boolean {
    return this.gameEnded;
  }

  /**
   * What a client joining an ended session receives (H6 #8, AS F-09): the `game_over`
   * payload plus the final move list, instead of a live `game_started`.
   */
  public getGameOverSnapshot(): (GameOverPayload & { gameReferenceId: string; moveHistory: Array<{ from: string; to: string; san: string; promotion?: string }> }) | null {
    if (!this.lastGameOverPayload) return null;
    return {
      ...this.lastGameOverPayload,
      gameReferenceId: this.gameData.referenceId,
      moveHistory: this.chess.history({ verbose: true }).map((m) => ({
        from: m.from,
        to: m.to,
        san: m.san,
        promotion: m.promotion || undefined,
      })),
    };
  }

  /** Number of plies replayed from the stored history when the session was created. */
  public getRestoredPlies(): number {
    return this.restoredPlies;
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
   * Check if both players are present
   */
  public hasBothPlayers(): boolean {
    return this.creatorPlayer !== null && this.opponentPlayer !== null;
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

  /** `gameData.creatorColor` written by the web at creation; absent → creator plays White. */
  private creatorPlaysWhite(): boolean {
    const creatorColor = (this.gameData.gameData as { creatorColor?: unknown } | undefined)?.creatorColor;
    return creatorColor !== "black";
  }

  /** Remembers an in-flight web write until it settles. */
  private trackWrite<T>(write: Promise<T>): Promise<T> {
    this.pendingWrites.add(write);
    const forget = () => {
      this.pendingWrites.delete(write);
    };
    write.then(forget, forget);
    return write;
  }

  private getPlayerBySocket(socket: Socket): PlayerConnection | null {
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
    if (this.options.analysisSecondsOverride !== undefined) return this.options.analysisSecondsOverride;
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
        this.endAnalysisPhase();
      }
    }, analysisTime * 1000);

    logger.info(`Analysis timer started: ${analysisTime}s`, { game: this.gameData.referenceId });
  }

  private emitAnalysisTick(): void {
    const payload = {
      remainingSeconds: this.analysisRemainingSeconds,
      totalSeconds: this.analysisTotalSeconds,
    };

    this.broadcast("analysis_tick", payload);
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
    this.drawOfferBy = null;
    this.clearAnalysisTimers();
    this.isAnalysisPhase = false;
    this.clockManager.stopClock();
    this.disconnectTimers.forEach((timer) => clearTimeout(timer));
    this.disconnectTimers.clear();

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

    // The manager evicts the session after the rematch window (H6 #8).
    try {
      this.options.onEnded?.(this.gameData.referenceId);
    } catch (error) {
      logger.error("onEnded callback failed", error, { game: this.gameData.referenceId });
    }

    // Persist game result to database
    const winnerId =
      winner === "w"
        ? this.whitePlayer?.userReferenceId
        : winner === "b"
        ? this.blackPlayer?.userReferenceId
        : undefined;

    // Snapshot now: the result request carries the final position and move list (H6 #7).
    const gameOverRequest = {
      gameReferenceId: this.gameData.referenceId,
      result,
      winnerId,
      method,
      fen: this.chess.fen(),
      whiteTime: this.clockManager.getTimeInSeconds("w"),
      blackTime: this.clockManager.getTimeInSeconds("b"),
      moveHistory: this.chess.history({ verbose: true }),
    };

    // Let in-flight move writes land first: the move route only accepts IN_PROGRESS games,
    // so a move persisted after game-over would be lost. The whole tail is one tracked write
    // so a drain waits for the result too.
    const earlierWrites = Array.from(this.pendingWrites);
    await this.trackWrite(
      (async () => {
        await Promise.allSettled(earlierWrites);
        await completeGame(gameOverRequest).catch((error) => {
          logger.error("Error completing game in DB", error, { game: this.gameData.referenceId });
        });
      })()
    );
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
