"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useRequireAuth } from "@/lib/hooks";
import { motion } from "motion/react";
import { Navbar } from "@/app/components/Navbar";
import { Trophy, Clock, Gamepad2, Users, Timer, Loader2 } from "lucide-react";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;
const serifFont = { fontFamily: "'Instrument Serif', serif" } as const;

interface TournamentDetails {
  referenceId: string;
  name: string;
  description: string | null;
  mode: string;
  status: string;
  maxParticipants: number | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  durationMinutes: number;
  scheduledStartAt: string;
  participantCount: number;
  createdBy: {
    referenceId: string;
    name: string;
    profilePictureUrl: string | null;
  };
}

function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Starting soon");
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
  }, [targetDate]);

  return (
    <span className="text-emerald-400 font-mono tabular-nums">{remaining}</span>
  );
}

function formatTimeControl(time: number, increment: number): string {
  const minutes = Math.floor(time / 60);
  if (increment > 0) return `${minutes}|${increment}`;
  return `${minutes} min`;
}

export default function JoinTournamentPage({
  params,
}: {
  params: Promise<{ tournamentReferenceId: string }>;
}) {
  const { tournamentReferenceId } = use(params);
  const { isReady, userObject } = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();

  const [tournament, setTournament] = useState<TournamentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [alreadyJoined, setAlreadyJoined] = useState(false);

  useEffect(() => {
    async function fetchTournament() {
      try {
        const res = await fetch(`/api/tournament/${tournamentReferenceId}`);
        const data = await res.json();
        if (!data.success) {
          setError(data.error || "Tournament not found");
          return;
        }
        setTournament(data.data);

        // Check if user already joined
        if (data.data.isParticipant) {
          setAlreadyJoined(true);
        }
      } catch {
        setError("Failed to load tournament");
      } finally {
        setLoading(false);
      }
    }

    if (isReady) {
      fetchTournament();
    }
  }, [tournamentReferenceId, isReady, userReferenceId]);

  // Redirect if already joined
  useEffect(() => {
    if (alreadyJoined) {
      router.replace(`/tournament/${tournamentReferenceId}`);
    }
  }, [alreadyJoined, router, tournamentReferenceId]);

  async function handleJoin() {
    setJoining(true);
    try {
      const res = await fetch("/api/tournament/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/tournament/${tournamentReferenceId}`);
      } else {
        setError(data.error || "Failed to join tournament");
        setJoining(false);
      }
    } catch (err) {
      logger.error("Error joining tournament:", err);
      setError("Failed to join tournament");
      setJoining(false);
    }
  }

  if (loading || !isReady || alreadyJoined) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-cb-bg flex items-center justify-center pt-16 md:pt-24">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-12 h-12 border-2 border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
            <p style={geistFont} className="text-cb-text-muted text-sm tracking-wide">
              Loading...
            </p>
          </motion.div>
        </div>
      </>
    );
  }

  if (error || !tournament) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-cb-bg flex items-center justify-center pt-16 md:pt-24 p-4 relative">
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 border border-cb-border p-8 max-w-md text-center"
          >
            <div className="w-16 h-16 border border-cb-border-strong flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl text-cb-text-muted">&times;</span>
            </div>
            <h2 style={serifFont} className="text-2xl text-cb-text mb-3">
              Tournament Not Found
            </h2>
            <p style={geistFont} className="text-cb-text-muted mb-8">
              {error || "This tournament doesn't exist or is no longer available."}
            </p>
            <button
              onClick={() => router.push("/")}
              className={cn(
                "group relative w-full flex items-center justify-center gap-2 px-8 py-4",
                "bg-cb-accent text-cb-accent-fg",
                "transition-all duration-300 overflow-hidden"
              )}
              style={geistFont}
            >
              <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative z-10 font-medium group-hover:text-cb-text transition-colors duration-300">
                Go Home
              </span>
            </button>
          </motion.div>
        </div>
      </>
    );
  }

  const registrationClosed = tournament.status !== "LOBBY";
  const isFull = tournament.maxParticipants
    ? tournament.participantCount >= tournament.maxParticipants
    : false;

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-cb-bg flex items-center justify-center pt-16 md:pt-24 sm:pt-20 p-4 relative">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 border border-cb-border p-6 sm:p-10 max-w-xl w-full"
        >
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-8"
          >
            <div className="w-16 h-16 bg-cb-accent flex items-center justify-center mx-auto mb-6">
              <Trophy className="w-8 h-8 text-cb-accent-fg" strokeWidth={1.5} />
            </div>
            <h1 style={serifFont} className="text-3xl sm:text-4xl text-cb-text">
              {tournament.name}
            </h1>
            <p style={geistFont} className="text-cb-text-muted text-sm mt-2">
              Created by {tournament.createdBy.name}
            </p>
            {tournament.description && (
              <p style={geistFont} className="text-cb-text-secondary text-sm mt-2">
                {tournament.description}
              </p>
            )}
          </motion.div>

          {/* Details Grid */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 gap-4 mb-6"
          >
            <div className="border border-cb-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                <span style={geistFont} className="text-xs text-cb-text-muted uppercase tracking-wide">
                  Mode
                </span>
              </div>
              <p style={serifFont} className="text-2xl text-cb-text">
                {tournament.mode}
              </p>
            </div>

            <div className="border border-cb-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                <span style={geistFont} className="text-xs text-cb-text-muted uppercase tracking-wide">
                  Time Control
                </span>
              </div>
              <p style={serifFont} className="text-2xl text-cb-text">
                {formatTimeControl(tournament.initialTimeSeconds, tournament.incrementSeconds)}
              </p>
            </div>

            <div className="border border-cb-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                <span style={geistFont} className="text-xs text-cb-text-muted uppercase tracking-wide">
                  Duration
                </span>
              </div>
              <p style={serifFont} className="text-2xl text-cb-text">
                {tournament.durationMinutes}m
              </p>
            </div>

            <div className="border border-cb-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-cb-text-muted" strokeWidth={1.5} />
                <span style={geistFont} className="text-xs text-cb-text-muted uppercase tracking-wide">
                  Players
                </span>
              </div>
              <p style={serifFont} className="text-2xl text-cb-text">
                {tournament.participantCount}
                {tournament.maxParticipants ? `/${tournament.maxParticipants}` : ""}
              </p>
            </div>
          </motion.div>

          {/* Countdown */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="border border-cb-border p-4 mb-6 text-center"
          >
            <p style={geistFont} className="text-xs text-cb-text-muted uppercase tracking-wide mb-2">
              Starts in
            </p>
            <p style={geistFont} className="text-lg">
              <CountdownTimer targetDate={tournament.scheduledStartAt} />
            </p>
          </motion.div>

          {/* Status messages */}
          {registrationClosed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="border border-cb-border-strong p-4 mb-6"
            >
              <p style={geistFont} className="text-cb-text-secondary text-center text-sm">
                Registration is closed — tournament has already started.
              </p>
            </motion.div>
          )}

          {isFull && !registrationClosed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="border border-cb-border-strong p-4 mb-6"
            >
              <p style={geistFont} className="text-cb-text-secondary text-center text-sm">
                This tournament is full.
              </p>
            </motion.div>
          )}

          {/* Join button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <button
              data-testid="join-tournament-button"
              onClick={handleJoin}
              disabled={joining || registrationClosed || isFull}
              className={cn(
                "group relative w-full flex items-center justify-center gap-2 px-8 py-4",
                "transition-all duration-300 overflow-hidden",
                registrationClosed || isFull
                  ? "bg-cb-surface-elevated text-cb-text-muted cursor-not-allowed"
                  : "bg-cb-accent text-cb-accent-fg",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              style={geistFont}
            >
              {!registrationClosed && !isFull && (
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              )}
              <span
                className={cn(
                  "relative z-10 font-medium transition-colors duration-300",
                  !registrationClosed && !isFull && "group-hover:text-cb-text"
                )}
              >
                {joining ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Joining...
                  </span>
                ) : registrationClosed ? (
                  "Registration Closed"
                ) : isFull ? (
                  "Tournament Full"
                ) : (
                  "Join Tournament"
                )}
              </span>
            </button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
