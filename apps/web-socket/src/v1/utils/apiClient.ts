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
import { INTERNAL_TOKEN_HEADER, legacySecret } from "./internalAuth";

/**
 * Socket server → web app calls (plan §7.5 #9 and "+", AS F-08).
 *
 * - Every call sends `x-internal-token` (the web's `game-by-ref` returns only the invite
 *   projection without it, H4).
 * - Every attempt has `AbortSignal.timeout(8000)`.
 * - `persistMove`, `completeGame` and `updateGameState` retry 3 times (0.5 s, 1 s, 2 s) on a
 *   network error, a timeout, a 5xx or a 429. A 4xx other than 429 is final.
 * - Error bodies are read as `body.error?.message ?? body.error`, so both the old
 *   `{ error: "text" }` and the new envelope `{ error: { code, message } }` work.
 */

/** Tunable for tests only; production uses the defaults. */
export const apiClientConfig = {
  timeoutMs: 8000,
  retryDelaysMs: [500, 1000, 2000] as readonly number[],
};

// Read at call time (not module load) so tests and late `dotenv` loads see the value.
function apiBaseUrl(): string {
  return process.env.WEB_APP_URL || "http://localhost:3000";
}

function internalSecret(): string {
  return legacySecret();
}

/** A non-2xx answer (or `success: false`) from the web app. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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

function internalHeaders(json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    [INTERNAL_TOKEN_HEADER]: internalSecret(),
    ...getSentryHeaders(),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `body.error?.message ?? body.error`, for the old and the new (envelope) error bodies. */
