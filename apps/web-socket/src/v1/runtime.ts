// Protocol v1 runtime (phase-02 plan 3.1, 7.4.1 step 2, 7.10): the pre-P2 game handlers, kept for clients that
// connect without `proto: 2` while PROTOCOL_V1=on, until the parity gate (owner Q5: one release after it). The v2
// handshake (src/server/handshake.ts) authenticates every socket first and routes v1 sockets here; this module no
// longer owns the HTTP server, socket.io or the shutdown. The AI (bot) path is deleted: bot games run on the client.
// Deleted with the rest of src/v1/ by the parity-gate PR (WP-I).
import express, { type Express, type Request, type Response } from "express";
import type { Socket } from "socket.io";
import * as Sentry from "@sentry/node";
import { GameManager, type GameManagerOptions } from "./GameManager";
import { errorPayload } from "./GameSession";
import type {
  AcceptDrawPayload,
  DeclineDrawPayload,
  JoinGamePayload,
  MakeMovePayload,
  OfferDrawPayload,
  ResignPayload,
  SpectateGamePayload,
} from "./types";
import type { TournamentManager } from "../legacy/TournamentManager";
import { logger } from "./utils/logger";
import { trackSocketEvent } from "./utils/sentry";
import { getVerifiedUserReferenceId } from "./utils/socketAuth";
import { INTERNAL_TOKEN_HEADER, verifyInternalToken } from "./utils/internalAuth";

export type V1RuntimeOptions = GameManagerOptions;

export interface V1Runtime {
  gameManager: GameManager;
  /** Registers the v1 game handlers on a socket that passed the handshake's v1 path. */
  attach(socket: Socket): void;
  /** True when a v1 game session holds this socket. */
  hasSocket(socketId: string): boolean;
  /** Notify, freeze clocks and flush writes (≤ timeoutMs). */
  drain(timeoutMs: number): Promise<void>;
  destroy(): void;
}

function hasGameRef(payload: unknown): payload is { gameReferenceId: string } {
  return (
    !!payload &&
    typeof payload === "object" &&
    typeof (payload as { gameReferenceId?: unknown }).gameReferenceId === "string" &&
    (payload as { gameReferenceId: string }).gameReferenceId.length > 0
  );
}

