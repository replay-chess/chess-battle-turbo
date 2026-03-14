"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { X, Trophy } from "lucide-react";

interface TwitterShareBannerProps {
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  openingName: string | null;
  chessPositionReferenceId: string | null;
  openingReferenceId: string | null;
  isDemo: boolean;
}

function buildTweetText(
  whitePlayerName: string | null,
  blackPlayerName: string | null,
  tournamentName: string | null,
  openingName: string | null
): string {
  if (whitePlayerName && blackPlayerName && tournamentName) {
    return `Just relived ${whitePlayerName} vs ${blackPlayerName} (${tournamentName}) on @ReplayChess — such a brilliant game!`;
  }
  if (openingName) {
    return `Just played the ${openingName} on @ReplayChess — what a fun way to learn openings!`;
  }
  return `Having a blast on @ReplayChess — replaying legendary chess games is incredibly fun!`;
}

function buildSubtitle(
  whitePlayerName: string | null,
  blackPlayerName: string | null,
  tournamentName: string | null,
  openingName: string | null
): string {
  if (whitePlayerName && blackPlayerName) {
    const match = `${whitePlayerName} vs ${blackPlayerName}`;
    return tournamentName ? `${match} — ${tournamentName}` : match;
  }
  if (openingName) return openingName;
  return "another legendary game";
}

const SITE_URL = "playchess.tech";
const SHARE_THRESHOLD = parseInt(process.env.NEXT_PUBLIC_TWITTER_SHARE_GAME_THRESHOLD || "5", 10);
const modalEasing = [0.22, 1, 0.36, 1] as const;

export function TwitterShareBanner({
  whitePlayerName,
  blackPlayerName,
  tournamentName,
  openingName,
  chessPositionReferenceId,
  openingReferenceId,
  isDemo,
}: TwitterShareBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDemo) return;

    try {
      const prompted = localStorage.getItem("twitter_share_prompted");
      if (prompted === "true") return;

      const gamesCompleted = parseInt(localStorage.getItem("games_completed") || "0", 10);
      if (gamesCompleted < SHARE_THRESHOLD) return;

      const snoozedAt = localStorage.getItem("twitter_share_snoozed_at");
      if (snoozedAt) {
        const snoozedAtCount = parseInt(snoozedAt, 10);
        if (gamesCompleted < snoozedAtCount + 4) return;
      }

      setVisible(true);
    } catch {}
  }, [isDemo]);

  function handleShare() {
    const text = buildTweetText(whitePlayerName, blackPlayerName, tournamentName, openingName);
    let positionUrl: string;
    if (chessPositionReferenceId) {
      positionUrl = `${SITE_URL}/position/${chessPositionReferenceId}`;
    } else if (openingReferenceId) {
      positionUrl = `${SITE_URL}/position/${openingReferenceId}?type=opening`;
    } else {
      positionUrl = SITE_URL;
    }
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(positionUrl)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
    try {
      localStorage.setItem("twitter_share_prompted", "true");
    } catch {}
    setVisible(false);
  }

  function handleDismiss() {
    try {
      localStorage.setItem("twitter_share_prompted", "true");
    } catch {}
    setVisible(false);
  }

  function handleMaybeLater() {
    try {
      const gamesCompleted = localStorage.getItem("games_completed") || "0";
      localStorage.setItem("twitter_share_snoozed_at", gamesCompleted);
    } catch {}
    setVisible(false);
  }

  const subtitle = buildSubtitle(whitePlayerName, blackPlayerName, tournamentName, openingName);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-cb-backdrop backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleDismiss}
        >
          <motion.div
            className="bg-cb-surface border border-cb-border w-full max-w-sm relative overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.5, ease: modalEasing }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner accents */}
            <div className="absolute top-3 left-3 w-6 h-6 border-l border-t border-cb-border" />
            <div className="absolute top-3 right-3 w-6 h-6 border-r border-t border-cb-border" />
            <div className="absolute bottom-3 left-3 w-6 h-6 border-l border-b border-cb-border" />
            <div className="absolute bottom-3 right-3 w-6 h-6 border-r border-b border-cb-border" />

            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              className="absolute top-4 right-4 z-10 text-cb-text-muted hover:text-cb-text-secondary transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="px-8 pt-10 pb-8 text-center">
              {/* Trophy icon */}
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.2 }}
                className="mx-auto mb-5 w-14 h-14 flex items-center justify-center border border-cb-border bg-cb-hover"
              >
                <Trophy className="w-7 h-7 text-cb-text-secondary" strokeWidth={1.5} />
              </motion.div>

              {/* Heading */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
              >
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="h-px w-10 bg-gradient-to-r from-transparent to-cb-text-muted" />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
                  >
                    Milestone
                  </span>
                  <div className="h-px w-10 bg-gradient-to-l from-transparent to-cb-text-muted" />
                </div>

                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl sm:text-3xl text-cb-text mb-2"
                >
                  You&apos;re on a Roll!
                </h2>

                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-sm leading-relaxed mb-1"
                >
                  You just played through
                </p>
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-cb-text-secondary text-base italic mb-6"
                >
                  {subtitle}
                </p>

                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-secondary text-xs leading-relaxed"
                >
                  Spread the word and let your friends discover legendary chess games too.
                </p>
              </motion.div>

              {/* Actions */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.4 }}
                className="mt-7 flex flex-col gap-3"
              >
                {/* Share on X button */}
                <button
                  onClick={handleShare}
                  className={cn(
                    "w-full group relative overflow-hidden bg-cb-accent text-cb-accent-fg h-11 transition-all duration-300"
                  )}
                >
                  <div className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
                  <div className="relative z-10 flex items-center justify-center gap-2.5">
                    <svg
                      className="w-4 h-4 group-hover:text-cb-text transition-colors"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs tracking-[0.15em] font-semibold group-hover:text-cb-text transition-colors"
                    >
                      SHARE ON X
                    </span>
                  </div>
                </button>

                {/* Maybe Later */}
                <button
                  onClick={handleMaybeLater}
                  className={cn(
                    "w-full h-11 border border-cb-border hover:border-cb-border-strong",
                    "text-cb-text-muted hover:text-cb-text-secondary",
                    "transition-all duration-200"
                  )}
                >
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs tracking-[0.15em] font-semibold"
                  >
                    MAYBE LATER
                  </span>
                </button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
