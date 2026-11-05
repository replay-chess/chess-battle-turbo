"use client";

import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";

interface ProfileChessComProfile {
  chessComHandle: string;
  rapidRating: number | null;
  rapidBestRating: number | null;
  blitzRating: number | null;
  blitzBestRating: number | null;
  bulletRating: number | null;
  bulletBestRating: number | null;
  dailyRating: number | null;
  dailyBestRating: number | null;
  lastSyncedAt: string;
}

interface ChessComRatingsProps {
  profile: ProfileChessComProfile;
}

const RATING_CATEGORIES = [
  { key: "rapid", label: "Rapid" },
  { key: "blitz", label: "Blitz" },
  { key: "bullet", label: "Bullet" },
  { key: "daily", label: "Daily" },
] as const;

function formatSyncDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ChessComRatings({ profile }: ChessComRatingsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
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
            Chess.com
          </span>
        </div>
        <a
          href={`https://www.chess.com/member/${profile.chessComHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-cb-text-faint hover:text-cb-text-secondary transition-colors duration-200"
        >
          <span
            style={{ fontFamily: "'Geist Mono', monospace" }}
            className="text-xs"
          >
            {profile.chessComHandle}
          </span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Ratings grid */}
      <div className="px-6 sm:px-8 pb-6 sm:pb-8">
        <div className="grid grid-cols-2 gap-px bg-cb-hover">
          {RATING_CATEGORIES.map(({ key, label }) => {
            const rating = profile[`${key}Rating` as keyof ProfileChessComProfile] as number | null;
            const bestRating = profile[`${key}BestRating` as keyof ProfileChessComProfile] as number | null;

            return (
              <div key={key} className="bg-cb-bg p-4 sm:p-5">
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-faint text-[10px] tracking-[0.15em] uppercase mb-2"
                >
                  {label}
                </p>
                <p
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                  className="text-cb-text text-xl sm:text-2xl font-medium"
                >
                  {rating ?? "--"}
                </p>
                {bestRating && (
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-faint text-xs mt-1"
                  >
                    Best: {bestRating}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Last synced */}
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-faint text-[10px] tracking-wide mt-4 text-right"
        >
          Synced {formatSyncDate(profile.lastSyncedAt)}
        </p>
      </div>
    </motion.div>
  );
}
