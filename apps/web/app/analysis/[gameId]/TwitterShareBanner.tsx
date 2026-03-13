"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface TwitterShareBannerProps {
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  openingName: string | null;
  isDemo: boolean;
}

function buildTweetText(
  whitePlayerName: string | null,
  blackPlayerName: string | null,
  tournamentName: string | null,
  openingName: string | null
): string {
  if (whitePlayerName && blackPlayerName && tournamentName) {
    return `Just relived ${whitePlayerName} vs ${blackPlayerName} (${tournamentName}) on ReplayChess — such a brilliant game!\n\nTry it yourself:`;
  }
  if (openingName) {
    return `Just played the ${openingName} on ReplayChess — what a fun way to learn openings!\n\nTry it yourself:`;
  }
  return `Having a blast on ReplayChess — replaying legendary chess games is incredibly fun!\n\nTry it yourself:`;
}

const SITE_URL = "https://www.playchess.tech";

export function TwitterShareBanner({
  whitePlayerName,
  blackPlayerName,
  tournamentName,
  openingName,
  isDemo,
}: TwitterShareBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDemo) return;

    try {
      const prompted = localStorage.getItem("twitter_share_prompted");
      if (prompted === "true") return;

      const gamesCompleted = parseInt(localStorage.getItem("games_completed") || "0", 10);
      if (gamesCompleted < 5) return;

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
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text + "\n" + SITE_URL)}`;
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

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className={cn(
            "fixed bottom-0 left-0 right-0 z-40",
            "bg-neutral-950 border-t border-white/10",
            "px-4 py-3 sm:px-6 sm:py-4"
          )}
        >
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/70 text-sm"
            >
              Enjoying ReplayChess? Share your experience!
            </p>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleShare}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md",
                  "bg-white text-black hover:bg-white/90",
                  "transition-colors duration-200"
                )}
              >
                Share on X
              </button>
              <button
                onClick={handleMaybeLater}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md",
                  "text-white/50 hover:text-white/80",
                  "transition-colors duration-200"
                )}
              >
                Maybe Later
              </button>
              <button
                onClick={handleDismiss}
                className={cn(
                  "p-2 text-white/30 hover:text-white/60",
                  "transition-colors duration-200"
                )}
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
