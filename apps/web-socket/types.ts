import { Socket } from "socket.io";
import { Color, Square } from "chess.js";

// ============================================
// GAME STATE TYPES
// ============================================

export interface PlayerInfo {
  userReferenceId: string;
  name: string;
  code: string;
  profilePictureUrl: string | null;
}

export interface AIGameConfig {
  gameMode: "AI";
  difficulty: "easy" | "medium" | "hard" | "expert";
  playerColor: "white" | "black";
  playerReferenceId: string;
  botReferenceId: string;
  botName: string;
}

export interface GameData {
  referenceId: string;
  creatorId: string;
  opponentId: string | null;
  chessPositionId: string | null;
  startingFen: string;
  initialTimeSeconds: number;
  incrementSeconds: number;
  creatorTimeRemaining: number;
  opponentTimeRemaining: number;
  status: "WAITING_FOR_OPPONENT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  gameData?: {
    fen?: string;
    moveHistory?: any[];
    gameMode?: string;
    difficulty?: string;
    playerColor?: string;
    playerReferenceId?: string;
    botReferenceId?: string;
    botName?: string;
    positionInfo?: {
      whitePlayerName: string | null;
      blackPlayerName: string | null;
      tournamentName?: string | null;
      whitePlayerImageUrl?: string | null;
      blackPlayerImageUrl?: string | null;
    };
    traceContext?: {
      sentryTrace: string;
      baggage: string;
    };
  };
  creator: PlayerInfo;
  opponent?: PlayerInfo;
}

export interface PlayerConnection {
  socket: Socket;
  userReferenceId: string;
  color: Color;
  playerInfo: PlayerInfo;
}

export type GameResult = "CREATOR_WON" | "OPPONENT_WON" | "DRAW" | "CREATOR_TIMEOUT" | "OPPONENT_TIMEOUT";
export type GameEndMethod = "checkmate" | "timeout" | "resignation" | "draw_agreement" | "stalemate" | "insufficient_material";

// ============================================
// CLIENT → SERVER EVENT PAYLOADS
// ============================================

export interface JoinGamePayload {
  gameReferenceId: string;
  userReferenceId: string;
}

export interface MakeMovePayload {
  gameReferenceId: string;
  from: Square;
  to: Square;
  promotion?: "q" | "r" | "b" | "n";
}

export interface ResignPayload {
  gameReferenceId: string;
}

export interface OfferDrawPayload {
  gameReferenceId: string;
}

export interface AcceptDrawPayload {
  gameReferenceId: string;
}

export interface DeclineDrawPayload {
  gameReferenceId: string;
}

// ============================================
// SERVER → CLIENT EVENT PAYLOADS
// ============================================

export interface WaitingForOpponentPayload {
  gameReferenceId: string;
}

export interface GameStartedPayload {
  gameReferenceId: string;
  yourColor: Color;
  fen: string;
  whiteTime: number;
  blackTime: number;
  whitePlayer: PlayerInfo;
  blackPlayer: PlayerInfo;
  // AI game fields (optional)
  isAIGame?: boolean;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  // Legend position info (optional)
  positionInfo?: {
    whitePlayerName: string | null;
    blackPlayerName: string | null;
    tournamentName?: string | null;
    whitePlayerImageUrl?: string | null;
    blackPlayerImageUrl?: string | null;
  };
}

export interface MoveMadePayload {
  from: Square;
  to: Square;
  san: string;
  fen: string;
  whiteTime: number;
  blackTime: number;
  turn: Color;
  promotion?: string;
}

export interface MoveErrorPayload {
  message: string;
}

export interface ClockUpdatePayload {
  whiteTime: number;
  blackTime: number;
}

export interface GameOverPayload {
  result: GameResult;
  winner: Color | null;
  method: GameEndMethod;
  fen: string;
  whiteTime: number;
  blackTime: number;
}

export interface ErrorPayload {
  message: string;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface ApiGameResponse {
  success: boolean;
  data?: GameData;
  error?: string;
}

export interface ApiMoveRequest {
  gameReferenceId: string;
  userReferenceId: string;
  from: Square;
  to: Square;
  promotion?: string;
  fen: string;
  moveHistory: any[];
  whiteTime: number;
  blackTime: number;
}

export interface ApiGameOverRequest {
  gameReferenceId: string;
  result: GameResult;
  winnerId?: string;
  method: GameEndMethod;
  fen: string;
  whiteTime: number;
  blackTime: number;
}

export interface ApiGameStateRequest {
  gameReferenceId: string;
  whiteTime: number;
  blackTime: number;
  lastMoveAt: Date;
}

// ============================================
// CLOCK MANAGER TYPES
// ============================================

export interface ClockState {
  whiteTime: number; // milliseconds
  blackTime: number; // milliseconds
  activeColor: Color | null;
  lastUpdateTime: number; // timestamp
}

export interface ClockConfig {
  initialTime: number; // seconds
  increment: number; // seconds
}

// ============================================
// ANALYSIS PHASE TYPES
// ============================================

export interface AnalysisPhaseStartedPayload {
  gameReferenceId: string;
  analysisTimeSeconds: number;
  yourColor: Color;
  fen: string;
  whiteTime: number;
  blackTime: number;
  whitePlayer: PlayerInfo;
  blackPlayer: PlayerInfo;
  isAIGame?: boolean;
  difficulty?: "easy" | "medium" | "hard" | "expert";
  positionInfo?: {
    whitePlayerName: string | null;
    blackPlayerName: string | null;
    tournamentName?: string | null;
    whitePlayerImageUrl?: string | null;
    blackPlayerImageUrl?: string | null;
  };
}

export interface AnalysisTickPayload {
  remainingSeconds: number;
  totalSeconds: number;
}

// ============================================
// SPECTATOR TYPES
// ============================================

export interface SpectateGamePayload {
  gameReferenceId: string;
}

export interface SpectatorStatePayload {
  gameReferenceId: string;
  fen: string;
  whiteTime: number;
  blackTime: number;
  whitePlayer: PlayerInfo;
  blackPlayer: PlayerInfo;
  moveHistory: Array<{ from: string; to: string; san: string; promotion?: string }>;
  startingFen: string;
  gameStarted: boolean;
  isAnalysisPhase: boolean;
  analysisRemainingSeconds?: number;
  analysisTotalSeconds?: number;
  spectatorCount: number;
  positionInfo?: any;
  gameOver?: boolean;
  gameOverPayload?: GameOverPayload;
}

export interface SpectatorCountPayload {
  count: number;
}
