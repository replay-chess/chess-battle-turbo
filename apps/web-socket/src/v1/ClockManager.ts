import { Color } from "chess.js";
import { ClockConfig, ClockState } from "./types";
import { logger } from "./utils/logger";

export type ClockEventHandler = (whiteTime: number, blackTime: number) => void;
export type TimeoutEventHandler = (color: Color) => void;

/**
 * ClockManager handles chess clock logic for a single game
 * - Tracks time for both players
 * - Handles clock start/stop/increment
 * - Emits updates and timeout events
 */
export class ClockManager {
  private whiteTime: number; // milliseconds
  private blackTime: number; // milliseconds
  private activeColor: Color | null = null;
  private lastTickTime: number = 0;
  private intervalId: NodeJS.Timeout | null = null;

  private config: ClockConfig;
  private onClockUpdate: ClockEventHandler | null = null;
  private onTimeout: TimeoutEventHandler | null = null;

  // Update interval (100ms for accuracy)
  private readonly TICK_INTERVAL = 100;
  // Emit updates to clients every second
  private readonly EMIT_INTERVAL = 1000;
  private lastEmitTime: number = 0;

  constructor(config: ClockConfig, initialWhiteTime?: number, initialBlackTime?: number) {
    this.config = config;
    this.whiteTime = initialWhiteTime ?? config.initialTime * 1000;
    this.blackTime = initialBlackTime ?? config.initialTime * 1000;
  }

  /**
   * Set the clock update callback
   */
  public setOnClockUpdate(handler: ClockEventHandler): void {
    this.onClockUpdate = handler;
  }

  /**
   * Set the timeout callback
   */
  public setOnTimeout(handler: TimeoutEventHandler): void {
    this.onTimeout = handler;
  }

  /**
   * Start the clock for a specific color
   */
  public startClock(color: Color): void {
    // Stop any running clock first
    this.stopClock();

    this.activeColor = color;
    this.lastTickTime = Date.now();
    this.lastEmitTime = Date.now();

    // Start the interval
    this.intervalId = setInterval(() => {
      this.tick();
    }, this.TICK_INTERVAL);

    logger.info(`Clock started for ${color === "w" ? "White" : "Black"}`);
  }

  /**
   * Stop the currently active clock
   */
  public stopClock(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Save and clear activeColor BEFORE final tick to prevent recursion
    // (tick -> timeout -> stopClock -> tick -> ...)
    const wasActive = this.activeColor;
    this.activeColor = null;

    // Do a final tick to update time accurately
    if (wasActive) {
      this.updateTimeForColor(wasActive);
    }

    logger.info("Clock stopped");
  }

  /**
   * Add increment to a player's clock (after they make a move)
   */
  public addIncrement(color: Color): void {
    const incrementMs = this.config.increment * 1000;

    if (color === "w") {
      this.whiteTime += incrementMs;
      logger.info(`Added ${this.config.increment}s increment to White`);
    } else {
      this.blackTime += incrementMs;
      logger.info(`Added ${this.config.increment}s increment to Black`);
    }

    // Emit update after adding increment
    this.emitUpdate();
  }

  /**
   * Get current clock state
   */
  public getState(): ClockState {
    return {
      whiteTime: Math.max(0, Math.round(this.whiteTime)),
      blackTime: Math.max(0, Math.round(this.blackTime)),
      activeColor: this.activeColor,
      lastUpdateTime: Date.now(),
    };
  }

  /**
   * Get time in seconds for a specific player
   */
  public getTimeInSeconds(color: Color): number {
    const time = color === "w" ? this.whiteTime : this.blackTime;
    return Math.max(0, Math.round(time / 1000));
  }

  /**
   * Cleanup and destroy the clock
   */
  public destroy(): void {
    this.stopClock();
    this.onClockUpdate = null;
    this.onTimeout = null;
  }

  /**
   * Update time for a specific color (used during stopClock to avoid recursion)
   */
  private updateTimeForColor(color: Color): void {
    const now = Date.now();
    const elapsed = now - this.lastTickTime;

    if (color === "w") {
      this.whiteTime = Math.max(0, this.whiteTime - elapsed);
    } else {
      this.blackTime = Math.max(0, this.blackTime - elapsed);
    }
  }

  /**
   * Internal tick method that updates the active clock
   */
  private tick(): void {
    if (!this.activeColor) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastTickTime;
    this.lastTickTime = now;

    // Deduct time from active player
    if (this.activeColor === "w") {
      this.whiteTime -= elapsed;

      // Check for timeout
      if (this.whiteTime <= 0) {
        this.whiteTime = 0;
        this.stopClock();
        this.handleTimeout("w");
        return;
      }
    } else {
      this.blackTime -= elapsed;

      // Check for timeout
      if (this.blackTime <= 0) {
        this.blackTime = 0;
        this.stopClock();
        this.handleTimeout("b");
        return;
      }
    }

    // Emit updates every second
    if (now - this.lastEmitTime >= this.EMIT_INTERVAL) {
      this.emitUpdate();
      this.lastEmitTime = now;
    }
  }

  /**
   * Emit clock update to listeners
   */
  private emitUpdate(): void {
    if (this.onClockUpdate) {
      const whiteSeconds = this.getTimeInSeconds("w");
      const blackSeconds = this.getTimeInSeconds("b");
      this.onClockUpdate(whiteSeconds, blackSeconds);
    }
  }

  /**
   * Handle clock timeout
   */
  private handleTimeout(color: Color): void {
    logger.info(`Clock timeout for ${color === "w" ? "White" : "Black"}`);

    // Emit final update
    this.emitUpdate();

    // Trigger timeout handler
    if (this.onTimeout) {
      this.onTimeout(color);
    }
  }
}