export function createV1Runtime(options: V1RuntimeOptions = {}): V1Runtime {
  const gameManager = new GameManager(options);

  const traced = (
    event: string,
    gameReferenceId: string,
    run: () => Promise<void> | void,
    onError: (error: unknown) => void,
  ): Promise<void> =>
    // Plain spans: the per-game `continueTrace` (utils/traceContext.ts) is gone (plan 3.1, socket F-40).
    Sentry.startSpan(
      { name: `websocket.${event}`, op: "websocket.event", attributes: { "game.referenceId": gameReferenceId } },
      async () => {
        try {
          Sentry.setTag("game.referenceId", gameReferenceId);
          await run();
        } catch (error) {
          Sentry.captureException(error);
          logger.error(`Error in ${event} handler`, error, { game: gameReferenceId });
          onError(error);
        }
      },
    );

  function attach(socket: Socket): void {
    socket.on("join_game", async (payload: JoinGamePayload) => {
      trackSocketEvent("join_game");
      if (!hasGameRef(payload)) {
        socket.emit("error", errorPayload("bad_request", "Missing gameReferenceId"));
        return;
      }
      // Identity comes from the verified token only; the payload id is ignored (P1 H6 #2).
      const userReferenceId = getVerifiedUserReferenceId(socket);
      if (!userReferenceId) {
        socket.emit("error", errorPayload("unauthorized", "Sign in again to join this game."));
        return;
      }
      await traced(
        "join_game",
        payload.gameReferenceId,
        () => gameManager.handleJoinGame(socket, payload.gameReferenceId, userReferenceId),
        () => socket.emit("error", errorPayload("internal", "Failed to join game")),
      );
    });

    socket.on("spectate_game", async (payload: SpectateGamePayload) => {
      trackSocketEvent("spectate_game");
      if (!hasGameRef(payload)) return;
      await traced(
        "spectate_game",
        payload.gameReferenceId,
        () => gameManager.handleSpectateGame(socket, payload.gameReferenceId),
        () => socket.emit("error", errorPayload("internal", "Failed to spectate game")),
      );
    });

    socket.on("make_move", async (payload: MakeMovePayload) => {
      trackSocketEvent("make_move");
      if (!hasGameRef(payload)) return;
      const { gameReferenceId, from, to, promotion } = payload;
      await traced(
        "make_move",
        gameReferenceId,
        () => gameManager.handleMove(socket, gameReferenceId, from, to, promotion),
        () => socket.emit("move_error", { code: "internal", message: "Failed to make move" }),
      );
    });

    socket.on("resign", async (payload: ResignPayload) => {
      trackSocketEvent("resign");
      if (!hasGameRef(payload)) return;
      await traced(
        "resign",
        payload.gameReferenceId,
        () => gameManager.handleResign(socket, payload.gameReferenceId),
        () => socket.emit("error", errorPayload("internal", "Failed to resign")),
      );
    });

    socket.on("offer_draw", async (payload: OfferDrawPayload) => {
      trackSocketEvent("offer_draw");
      if (!hasGameRef(payload)) return;
      await traced(
        "offer_draw",
        payload.gameReferenceId,
        () => gameManager.handleOfferDraw(socket, payload.gameReferenceId),
        () => socket.emit("error", errorPayload("internal", "Failed to offer draw")),
      );
    });

    // Only the receiver of a pending offer can accept (P1 H6 #1).
    socket.on("accept_draw", async (payload: AcceptDrawPayload) => {
      trackSocketEvent("accept_draw");
      if (!hasGameRef(payload)) return;
      await traced(
        "accept_draw",
        payload.gameReferenceId,
        () => gameManager.handleAcceptDraw(socket, payload.gameReferenceId),
        () => socket.emit("error", errorPayload("internal", "Failed to accept draw")),
      );
    });

    socket.on("decline_draw", async (payload: DeclineDrawPayload) => {
      trackSocketEvent("decline_draw");
      if (!hasGameRef(payload)) return;
      await traced(
        "decline_draw",
        payload.gameReferenceId,
        () => gameManager.handleDeclineDraw(socket, payload.gameReferenceId),
        () => undefined,
      );
    });

    socket.on("disconnect", () => {
      trackSocketEvent("disconnect");
      gameManager.handleDisconnect(socket);
    });
  }

  return {
    gameManager,
    attach,
    hasSocket: (socketId) => gameManager.hasSocket(socketId),
    drain: (timeoutMs) => gameManager.drain(timeoutMs),
    destroy: () => gameManager.destroy(),
  };
}

/**
 * The legacy `/internal/tournament-event` with the static `x-internal-token` (P1 H6 #5). Registered only while
 * PROTOCOL_V1=on and only when no signed (HMAC) handler is mounted on the same path; the v2 alias with
 * `verifyInternal()` (src/http/tournamentEvent.ts, WP-D part 2) replaces it.
 */
export function registerV1TournamentEventRoute(app: Express, tournaments: TournamentManager): void {
  app.post("/internal/tournament-event", express.json({ limit: "64kb" }), (req: Request, res: Response) => {
    if (!verifyInternalToken(req.get(INTERNAL_TOKEN_HEADER))) {
      logger.warn("Rejected /internal/tournament-event without a valid internal token");
      res.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }
    const { event, tournamentReferenceId, data } = (req.body ?? {}) as {
      event?: unknown;
      tournamentReferenceId?: unknown;
      data?: unknown;
    };
    if (typeof event !== "string" || typeof tournamentReferenceId !== "string" || !event || !tournamentReferenceId) {
      res.status(400).json({ error: "Missing event or tournamentReferenceId" });
      return;
    }
    if (!tournaments.emitLegacyEvent(event, tournamentReferenceId, data)) {
      res.status(400).json({ error: "Unknown event" });
      return;
    }
    res.json({ success: true });
  });
}
