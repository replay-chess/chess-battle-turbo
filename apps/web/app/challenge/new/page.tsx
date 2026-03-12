"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { ShareLinkModal } from "@/app/play/ShareLinkModal";
import { Navbar } from "@/app/components/Navbar";
import { motion } from "motion/react";
import { logger } from "@/lib/logger";

export default function ChallengeNewPage() {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();

  const [gameRef, setGameRef] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (!isReady || !userReferenceId || creating || created) return;

    setCreating(true);

    const urlParams = new URLSearchParams(window.location.search);
    const time = parseInt(urlParams.get("time") ?? "300", 10);
    const inc = parseInt(urlParams.get("inc") ?? "5", 10);
    const legend = urlParams.get("legend");

    fetch("/api/chess/create-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userReferenceId,
        initialTimeSeconds: time,
        incrementSeconds: inc,
        gameMode: "friend",
        playAsLegend: true,
        selectedLegend: legend,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || "Failed to create game");
        const ref = data.data.game.referenceId;
        setGameRef(ref);
        setInviteLink(`${window.location.origin}/join/${ref}?autojoin=true`);
        setCreated(true);
      })
      .catch((err) => {
        logger.error("Error creating challenge:", err);
        router.push("/play");
      })
      .finally(() => setCreating(false));
  }, [isReady, userReferenceId, creating, created, router]);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black flex items-center justify-center pt-16 md:pt-24">
        {!inviteLink ? (
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
        ) : null}
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
