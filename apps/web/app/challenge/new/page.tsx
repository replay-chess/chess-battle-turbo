"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { ShareLinkModal } from "@/app/play/ShareLinkModal";
import { Navbar } from "@/app/components/Navbar";
import { motion } from "motion/react";
import { logger } from "@/lib/logger";
import TimeControlSelector, { TimeControlValue } from "@/app/components/TimeControlSelector";
import { cn } from "@/lib/utils";

export default function ChallengeNewPage() {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();

  const [gameRef, setGameRef] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [timeControl, setTimeControl] = useState<TimeControlValue>({
    mode: "Blitz",
    control: "5 | 5",
    time: 300,
    increment: 5,
  });

  const handleCreateChallenge = async () => {
    if (!isReady || !userReferenceId || creating) return;
    setCreating(true);

    const legend = new URLSearchParams(window.location.search).get("legend");

    try {
      const response = await fetch("/api/chess/create-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userReferenceId,
          initialTimeSeconds: timeControl.time,
          incrementSeconds: timeControl.increment,
          gameMode: "friend",
          playAsLegend: true,
          selectedLegend: legend,
        }),
      });
      const data = await response.json();

      if (!data.success) throw new Error(data.error || "Failed to create game");

      const ref = data.data.game.referenceId;
      setGameRef(ref);
      setInviteLink(`${window.location.origin}/join/${ref}?autojoin=true`);
    } catch (err) {
      logger.error("Error creating challenge:", err);
      setCreating(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24">
        {!inviteLink && !creating && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-sm px-4"
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
              >
                Challenge a Friend
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
            </div>

            {/* Title */}
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-white mb-2 text-center"
            >
              Choose Time Control
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm mb-6 text-center"
            >
              Pick how long each player gets
            </p>

            {/* Time Control Selector */}
            <div className="mb-6">
              <TimeControlSelector value={timeControl} onChange={setTimeControl} />
            </div>

            {/* Create Button */}
            <button
              onClick={handleCreateChallenge}
              disabled={!isReady}
              className={cn(
                "w-full group relative overflow-hidden bg-white text-black h-12 transition-all duration-300",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="relative z-10 text-sm tracking-[0.1em] font-semibold group-hover:text-white transition-colors"
              >
                CREATE CHALLENGE
              </span>
            </button>
          </motion.div>
        )}

        {creating && !inviteLink && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm tracking-wide"
            >
              Creating challenge...
            </p>
          </motion.div>
        )}
      </div>

      <ShareLinkModal
        isOpen={!!inviteLink}
        inviteLink={inviteLink || ""}
        onGoToGame={() => {
          if (gameRef) router.push(`/game/${gameRef}`);
        }}
        onCancel={async () => {
          if (gameRef) {
            await fetch("/api/chess/cancel-game", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameReferenceId: gameRef,
                userReferenceId,
              }),
            });
          }
          router.push("/play");
        }}
      />
    </>
  );
}
