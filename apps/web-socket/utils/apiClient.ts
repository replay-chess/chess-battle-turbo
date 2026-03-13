import * as Sentry from "@sentry/node";
import {
  ApiGameResponse,
  ApiMoveRequest,
  ApiGameOverRequest,
  ApiGameStateRequest,
  GameData,
} from "../types";
import { logger } from "./logger";
import { trackApiLatency, trackApiError } from "./sentry";

// Configuration
const API_BASE_URL = process.env.WEB_APP_URL || "http://localhost:3000";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

/**
 * Returns sentry-trace and baggage headers for the current active span.
 * When called inside withGameTrace, these headers carry the game's trace context
 * so the receiving Next.js server links the request to the same distributed trace.
 */
function getSentryHeaders(): Record<string, string> {
  const traceData = Sentry.getTraceData();
  const headers: Record<string, string> = {};
  if (traceData["sentry-trace"]) {
    headers["sentry-trace"] = traceData["sentry-trace"];
  }
  if (traceData["baggage"]) {
    headers["baggage"] = traceData["baggage"];
  }
  return headers;
}

/**
 * Fetch game details by reference ID
 */
export async function fetchGameByRef(
  gameReferenceId: string
): Promise<GameData> {
  const start = Date.now();
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/chess/game-by-ref/${gameReferenceId}`,
      {
        headers: {
          ...getSentryHeaders(),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as ApiGameResponse;

    if (!result.success || !result.data) {
      throw new Error(result.error || "Failed to fetch game");
    }

    trackApiLatency("fetchGameByRef", Date.now() - start);
    return result.data;
  } catch (error) {
    trackApiError("fetchGameByRef");
    logger.error("Error fetching game by ref", error, { game: gameReferenceId });
    throw error;
  }
}

/**
 * Persist a move to the database
 */
export async function persistMove(moveData: ApiMoveRequest): Promise<void> {
  const start = Date.now();
  try {
    const response = await fetch(`${API_BASE_URL}/api/chess/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_API_SECRET,
        ...getSentryHeaders(),
      },
      body: JSON.stringify(moveData),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as { success: boolean; error?: string };

    if (!result.success) {
      throw new Error(result.error || "Failed to persist move");
    }

    trackApiLatency("persistMove", Date.now() - start);
  } catch (error) {
    trackApiError("persistMove");
    logger.error("Error persisting move", error, { game: moveData.gameReferenceId });
    throw error;
  }
}

/**
 * Mark game as completed
 */
export async function completeGame(
  gameOverData: ApiGameOverRequest
): Promise<void> {
  const start = Date.now();
  try {
    logger.info("Calling game-over API", { game: gameOverData.gameReferenceId, result: gameOverData.result });

    const response = await fetch(`${API_BASE_URL}/api/chess/game-over`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_API_SECRET,
        ...getSentryHeaders(),
      },
      body: JSON.stringify(gameOverData),
    });

    logger.info(`Game-over API response status: ${response.status}`, { game: gameOverData.gameReferenceId });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string; details?: any };
      logger.error("Game-over API error response", errorData, { game: gameOverData.gameReferenceId });
      const errorMessage = errorData.details
        ? `${errorData.error}: ${JSON.stringify(errorData.details)}`
        : errorData.error || `HTTP error! status: ${response.status}`;
      throw new Error(errorMessage);
    }

    const result = await response.json() as { success: boolean; error?: string; details?: any };

    if (!result.success) {
      logger.error("Game-over API returned success: false", result, { game: gameOverData.gameReferenceId });
      const errorMessage = result.details
        ? `${result.error}: ${JSON.stringify(result.details)}`
        : result.error || "Failed to complete game";
      throw new Error(errorMessage);
    }

    trackApiLatency("completeGame", Date.now() - start);
    logger.info("Game completed successfully in database", { game: gameOverData.gameReferenceId });
  } catch (error) {
    trackApiError("completeGame");
    logger.error("Error completing game", error, { game: gameOverData.gameReferenceId });
    throw error;
  }
}

/**
 * Update game state (clocks) without a move
 */
export async function updateGameState(
  stateData: ApiGameStateRequest
): Promise<void> {
  const start = Date.now();
  try {
    const response = await fetch(`${API_BASE_URL}/api/chess/game-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_API_SECRET,
        ...getSentryHeaders(),
      },
      body: JSON.stringify(stateData),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as { success: boolean; error?: string };

    if (!result.success) {
      throw new Error(result.error || "Failed to update game state");
    }

    trackApiLatency("updateGameState", Date.now() - start);
  } catch (error) {
    trackApiError("updateGameState");
    logger.error("Error updating game state", error, { game: stateData.gameReferenceId });
    logger.warn("Continuing despite game state update failure", { game: stateData.gameReferenceId });
  }
}
