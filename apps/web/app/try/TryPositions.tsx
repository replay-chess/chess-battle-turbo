"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ChessBoard from "@/app/components/ChessBoard";
import { cn } from "@/lib/utils";
import type { FeaturedPosition } from "@/lib/featured-position-types";

export function TryPositions({ positions }: { positions: FeaturedPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="border border-cb-border px-6 py-12 text-center">
        <p className="font-sans text-sm text-cb-text-muted">
          Featured boards are being refreshed. The learning guides and journal
          are still available below.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
      {positions.map((position) => {
        const context = position.positionContext as Record<
          string,
          string
        > | null;
        const title =
          position.tournamentName ||
          context?.openingName ||
          context?.gameName ||
          position.positionType ||
          "Chess position";
        const isBlack =
          position.sideToMove === "black" || position.sideToMove === "b";

        return (
          <Link
            key={position.referenceId}
            href={`/try/${position.referenceId}`}
            className="group bg-cb-surface border border-cb-border transition-colors duration-300 hover:border-cb-border-strong hover:bg-cb-hover"
          >
            <div className="p-4 pt-6 sm:p-6 sm:pt-8">
              <ChessBoard
                board={new Chess(position.fen).board()}
                playerColor={isBlack ? "b" : "w"}
                isInteractive={false}
                showCoordinates={false}
                squareSize="md"
              />
            </div>
            <div className="px-4 pb-5 sm:px-6 sm:pb-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-serif text-xl leading-tight text-cb-text">
                    {title}
                  </h2>
                  {position.whitePlayerName && position.blackPlayerName && (
                    <p className="mt-1 truncate font-sans text-xs text-cb-text-muted">
                      {position.whitePlayerName} vs {position.blackPlayerName}
                    </p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-cb-text-faint transition-transform group-hover:translate-x-1" />
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-cb-border pt-3">
                <div
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    isBlack
                      ? "bg-zinc-700 ring-1 ring-white/10"
                      : "bg-white/90 ring-1 ring-white/20",
                  )}
                />
                <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-cb-text-faint">
                  {isBlack ? "Black" : "White"} to move
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
