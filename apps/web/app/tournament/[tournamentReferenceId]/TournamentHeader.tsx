"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Clock, Users, Gamepad2, Trophy } from "lucide-react";
import type { TournamentData } from "@/lib/hooks/useTournamentLobby";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;
const serifFont = { fontFamily: "'Instrument Serif', serif" } as const;

const statusColors: Record<string, string> = {
  LOBBY: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  ACTIVE: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  COMPLETED: "text-white/40 bg-white/5 border-white/10",
  CANCELLED: "text-red-400 bg-red-400/10 border-red-400/20",
};

function formatTimeControl(time: number, increment: number): string {
  const minutes = Math.floor(time / 60);
  if (increment > 0) return `${minutes}|${increment}`;
  return `${minutes} min`;
}

function CountdownTimer({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Ended");
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hours > 0) {
        setRemaining(`${hours}h ${mins}m ${secs}s`);
      } else {
        setRemaining(`${mins}m ${secs}s`);
      }
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <span className="text-emerald-400 font-mono tabular-nums">{remaining}</span>
  );
}

interface TournamentHeaderProps {
  tournament: TournamentData;
  isAdmin: boolean;
  isParticipant: boolean;
  onStart: () => void;
  onEnd: () => void;
  isStarting: boolean;
  isEnding: boolean;
}

export default function TournamentHeader({
  tournament,
  isAdmin,
  isParticipant,
  onStart,
  onEnd,
  isStarting,
  isEnding,
}: TournamentHeaderProps) {
  return (
    <div className="border border-white/10 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Trophy className="w-5 h-5 text-white/40" strokeWidth={1.5} />
            <h1 style={serifFont} className="text-2xl sm:text-3xl text-white">
              {tournament.name}
            </h1>
          </div>
          <p style={geistFont} className="text-white/40 text-sm">
            Created by {tournament.createdBy.name}
          </p>
          {tournament.description && (
            <p style={geistFont} className="text-white/50 text-sm mt-1">
              {tournament.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isParticipant && (
            <span
              style={geistFont}
              className="text-[10px] tracking-wider uppercase px-2.5 py-1 border text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
            >
              Joined
            </span>
          )}
          <span
            data-testid="tournament-status"
            style={geistFont}
            className={cn(
              "text-[10px] tracking-wider uppercase px-2.5 py-1 border",
              statusColors[tournament.status] || "text-white/40"
            )}
          >
            {tournament.status}
          </span>
        </div>
      </div>

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-4 text-white/50 text-sm mb-4" style={geistFont}>
        <span className="flex items-center gap-1.5">
          <Gamepad2 className="w-4 h-4" />
          {tournament.mode}
          {tournament.opening && ` — ${tournament.opening.name}`}
          {tournament.legend && ` — ${tournament.legend.name}`}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          {formatTimeControl(tournament.initialTimeSeconds, tournament.incrementSeconds)}
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          {tournament.participantCount}
          {tournament.maxParticipants ? `/${tournament.maxParticipants}` : ""} players
        </span>
        <span>{tournament.durationMinutes} min duration</span>
      </div>

      {/* Scheduled start countdown */}
      {tournament.status === "LOBBY" && tournament.scheduledStartAt && (
        <div className="flex items-center gap-2 mb-4" style={geistFont}>
          <span className="text-white/40 text-sm">Starts in:</span>
          <CountdownTimer endsAt={tournament.scheduledStartAt} />
        </div>
      )}

      {/* Active countdown */}
      {tournament.status === "ACTIVE" && tournament.endsAt && (
        <div className="flex items-center gap-2 mb-4" style={geistFont}>
          <span className="text-white/40 text-sm">Time remaining:</span>
          <CountdownTimer endsAt={tournament.endsAt} />
        </div>
      )}

      {/* Admin controls */}
      {isAdmin && (
        <div className="flex gap-3">
          {tournament.status === "LOBBY" && (
            <button
              data-testid="start-tournament-button"
              onClick={onStart}
              disabled={isStarting}
              className={cn(
                "px-5 py-2 text-sm font-medium tracking-wide transition-all duration-300",
                isStarting
                  ? "bg-white/10 text-white/30 cursor-not-allowed"
                  : "bg-white text-black hover:bg-white/90"
              )}
              style={geistFont}
            >
              {isStarting ? "Starting..." : "Start Tournament"}
            </button>
          )}
          {(tournament.status === "ACTIVE" || tournament.status === "LOBBY") && (
            <button
              data-testid="end-tournament-button"
              onClick={onEnd}
              disabled={isEnding}
              className={cn(
                "px-5 py-2 text-sm font-medium tracking-wide border transition-all duration-300",
                isEnding
                  ? "border-white/10 text-white/30 cursor-not-allowed"
                  : "border-white/20 text-white/60 hover:border-white/40 hover:text-white"
              )}
              style={geistFont}
            >
              {isEnding ? "Ending..." : "End Tournament"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
