"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface ProfileStats {
  totalGamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  winRate: number;
  currentWinStreak: number;
  longestWinStreak: number;
  averageGameDuration: number | null;
  lastPlayedAt: string | null;
}

interface StatsOverviewProps {
  stats: ProfileStats | null;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return "--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function StatsOverview({ stats }: StatsOverviewProps) {
  if (!stats || stats.totalGamesPlayed === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="border border-cb-border p-8 sm:p-10 text-center"
      >
        <span className="text-cb-text-faint text-4xl block mb-4">♟</span>
        <p
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-cb-text-muted text-lg mb-2"
        >
          No games played yet
        </p>
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-faint text-sm"
        >
          Stats will appear after the first game
        </p>
      </motion.div>
    );
  }

  const offset = CIRCUMFERENCE - (stats.winRate / 100) * CIRCUMFERENCE;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="border border-cb-border"
    >
      {/* Section header */}
      <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-cb-border-strong to-transparent" />
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-[10px] tracking-[0.3em] uppercase"
          >
            Stats
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-cb-border-strong to-transparent" />
        </div>
      </div>

      <div className="px-6 sm:px-8 pb-6 sm:pb-8">
        <div className="flex flex-col lg:flex-row gap-8 items-center">
          {/* Win Rate Ring */}
          <div className="relative flex-shrink-0">
            <svg width="120" height="120" className="transform -rotate-90">
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke="var(--cb-border)"
                strokeWidth="5"
              />
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke="var(--cb-text)"
                strokeWidth="5"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                style={{ fontFamily: "'Geist Mono', monospace" }}
                className="text-cb-text text-2xl font-medium"
              >
                {stats.winRate.toFixed(0)}%
              </span>
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-faint text-[9px] tracking-[0.2em] uppercase mt-0.5"
              >
                Win Rate
              </span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="flex-1 w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-cb-hover">
            <StatCell label="Won" value={stats.gamesWon} accent="text-green-400/80" />
            <StatCell label="Lost" value={stats.gamesLost} accent="text-red-400/80" />
            <StatCell label="Drawn" value={stats.gamesDrawn} accent="text-cb-text-secondary" />
            <StatCell label="Total" value={stats.totalGamesPlayed} />
            <StatCell label="Current Streak" value={stats.currentWinStreak} />
            <StatCell label="Best Streak" value={stats.longestWinStreak} />
            <StatCell label="Avg Duration" value={formatDuration(stats.averageGameDuration)} />
            <StatCell
              label="Last Played"
              value={stats.lastPlayedAt ? timeAgo(stats.lastPlayedAt) : "--"}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="bg-cb-bg p-4 sm:p-5">
      <p
        style={{ fontFamily: "'Geist Mono', monospace" }}
        className={cn("text-xl sm:text-2xl font-medium mb-1", accent || "text-cb-text")}
      >
        {value}
      </p>
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-cb-text-faint text-[10px] tracking-[0.15em] uppercase"
      >
        {label}
      </p>
    </div>
  );
}

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}
