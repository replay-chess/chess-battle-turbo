"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import { Trophy, Users, Clock, Gamepad2 } from "lucide-react";
import { motion } from "motion/react";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;
const serifFont = { fontFamily: "'Instrument Serif', serif" } as const;

interface Tournament {
  referenceId: string;
  name: string;
  mode: string;
  status: string;
  maxParticipants: number | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  durationMinutes: number;
  scheduledStartAt: string;
  startedAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: { referenceId: string; name: string };
  participantCount: number;
  gameCount: number;
}

const statusColors: Record<string, string> = {
  LOBBY: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  ACTIVE: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  COMPLETED: "text-white/40 bg-white/5 border-white/10",
  CANCELLED: "text-red-400 bg-red-400/10 border-red-400/20",
};

const filterTabs = [
  { label: "Active", statuses: "LOBBY,ACTIVE" },
  { label: "Completed", statuses: "COMPLETED" },
  { label: "All", statuses: "" },
] as const;

function formatTimeControl(time: number, increment: number): string {
  const minutes = Math.floor(time / 60);
  if (increment > 0) return `${minutes}|${increment}`;
  return `${minutes} min`;
}

function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Now");
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
    <span className="text-emerald-400 font-mono tabular-nums text-xs">{remaining}</span>
  );
}

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    const tab = filterTabs[activeFilter]!;
    const query = tab.statuses ? `?statuses=${tab.statuses}` : "";
    fetch(`/api/tournament${query}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTournaments(data.data.tournaments);
        }
      })
      .catch((err) => logger.error("Failed to fetch tournaments", err))
      .finally(() => setIsLoading(false));
  }, [activeFilter]);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black pt-20 md:pt-28 relative">
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-3xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-6 h-6 text-white/40" strokeWidth={1.5} />
            <div>
              <h1 style={serifFont} className="text-3xl text-white">
                Tournaments
              </h1>
              <p style={geistFont} className="text-white/40 text-sm">
                Join or spectate live tournaments
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-6">
            {filterTabs.map((tab, i) => (
              <button
                key={tab.label}
                onClick={() => setActiveFilter(i)}
                className={cn(
                  "px-4 py-2 text-sm border transition-all duration-200",
                  activeFilter === i
                    ? "bg-white text-black border-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border-white/10"
                )}
                style={geistFont}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 border border-white/10 bg-white/5 animate-pulse"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          ) : tournaments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 border border-white/10">
              <Trophy className="w-10 h-10 text-white/20 mb-4" strokeWidth={1} />
              <p style={geistFont} className="text-white/40 text-sm">
                No tournaments found
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <Link key={t.referenceId} href={`/tournament/${t.referenceId}`}>
                  <motion.div
                    className="border border-white/10 p-5 hover:border-white/20 transition-all duration-300 cursor-pointer"
                    whileHover={{ y: -2 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 style={serifFont} className="text-lg text-white truncate">
                        {t.name}
                      </h3>
                      <span
                        style={geistFont}
                        className={cn(
                          "text-[10px] tracking-wider uppercase px-2 py-0.5 border shrink-0 ml-3",
                          statusColors[t.status] || "text-white/40"
                        )}
                      >
                        {t.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-white/40 text-xs mb-2" style={geistFont}>
                      <span className="flex items-center gap-1.5">
                        <Gamepad2 className="w-3.5 h-3.5" />
                        {t.mode}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatTimeControl(t.initialTimeSeconds, t.incrementSeconds)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        {t.participantCount}
                        {t.maxParticipants ? `/${t.maxParticipants}` : ""} players
                      </span>
                      <span>{t.durationMinutes} min</span>
                    </div>

                    {/* Countdown for active tournaments */}
                    {(t.status === "LOBBY" || t.status === "ACTIVE") && (
                      <div className="flex items-center gap-2" style={geistFont}>
                        <span className="text-white/30 text-xs">
                          {t.status === "LOBBY" ? "Starts in:" : "Ends in:"}
                        </span>
                        <CountdownTimer
                          targetDate={t.status === "LOBBY" ? t.scheduledStartAt : (t.endsAt ?? t.scheduledStartAt)}
                        />
                      </div>
                    )}
                  </motion.div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
