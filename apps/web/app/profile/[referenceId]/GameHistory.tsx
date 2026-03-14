"use client";

import { motion } from "motion/react";
import { cn, getInitials } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface ProfileGame {
  referenceId: string;
  opponent: {
    name: string;
    profilePictureUrl: string | null;
    code: string;
  } | null;
  outcome: "win" | "loss" | "draw";
  result: string;
  timeControl: string;
  completedAt: string | null;
}

interface GameHistoryProps {
  games: ProfileGame[];
}

const OUTCOME_STYLES = {
  win: { label: "W", color: "text-green-400", border: "border-l-green-400/50", bg: "bg-green-400/5" },
  loss: { label: "L", color: "text-red-400", border: "border-l-red-400/50", bg: "bg-red-400/5" },
  draw: { label: "D", color: "text-cb-text-muted", border: "border-l-cb-border-strong", bg: "bg-cb-hover" },
} as const;

function timeAgo(dateString: string | null): string {
  if (!dateString) return "";
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

export function GameHistory({ games }: GameHistoryProps) {
  if (games.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="border border-cb-border p-8 sm:p-10 text-center"
      >
        <span className="text-cb-text-faint text-4xl block mb-4">♜</span>
        <p
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-cb-text-muted text-lg mb-2"
        >
          No games yet
        </p>
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-faint text-sm"
        >
          Completed games will appear here
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="border border-cb-border"
    >
      {/* Section header */}
      <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-cb-border-strong to-transparent" />
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-[10px] tracking-[0.3em] uppercase"
          >
            Recent Games
          </span>
        </div>
        <span
          style={{ fontFamily: "'Geist Mono', monospace" }}
          className="text-cb-text-faint text-xs"
        >
          {games.length}
        </span>
      </div>

      {/* Game list */}
      <div className="max-h-[480px] overflow-y-auto custom-scrollbar">
        {games.map((game, index) => {
          const style = OUTCOME_STYLES[game.outcome];
          const opponentName = game.opponent?.name || "Unknown";

          return (
            <Link
              key={game.referenceId}
              href={`/analysis/${game.referenceId}`}
              className={cn(
                "flex items-center gap-3 sm:gap-4 px-6 sm:px-8 py-3.5",
                "border-l-2",
                style.border,
                "hover:bg-cb-hover transition-colors duration-200",
                index < games.length - 1 && "border-b border-b-cb-border"
              )}
            >
              {/* Outcome badge */}
              <div
                className={cn(
                  "w-8 h-8 flex items-center justify-center flex-shrink-0",
                  style.bg
                )}
              >
                <span
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                  className={cn("text-sm font-medium", style.color)}
                >
                  {style.label}
                </span>
              </div>

              {/* Opponent info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-7 h-7 border border-cb-border bg-cb-hover flex-shrink-0 overflow-hidden relative">
                  {game.opponent?.profilePictureUrl ? (
                    <Image
                      src={game.opponent.profilePictureUrl}
                      alt={opponentName}
                      fill
                      className="object-cover"
                      sizes="28px"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-cb-text-muted text-[10px]"
                      >
                        {getInitials(opponentName)}
                      </span>
                    </div>
                  )}
                </div>
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-secondary text-sm truncate"
                >
                  {opponentName}
                </span>
              </div>

              {/* Time control */}
              <span
                style={{ fontFamily: "'Geist Mono', monospace" }}
                className="text-cb-text-faint text-xs flex-shrink-0 hidden sm:block"
              >
                {game.timeControl}
              </span>

              {/* Time ago */}
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-faint text-xs flex-shrink-0 w-16 text-right"
              >
                {timeAgo(game.completedAt)}
              </span>

              {/* Chevron */}
              <ChevronRight className="w-3.5 h-3.5 text-cb-text-faint flex-shrink-0" />
            </Link>
          );
        })}
      </div>
    </motion.div>
  );
}
