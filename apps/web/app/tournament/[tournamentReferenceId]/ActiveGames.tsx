"use client";

import React, { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Swords, Clock, Info, ChevronDown } from "lucide-react";
import type { TournamentData } from "@/lib/hooks/useTournamentLobby";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;

type ActiveGame = TournamentData["activeGames"][number];

interface ActiveGamesProps {
  games: ActiveGame[];
  tournamentStatus: string;
}

export default function ActiveGames({ games, tournamentStatus }: ActiveGamesProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (games.length === 0) return null;

  const isFinishing = tournamentStatus === "COMPLETED";

  return (
    <div className={cn("border", isFinishing ? "border-amber-500/20" : "border-cb-border")}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3 flex items-center justify-between",
          isFinishing ? "border-amber-500/20" : "border-cb-border",
          isOpen && "border-b",
        )}
      >
        <div className="flex items-center gap-2">
          {isFinishing ? (
            <Clock className="w-3.5 h-3.5 text-amber-400/60" />
          ) : null}
          <h2 style={geistFont} className={cn(
            "text-sm font-medium tracking-wider uppercase",
            isFinishing ? "text-amber-400/60" : "text-cb-text-secondary"
          )}>
            {isFinishing ? "Finishing Games" : "Live Games"} ({games.length})
          </h2>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 transition-transform duration-200",
            isFinishing ? "text-amber-400/40" : "text-cb-text-muted",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <>
          {isFinishing && (
            <div className="px-4 py-2.5 border-b border-amber-500/10 bg-amber-500/[0.03]">
              <p style={geistFont} className="text-xs text-amber-400/40 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                These games started before the tournament ended — results will still count toward final standings.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g) => (
              <Link
                key={g.referenceId}
                href={`/game/${g.referenceId}`}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 hover:bg-cb-hover transition-colors",
                  "border-b border-r border-cb-border last:border-b-0",
                )}
              >
                <Swords className={cn("w-3.5 h-3.5 shrink-0", isFinishing ? "text-amber-400/30" : "text-cb-text-muted")} />
                <span style={geistFont} className="text-sm text-cb-text truncate">
                  {g.creator.name}
                </span>
                <span style={geistFont} className="text-[10px] text-cb-text-muted">
                  vs
                </span>
                <span style={geistFont} className="text-sm text-cb-text truncate">
                  {g.opponent?.name || "..."}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
