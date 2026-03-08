"use client";

import React, { useState, use } from "react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import { useRequireAuth } from "@/lib/hooks";
import { useTournamentLobby } from "@/lib/hooks/useTournamentLobby";
import TournamentHeader from "./TournamentHeader";
import Leaderboard from "./Leaderboard";
import ParticipantList from "./ParticipantList";
import ActiveGames from "./ActiveGames";
import FindMatchButton from "./FindMatchButton";
import { Copy, Check, Loader2 } from "lucide-react";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;

export default function TournamentPage({
  params,
}: {
  params: Promise<{ tournamentReferenceId: string }>;
}) {
  const { tournamentReferenceId } = use(params);
  const { isReady, userObject } = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;

  const { tournament, isLoading, error, refetch } =
    useTournamentLobby(tournamentReferenceId);

  const [isJoining, setIsJoining] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isReady || isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black pt-20 md:pt-28 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
        </div>
      </>
    );
  }

  if (error || !tournament) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-black pt-20 md:pt-28 flex items-center justify-center">
          <p style={geistFont} className="text-white/40 text-sm">
            {error || "Tournament not found"}
          </p>
        </div>
      </>
    );
  }

  const isAdmin = tournament.createdBy.referenceId === userReferenceId;
  const isParticipant = tournament.isParticipant;

  async function handleJoin() {
    setIsJoining(true);
    try {
      const res = await fetch("/api/tournament/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });
      const data = await res.json();
      if (data.success) {
        refetch();
      }
    } catch (err) {
      logger.error("Error joining tournament", err);
    } finally {
      setIsJoining(false);
    }
  }

  async function handleStart() {
    setIsStarting(true);
    try {
      const res = await fetch("/api/tournament/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });
      const data = await res.json();
      if (data.success) {
        refetch();
      }
    } catch (err) {
      logger.error("Error starting tournament", err);
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEnd() {
    setIsEnding(true);
    try {
      const res = await fetch("/api/tournament/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });
      const data = await res.json();
      if (data.success) {
        refetch();
      }
    } catch (err) {
      logger.error("Error ending tournament", err);
    } finally {
      setIsEnding(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/join-tournament/${tournamentReferenceId}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black pt-20 md:pt-28 relative">
        {/* Grid bg */}
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-[88rem] mx-auto px-4 py-8 z-10 space-y-4">
          {/* Header */}
          <TournamentHeader
            tournament={tournament}
            isAdmin={isAdmin}
            isParticipant={isParticipant}
            onStart={handleStart}
            onEnd={handleEnd}
            isStarting={isStarting}
            isEnding={isEnding}
          />

          {/* Share link (LOBBY or ACTIVE) */}
          {tournament.status === "LOBBY" && (
            <div className="border border-white/10 p-4">
              <label style={geistFont} className="block text-white/40 text-xs tracking-wider uppercase mb-2">
                Share Link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/join-tournament/${tournamentReferenceId}`}
                  className="flex-1 bg-transparent border border-white/10 text-white/60 text-sm px-3 py-2 outline-none"
                  style={geistFont}
                />
                <button
                  onClick={handleCopyLink}
                  className={cn(
                    "px-4 py-2 border text-sm transition-all duration-300",
                    copied
                      ? "border-emerald-400/30 text-emerald-400"
                      : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                  )}
                  style={geistFont}
                >
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Join button (non-participants) */}
          {!isParticipant &&
            tournament.status === "LOBBY" && (
              <button
                data-testid="join-tournament-button"
                onClick={handleJoin}
                disabled={isJoining}
                className={cn(
                  "w-full py-3 text-sm font-medium tracking-wide transition-all duration-300",
                  isJoining
                    ? "bg-white/10 text-white/30 cursor-not-allowed"
                    : "bg-white text-black hover:bg-white/90"
                )}
                style={geistFont}
              >
                {isJoining ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Joining...
                  </span>
                ) : (
                  "Join Tournament"
                )}
              </button>
            )}

          {/* Find Match button (ACTIVE + participant) */}
          {isParticipant && (
            <FindMatchButton
              tournamentReferenceId={tournamentReferenceId}
              isActive={tournament.status === "ACTIVE"}
            />
          )}

          {/* Active games */}
          <ActiveGames games={tournament.activeGames} tournamentStatus={tournament.status} />

          {/* Leaderboard (ACTIVE or COMPLETED) */}
          {(tournament.status === "ACTIVE" || tournament.status === "COMPLETED") && (
            <Leaderboard
              participants={tournament.participants}
              isCompleted={tournament.status === "COMPLETED"}
              currentUserParticipant={tournament.currentUserParticipant}
              participantCount={tournament.participantCount}
              tournamentReferenceId={tournamentReferenceId}
            />
          )}

          {/* Participant list (LOBBY) */}
          {tournament.status === "LOBBY" && (
            <ParticipantList
              participants={tournament.participants}
              participantCount={tournament.participantCount}
              tournamentReferenceId={tournamentReferenceId}
            />
          )}
        </div>
      </div>
    </>
  );
}
