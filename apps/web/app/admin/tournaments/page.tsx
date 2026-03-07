"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import { Plus, ArrowLeft, Trophy, Users, Clock, Gamepad2 } from "lucide-react";
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

function formatTimeControl(time: number, increment: number): string {
  const minutes = Math.floor(time / 60);
  if (increment > 0) return `${minutes}|${increment}`;
  return `${minutes} min`;
}

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tournament")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTournaments(data.data.tournaments);
        }
      })
      .catch((err) => logger.error("Failed to fetch tournaments", err))
      .finally(() => setIsLoading(false));
  }, []);

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

        <div className="relative max-w-6xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="p-2 border border-white/10 hover:border-white/30 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-white/60" />
              </Link>
              <div>
                <h1 style={serifFont} className="text-3xl text-white">
                  Tournaments
                </h1>
                <p style={geistFont} className="text-white/40 text-sm">
                  Manage time-boxed tournaments
                </p>
              </div>
            </div>
            <Link
              href="/admin/tournaments/create"
              className={cn(
                "group relative overflow-hidden",
                "bg-white text-black",
                "h-9 px-5 flex items-center gap-2",
                "text-sm font-medium tracking-wide",
                "transition-all duration-300"
              )}
              style={geistFont}
            >
              <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative flex items-center gap-2 group-hover:text-white transition-colors duration-300">
                <Plus className="w-4 h-4" />
                Create Tournament
              </span>
            </Link>
          </div>

          {/* Tournament List */}
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
              <Trophy className="w-10 h-10 text-white/20 mb-4" />
              <p style={geistFont} className="text-white/40 text-sm">
                No tournaments yet
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <Link
                  key={t.referenceId}
                  href={`/tournament/${t.referenceId}`}
                >
                  <motion.div
                    className="border border-white/10 p-5 hover:border-white/20 transition-all duration-300 cursor-pointer group"
                    whileHover={{ y: -2 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 style={serifFont} className="text-lg text-white truncate">
                            {t.name}
                          </h3>
                          <span
                            style={geistFont}
                            className={cn(
                              "text-[10px] tracking-wider uppercase px-2 py-0.5 border shrink-0",
                              statusColors[t.status] || "text-white/40"
                            )}
                          >
                            {t.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-white/40 text-xs" style={geistFont}>
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
                            {t.participantCount}{t.maxParticipants ? `/${t.maxParticipants}` : ""}
                          </span>
                          <span>{t.durationMinutes} min</span>
                          <span>{t.gameCount} games</span>
                        </div>
                      </div>
                    </div>
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