export function errorMessageOf(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.length > 0) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function errorCodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryable(error: unknown): boolean {
  // Network errors and timeouts (TypeError / AbortError / TimeoutError) are retryable.
  return error instanceof ApiError ? error.retryable : true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportRetry(endpoint: string, attempt: number, game: string, error: unknown): void {
  const reason = error instanceof ApiError ? `status ${error.status}` : error instanceof Error ? error.name : "unknown";
  logger.warn(`persist_retry ${endpoint} attempt ${attempt} (${reason})`, { game });
  Sentry.metrics.count("ws.persist_retry", 1, { attributes: { endpoint } });
  Sentry.captureMessage("persist_retry", {
    level: "warning",
    tags: { endpoint, "game.referenceId": game, attempt: String(attempt) },
    extra: { reason },
  });
}

interface CallOptions {
  endpoint: string;
  game: string;
  retries: number;
}

/**
 * One web call with a per-attempt timeout and retries. Returns the parsed JSON body of the
 * first 2xx answer; throws the last error otherwise.
 */
async function callWebApi(
  path: string,
  init: { method: "GET" | "POST"; body?: string },
  { endpoint, game, retries }: CallOptions,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${apiBaseUrl()}${path}`, {
        method: init.method,
        headers: internalHeaders(init.body !== undefined),
        body: init.body,
        signal: AbortSignal.timeout(apiClientConfig.timeoutMs),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new ApiError(
          errorMessageOf(body, `HTTP error! status: ${response.status}`),
          response.status,
          errorCodeOf(body),
          isRetryableStatus(response.status),
        );
      }
      if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
        throw new ApiError(errorMessageOf(body, `${endpoint} failed`), response.status, errorCodeOf(body), false);
      }
      return body;
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      reportRetry(endpoint, attempt + 1, game, error);
      await sleep(apiClientConfig.retryDelaysMs[attempt] ?? 2000);
    }
  }
}

/**
 * The web's `game-by-ref` answers the socket with the full body when the token is valid, and
 * with the invite projection (clocks `null`, `gameData` cut down) when it is not. A projection
 * means the token is misconfigured: say so loudly, and fall back to the initial clock so the
 * session does not start with 0 seconds.
 */
function normalizeGameData(raw: GameData, gameReferenceId: string): GameData {
  const creatorTime = raw.creatorTimeRemaining as number | null | undefined;
  const opponentTime = raw.opponentTimeRemaining as number | null | undefined;
  if (typeof creatorTime === "number" && typeof opponentTime === "number") return raw;

  logger.error("game-by-ref returned the invite projection; check INTERNAL_API_SECRET", undefined, {
    game: gameReferenceId,
  });
  Sentry.captureMessage("game_by_ref_projection", {
    level: "error",
    tags: { "game.referenceId": gameReferenceId },
  });
  return {
    ...raw,
    creatorTimeRemaining: typeof creatorTime === "number" ? creatorTime : raw.initialTimeSeconds,
    opponentTimeRemaining: typeof opponentTime === "number" ? opponentTime : raw.initialTimeSeconds,
  };
}

/**
 * Fetch game details by reference ID (one attempt, 8 s timeout: a join should fail fast).
 */
export async function fetchGameByRef(gameReferenceId: string): Promise<GameData> {
  const start = Date.now();
  try {
    const result = (await callWebApi(
      `/api/chess/game-by-ref/${encodeURIComponent(gameReferenceId)}`,
      { method: "GET" },
      { endpoint: "fetchGameByRef", game: gameReferenceId, retries: 0 },
    )) as ApiGameResponse | null;

    if (!result || !result.data) {
      throw new ApiError(errorMessageOf(result, "Failed to fetch game"), 200, undefined, false);
    }

    trackApiLatency("fetchGameByRef", Date.now() - start);
    return normalizeGameData(result.data, gameReferenceId);
  } catch (error) {
    trackApiError("fetchGameByRef");
    logger.error("Error fetching game by ref", error, { game: gameReferenceId });
    throw error;
  }
}

/**
 * Persist a move to the database. A 409 means the game is no longer in progress or a newer
 * history is already stored (H6 #12 guard); it is final, not retried.
 */
export async function persistMove(moveData: ApiMoveRequest): Promise<void> {
  const start = Date.now();
  try {
    await callWebApi(
      "/api/chess/move",
      { method: "POST", body: JSON.stringify(moveData) },
      { endpoint: "persistMove", game: moveData.gameReferenceId, retries: apiClientConfig.retryDelaysMs.length },
    );
    trackApiLatency("persistMove", Date.now() - start);
  } catch (error) {
    trackApiError("persistMove");
    logger.error("Error persisting move", error, { game: moveData.gameReferenceId });
    throw error;
  }
}

/** `ApiGameOverRequest` plus the final move list (H6 #7); the web merges it into `gameData`. */
export type CompleteGameRequest = ApiGameOverRequest & { moveHistory?: unknown[] };

/**
 * Mark game as completed. A 409 means another call already ended the game (for example a
 * retry after a timed-out success): that is not an error.
 */
export async function completeGame(gameOverData: CompleteGameRequest): Promise<void> {
  const start = Date.now();
  try {
    logger.info("Calling game-over API", { game: gameOverData.gameReferenceId, result: gameOverData.result });
    await callWebApi(
      "/api/chess/game-over",
      { method: "POST", body: JSON.stringify(gameOverData) },
      { endpoint: "completeGame", game: gameOverData.gameReferenceId, retries: apiClientConfig.retryDelaysMs.length },
    );
    trackApiLatency("completeGame", Date.now() - start);
    logger.info("Game completed successfully in database", { game: gameOverData.gameReferenceId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      logger.info("Game was already completed in the database", { game: gameOverData.gameReferenceId });
      return;
    }
    trackApiError("completeGame");
    logger.error("Error completing game", error, { game: gameOverData.gameReferenceId });
    throw error;
  }
}

/**
 * Update game state (clocks) without a move. Failures are logged, never thrown.
 */
export async function updateGameState(stateData: ApiGameStateRequest): Promise<void> {
  const start = Date.now();
  try {
    await callWebApi(
      "/api/chess/game-state",
      { method: "POST", body: JSON.stringify(stateData) },
      { endpoint: "updateGameState", game: stateData.gameReferenceId, retries: apiClientConfig.retryDelaysMs.length },
    );
    trackApiLatency("updateGameState", Date.now() - start);
  } catch (error) {
    trackApiError("updateGameState");
    logger.error("Error updating game state", error, { game: stateData.gameReferenceId });
    logger.warn("Continuing despite game state update failure", { game: stateData.gameReferenceId });
  }
}
