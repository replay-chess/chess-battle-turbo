import Image from "next/image";
import { cn, formatTime } from "@/lib/utils";
import type { Color } from "chess.js";
import type { Player } from "@/lib/types/socket-events";

interface PlayerInfoCardProps {
  isOpponent: boolean;
  myColor: Color | null;
  whitePlayer: Player | null;
  blackPlayer: Player | null;
  whiteTime: number;
  blackTime: number;
  currentTurn: "w" | "b";
  isAIGame: boolean;
  botColor: Color | null;
  positionInfo: {
    whitePlayerName: string | null;
    blackPlayerName: string | null;
    tournamentName?: string | null;
    whitePlayerImageUrl?: string | null;
    blackPlayerImageUrl?: string | null;
    openingName?: string | null;
    openingEco?: string | null;
  } | null;
  isSpectator?: boolean;
}

export function PlayerInfoCard({
  isOpponent,
  myColor,
  whitePlayer,
  blackPlayer,
  whiteTime,
  blackTime,
  currentTurn,
  isAIGame,
  botColor,
  positionInfo,
  isSpectator,
}: PlayerInfoCardProps) {
  // Opponent: show the other side. Player: show our side.
  const pieceColor = isOpponent
    ? (myColor === "w" ? "b" : "w")
    : (myColor ?? "w");

  const playerName = isOpponent
    ? (myColor === "w" ? blackPlayer?.name || "Black" : whitePlayer?.name || "White")
    : (myColor === "w" ? whitePlayer?.name || "White" : blackPlayer?.name || "Black");

  const time = isOpponent
    ? (myColor === "w" ? blackTime : whiteTime)
    : (myColor === "w" ? whiteTime : blackTime);

  const isActive = isOpponent
    ? currentTurn !== myColor
    : currentTurn === myColor;

  const legendName = isOpponent
    ? (myColor === "b"
        ? (positionInfo?.whitePlayerName || "hoodie guy")
        : (positionInfo?.blackPlayerName || "hoodie guy"))
    : (myColor === "w"
        ? (positionInfo?.whitePlayerName || "hoodie guy")
        : (positionInfo?.blackPlayerName || "hoodie guy"));

  const legendImage = isOpponent
    ? (myColor === "b" ? positionInfo?.whitePlayerImageUrl : positionInfo?.blackPlayerImageUrl)
    : (myColor === "w" ? positionInfo?.whitePlayerImageUrl : positionInfo?.blackPlayerImageUrl);

  const fallbackPiece = pieceColor === "w" ? "♔" : "♚";
  const squareBg = pieceColor === "w"
    ? (isOpponent ? "bg-black border border-cb-border-strong" : "bg-white")
    : (isOpponent ? "bg-white" : "bg-black border border-cb-border-strong");
  const pieceTextColor = pieceColor === "w"
    ? (isOpponent ? "text-white" : "text-black")
    : (isOpponent ? "text-black" : "text-white");
  const displayPiece = isOpponent
    ? (myColor === "w" ? "♚" : "♔")
    : (myColor === "w" ? "♔" : "♚");

  return (
    <div className={cn(
      "flex items-center justify-between px-2",
      isOpponent ? "mb-1.5 sm:mb-3 md:mb-4 lg:mb-5" : "mt-1.5 sm:mt-3 md:mt-4 lg:mt-5"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn("w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 flex items-center justify-center", squareBg)}>
          <span className={pieceTextColor}>{displayPiece}</span>
        </div>
        <div>
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text font-medium text-xs sm:text-sm md:text-base">
            {playerName}
            {isOpponent && isAIGame && botColor && myColor !== botColor && (
              <span className="text-cb-text-muted"> (Bot)</span>
            )}
            {!isOpponent && !isSpectator && <span className="text-cb-text-muted"> (You)</span>}
          </p>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-[10px] sm:text-xs md:text-sm leading-tight"
          >
            {pieceColor === "w" ? "White" : "Black"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
        {positionInfo && !positionInfo.openingName && (
          <div className="flex items-center gap-2">
            <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-cb-text font-medium text-sm">
              <span className="text-cb-text-muted">as </span>
              {legendName}
            </p>
            <div className="w-8 h-8 bg-cb-surface-elevated border border-cb-border-strong flex items-center justify-center overflow-hidden relative">
              {legendImage ? (
                <Image
                  src={legendImage}
                  alt="Legend"
                  fill
                  className="object-cover"
                  sizes="32px"
                />
              ) : (
                <span className={cn(
                  "text-sm",
                  pieceColor === "w" ? "text-cb-text" : "text-cb-text-secondary"
                )}>
                  {fallbackPiece}
                </span>
              )}
            </div>
          </div>
        )}
        <div className={cn(
          "px-2.5 py-1 sm:px-4 sm:py-2 md:px-5 md:py-2.5 font-mono text-base sm:text-xl md:text-2xl",
          isActive ? "bg-cb-accent text-cb-accent-fg" : "bg-cb-surface-elevated text-cb-text"
        )}>
          {formatTime(time)}
        </div>
      </div>
    </div>
  );
}
