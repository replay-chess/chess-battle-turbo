import "dotenv/config";
// Must be first import — initializes Sentry before anything else
import "./instrument";

import express from "express";
import { createServer, Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import * as Sentry from "@sentry/node";
import { GameManager, GameManagerOptions } from "./GameManager";
import { errorPayload } from "./GameSession";
import { TournamentManager, TournamentLobbyPayload } from "./TournamentManager";
import {
  JoinGamePayload,
  MakeMovePayload,
  ResignPayload,
  OfferDrawPayload,
  AcceptDrawPayload,
  DeclineDrawPayload,
  SpectateGamePayload,
} from "./types";
import { withGameTrace } from "./utils/traceContext";
import { logger } from "./utils/logger";
import { trackSocketEvent, trackActiveConnections, flushSentry } from "./utils/sentry";
import {
  getVerifiedUserReferenceId,
  isSocketAuthRequired,
  socketAuthMiddleware,
} from "./utils/socketAuth";
import { INTERNAL_TOKEN_HEADER, verifyInternalToken } from "./utils/internalAuth";

/** How long a SIGTERM drain may take before the server closes anyway (plan §7.5 #13). */
const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;

export interface SocketServerOptions extends GameManagerOptions {
  /** Upper bound for flushing pending writes on shutdown. Default 20 s. */
  drainTimeoutMs?: number;
}

export interface SocketServerHandle {
  app: express.Express;
  httpServer: HttpServer;
  io: Server;
  gameManager: GameManager;
  tournamentManager: TournamentManager;
  /** Drain (notify, flush ≤ drainTimeoutMs), then close every socket and the HTTP server. */
  shutdown: () => Promise<void>;
}

/**
 * The identity a `join_game` acts as (plan §7.5 #2, AS F-02): only the verified handshake
 * token counts; `payload.userReferenceId` is ignored when a token is present. Without a token
 * (possible only while SOCKET_AUTH_REQUIRED is off) the payload id is used, as before.
 */
function resolveJoinIdentity(socket: Socket, payload: JoinGamePayload): string | null {
  const verified = getVerifiedUserReferenceId(socket);
  if (verified) {
    if (payload.userReferenceId && payload.userReferenceId !== verified) {
      logger.warn("join_game: payload userReferenceId differs from the token; using the token", {
        game: payload.gameReferenceId,
        socket: socket.id,
      });
    }
    return verified;
  }
  if (isSocketAuthRequired()) return null;
  return typeof payload.userReferenceId === "string" && payload.userReferenceId.length > 0
    ? payload.userReferenceId
    : null;
}

function hasGameRef(payload: unknown): payload is { gameReferenceId: string } {
  return (
    !!payload &&
    typeof payload === "object" &&
    typeof (payload as { gameReferenceId?: unknown }).gameReferenceId === "string" &&
    (payload as { gameReferenceId: string }).gameReferenceId.length > 0
  );
}

/**
 * Builds the HTTP app, the socket.io server and the managers without listening, so tests can
 * run an in-process server (`httpServer.listen(0)`).
 */
export function createSocketServer(options: SocketServerOptions = {}): SocketServerHandle {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  let activeConnectionCount = 0;

  const app = express();
  app.use(express.json());

  // Add a health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "WebSocket server is running" });
  });

  // Internal API: tournament event notifications from the Next.js app. Requires the shared
  // internal token, compared in constant time (plan §7.5 #5, AS F-06).
  app.post("/internal/tournament-event", (req, res) => {
    if (!verifyInternalToken(req.get(INTERNAL_TOKEN_HEADER))) {
      logger.warn("Rejected /internal/tournament-event without a valid internal token");
      res.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }

    const { event, tournamentReferenceId, data } = (req.body ?? {}) as {
      event?: unknown;
      tournamentReferenceId?: unknown;
      data?: any;
    };
    if (typeof event !== "string" || typeof tournamentReferenceId !== "string" || !event || !tournamentReferenceId) {
      res.status(400).json({ error: "Missing event or tournamentReferenceId" });
      return;
    }

    logger.info(`Tournament event: ${event} for ${tournamentReferenceId}`);

    switch (event) {
      case "game_ended":
        tournamentManager.emitGameEnded(tournamentReferenceId, data);
        break;
      case "game_started":
        tournamentManager.emitGameStarted(tournamentReferenceId, data);
        break;
      case "tournament_started":
        tournamentManager.emitTournamentStarted(tournamentReferenceId, data);
        break;
      case "tournament_ended":
        tournamentManager.emitTournamentEnded(tournamentReferenceId);
        break;
      case "player_joined":
        tournamentManager.emitPlayerJoined(tournamentReferenceId, data);
        break;
      default:
        res.status(400).json({ error: `Unknown event: ${event}` });
        return;
    }

    res.json({ success: true });
  });

  const httpServer = createServer(app);

  // Configure Socket.IO with CORS. ALLOWED_ORIGINS is a comma-separated list
  // (e.g. "https://www.playchess.tech,https://playchess.tech"); unset allows any.
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins?.length ? allowedOrigins : "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Verify the per-user token sent in the socket.io `auth` handshake. Sockets
  // without a valid token are rejected only when SOCKET_AUTH_REQUIRED=true.
  io.use(socketAuthMiddleware);

  // Initialize GameManager and TournamentManager
  const gameManager = new GameManager(options);
  const tournamentManager = new TournamentManager(io);

  // Socket.IO connection handler
  io.on("connection", (socket) => {
    activeConnectionCount++;
    trackActiveConnections(activeConnectionCount);
    logger.info(`Client connected, socket id: ${socket.id}`);

    // Handle player joining a game
    socket.on("join_game", async (payload: JoinGamePayload) => {
      trackSocketEvent("join_game");
      if (!hasGameRef(payload)) {
        socket.emit("error", errorPayload("bad_request", "Missing gameReferenceId"));
        return;
      }
      const { gameReferenceId } = payload;

      // Identity comes from the verified token only; the payload id is ignored (H6 #2).
      const userReferenceId = resolveJoinIdentity(socket, payload);
      if (!userReferenceId) {
        socket.emit("error", errorPayload("unauthorized", "Sign in again to join this game."));
        return;
      }

      await withGameTrace(
        gameReferenceId,
        {
          name: "websocket.join_game",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId, "user.referenceId": userReferenceId },
        },
        async () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info(`join_game event`, { game: gameReferenceId, user: userReferenceId });

            await gameManager.handleJoinGame(socket, gameReferenceId, userReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in join_game handler", error, { game: gameReferenceId });
            socket.emit("error", errorPayload("internal", "Failed to join game"));
          }
        }
      );
    });

    // Handle spectator joining a game
    socket.on("spectate_game", async (payload: SpectateGamePayload) => {
      trackSocketEvent("spectate_game");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId } = payload;

      await withGameTrace(
        gameReferenceId,
        {
          name: "websocket.spectate_game",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        async () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info("spectate_game event", { game: gameReferenceId });

            await gameManager.handleSpectateGame(socket, gameReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in spectate_game handler", error, { game: gameReferenceId });
            socket.emit("error", errorPayload("internal", "Failed to spectate game"));
          }
        }
      );
    });

    // Handle move attempts
    socket.on("make_move", async (payload: MakeMovePayload) => {
      trackSocketEvent("make_move");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId, from, to, promotion } = payload;

      await withGameTrace(
        gameReferenceId,
        {
          name: "websocket.make_move",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        async () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info(`make_move event: from=${from}, to=${to}`, { game: gameReferenceId });

            await gameManager.handleMove(
              socket,
              gameReferenceId,
              from,
              to,
              promotion
            );
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in make_move handler", error, { game: gameReferenceId });
            socket.emit("move_error", { code: "internal", message: "Failed to make move" });
          }
        }
      );
    });

    // Handle resignation
    socket.on("resign", async (payload: ResignPayload) => {
      trackSocketEvent("resign");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId } = payload;

      await withGameTrace(
        gameReferenceId,
        {
          name: "websocket.resign",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        async () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info("resign event", { game: gameReferenceId });

            await gameManager.handleResign(socket, gameReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in resign handler", error, { game: gameReferenceId });
            socket.emit("error", errorPayload("internal", "Failed to resign"));
          }
        }
      );
    });

    // Handle draw offer
    socket.on("offer_draw", (payload: OfferDrawPayload) => {
      trackSocketEvent("offer_draw");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId } = payload;

      withGameTrace(
        gameReferenceId,
        {
          name: "websocket.offer_draw",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info("offer_draw event", { game: gameReferenceId });

            gameManager.handleOfferDraw(socket, gameReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in offer_draw handler", error, { game: gameReferenceId });
            socket.emit("error", errorPayload("internal", "Failed to offer draw"));
          }
        }
      );
    });

    // Handle draw acceptance (only the receiver of a pending offer; H6 #1)
    socket.on("accept_draw", async (payload: AcceptDrawPayload) => {
      trackSocketEvent("accept_draw");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId } = payload;

      await withGameTrace(
        gameReferenceId,
        {
          name: "websocket.accept_draw",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        async () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info("accept_draw event", { game: gameReferenceId });

            await gameManager.handleAcceptDraw(socket, gameReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in accept_draw handler", error, { game: gameReferenceId });
            socket.emit("error", errorPayload("internal", "Failed to accept draw"));
          }
        }
      );
    });

    // Handle draw decline
    socket.on("decline_draw", (payload: DeclineDrawPayload) => {
      trackSocketEvent("decline_draw");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId } = payload;

      withGameTrace(
        gameReferenceId,
        {
          name: "websocket.decline_draw",
          op: "websocket.event",
          attributes: { "game.referenceId": gameReferenceId },
        },
        () => {
          try {
            Sentry.setTag("game.referenceId", gameReferenceId);
            logger.info("decline_draw event", { game: gameReferenceId });

            gameManager.handleDeclineDraw(socket, gameReferenceId);
          } catch (error) {
            Sentry.captureException(error);
            logger.error("Error in decline_draw handler", error, { game: gameReferenceId });
          }
        }
      );
    });

    // Handle tournament lobby join
    socket.on("join_tournament_lobby", (payload: TournamentLobbyPayload) => {
      trackSocketEvent("join_tournament_lobby");
      const { tournamentReferenceId } = payload;
      logger.info(`join_tournament_lobby: ${tournamentReferenceId}`, { socket: socket.id });
      tournamentManager.handleJoinLobby(socket, tournamentReferenceId);
    });

    // Handle tournament lobby leave
    socket.on("leave_tournament_lobby", (payload: TournamentLobbyPayload) => {
      trackSocketEvent("leave_tournament_lobby");
      const { tournamentReferenceId } = payload;
      logger.info(`leave_tournament_lobby: ${tournamentReferenceId}`, { socket: socket.id });
      tournamentManager.handleLeaveLobby(socket, tournamentReferenceId);
    });

    // Handle disconnection (no gameReferenceId — stays as isolated span)
    socket.on("disconnect", () => {
      trackSocketEvent("disconnect");
      activeConnectionCount--;
      trackActiveConnections(activeConnectionCount);
      Sentry.startSpan(
        { name: "websocket.disconnect", op: "websocket.event" },
        () => {
          logger.info(`Client disconnected, socket id: ${socket.id}`);
          gameManager.handleDisconnect(socket);
          tournamentManager.handleDisconnect(socket);
        }
      );
    });
  });

  let closing: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      // 1. Tell every client (games: with their gameReferenceId), freeze clocks, flush writes.
      await gameManager.drain(drainTimeoutMs);
      for (const socket of io.sockets.sockets.values()) {
        if (!gameManager.hasSocket(socket.id)) socket.emit("server_restarting", {});
      }
      tournamentManager.destroy();
      // 2. Close every socket (clients see a transport close and reconnect to the new server)
      //    and the HTTP server.
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      gameManager.destroy();
    })();
    return closing;
  };

  return { app, httpServer, io, gameManager, tournamentManager, shutdown };
}

