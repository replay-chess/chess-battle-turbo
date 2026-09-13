"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useUserStore } from "@/lib/stores";
import {
  currentAppPath,
  isEntitledClient,
  isSubscriptionRequiredResponse,
  paywallUrl,
} from "@/lib/billing/client";
import { ShareLinkModal } from "@/app/play/ShareLinkModal";
import { Users } from "lucide-react";
import { logger } from "@/lib/logger";

interface ChallengeLegendButtonProps {
  legendReferenceId: string;
  legendName: string;
}

export function ChallengeLegendButton({ legendReferenceId, legendName }: ChallengeLegendButtonProps) {
  // Legend pages are public and indexable, so this button must never redirect
  // on mount (useRequireAuth would). Anonymous visitors are sent to sign-in
  // only when they click; the paywall applies when they try to start a game.
  const { isLoaded, isSignedIn } = useUser();
  const storeUser = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);
  const role = useUserStore((s) => s.user?.role ?? null);
  const userReferenceId = storeUser?.referenceId;
  const router = useRouter();
  const pathname = usePathname();
  // Signed-out visitors can always click (they get sent to sign-in); signed-in
  // users wait until UserSync has populated the store.
  const isReady = isLoaded && (!isSignedIn || !!userReferenceId);

  const [creating, setCreating] = useState(false);
  const [gameRef, setGameRef] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const handleChallenge = async () => {
    if (!isReady || creating) return;
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!userReferenceId) return;
    if (subscription && !isEntitledClient(subscription, role)) {
      router.push(paywallUrl(currentAppPath()));
      return;
    }
    setCreating(true);

    try {
      const response = await fetch("/api/chess/create-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userReferenceId,
          initialTimeSeconds: 300,
          incrementSeconds: 5,
          gameMode: "friend",
          playAsLegend: true,
          selectedLegend: legendReferenceId,
        }),
      });
      if (await isSubscriptionRequiredResponse(response)) {
        router.push(paywallUrl(currentAppPath()));
        return;
      }

      const data = await response.json();

      if (!data.success) throw new Error(data.error || "Failed to create game");

      const ref = data.data.game.referenceId;
      setGameRef(ref);
      setInviteLink(`${window.location.origin}/join/${ref}?autojoin=true`);
    } catch (err) {
      logger.error("Error creating legend challenge:", err);
      setCreating(false);
    }
  };

  return (
    <>
      <button
        onClick={handleChallenge}
        disabled={creating || !isReady}
        className="group relative flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 overflow-hidden px-3 py-3 sm:px-8 border border-cb-border-strong hover:border-cb-border-strong text-cb-text-secondary hover:text-cb-text transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        <Users className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
        <span className="relative text-sm font-medium transition-colors duration-300">
          {creating ? "..." : <><span className="sm:hidden truncate">{legendName} vs Friend</span><span className="hidden sm:inline">Play {legendName} with a Friend</span></>}
        </span>
      </button>

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
          setInviteLink(null);
          setGameRef(null);
          setCreating(false);
        }}
      />
    </>
  );
}
