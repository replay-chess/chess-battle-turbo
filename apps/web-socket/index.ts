import "dotenv/config";
// Must be first import — initializes Sentry before anything else
import "./instrument";

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import * as Sentry from "@sentry/node";
import { GameManager } from "./GameManager";
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
import { trackSocketEvent, trackActiveConnections } from "./utils/sentry";

let activeConnectionCount = 0;

const app = express();
app.use(express.json());

// Add a health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "WebSocket server is running" });
});

// Internal API: tournament event notifications from the Next.js app
app.post("/internal/tournament-event", (req, res) => {
  const { event, tournamentReferenceId, data } = req.body;
  if (!event || !tournamentReferenceId) {
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

const server = createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize GameManager and TournamentManager
const gameManager = new GameManager();
let tournamentManager: TournamentManager;

// Initialize TournamentManager with io instance
tournamentManager = new TournamentManager(io);

// Socket.IO connection handler
io.on("connection", (socket) => {
  activeConnectionCount++;
  trackActiveConnections(activeConnectionCount);
  logger.info(`Client connected, socket id: ${socket.id}`);

  // Handle player joining a game
  socket.on("join_game", async (payload: JoinGamePayload) => {
    trackSocketEvent("join_game");
    const { gameReferenceId, userReferenceId } = payload;

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
          socket.emit("error", {
            message: error instanceof Error ? error.message : "Failed to join game",
          });
        }
      }
    );
  });

  // Handle spectator joining a game
  socket.on("spectate_game", async (payload: SpectateGamePayload) => {
    trackSocketEvent("spectate_game");
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
          socket.emit("error", {
            message: error instanceof Error ? error.message : "Failed to spectate game",
          });
        }
      }
    );
  });

  // Handle move attempts
  socket.on("make_move", async (payload: MakeMovePayload) => {
    trackSocketEvent("make_move");
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
          socket.emit("move_error", {
            message: error instanceof Error ? error.message : "Failed to make move",
          });
        }
      }
    );
  });

  // Handle resignation
  socket.on("resign", async (payload: ResignPayload) => {
    trackSocketEvent("resign");
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
          socket.emit("error", {
            message: error instanceof Error ? error.message : "Failed to resign",
          });
        }
      }
    );
  });

  // Handle draw offer
  socket.on("offer_draw", (payload: OfferDrawPayload) => {
    trackSocketEvent("offer_draw");
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
          socket.emit("error", {
            message: error instanceof Error ? error.message : "Failed to offer draw",
          });
        }
      }
    );
  });

  // Handle draw acceptance
  socket.on("accept_draw", async (payload: AcceptDrawPayload) => {
    trackSocketEvent("accept_draw");
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
          socket.emit("error", {
            message: error instanceof Error ? error.message : "Failed to accept draw",
          });
        }
      }
    );
  });

  // Handle draw decline
  socket.on("decline_draw", (payload: DeclineDrawPayload) => {
    trackSocketEvent("decline_draw");
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

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  gameManager.destroy();
  tournamentManager.destroy();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  gameManager.destroy();
  tournamentManager.destroy();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  logger.info(`WebSocket server running at http://localhost:${PORT}`);
  logger.info(`Active games: ${gameManager.getActiveGameCount()}`);
});