function main(): void {
  const handle = createSocketServer();

  // Graceful shutdown (H6 #13, AS F-16): `docker compose` sends SIGTERM and waits
  // `stop_grace_period` (30 s) before SIGKILL; the drain is bounded at 20 s.
  let exiting = false;
  const onSignal = (signal: string) => {
    if (exiting) return;
    exiting = true;
    logger.info(`${signal} received, draining and shutting down`);
    const hardExit = setTimeout(() => {
      logger.error("Shutdown took too long; exiting");
      process.exit(1);
    }, DEFAULT_DRAIN_TIMEOUT_MS + 7_000);
    hardExit.unref();
    handle
      .shutdown()
      .then(() => flushSentry(2000))
      .then(
        () => {
          logger.info("Server closed");
          process.exit(0);
        },
        (error) => {
          logger.error("Error during shutdown", error);
          process.exit(1);
        }
      );
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  const PORT = process.env.PORT || 3002;
  handle.httpServer.listen(PORT, () => {
    logger.info(`WebSocket server running at http://localhost:${PORT}`);
    logger.info(
      `Socket auth: ${isSocketAuthRequired() ? "required" : "optional (SOCKET_AUTH_REQUIRED is not 'true')"}`
    );
    logger.info(`Active games: ${handle.gameManager.getActiveGameCount()}`);
  });
}

// Listen only when run directly (`tsx index.ts`, `node dist/index.js`), not when a test imports it.
if (require.main === module) {
  main();
}
