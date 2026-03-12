"use client";

import { use } from "react";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { GamePageContent } from "./GamePageContent";

const GamePage = ({ params }: { params: Promise<{ gameId: string }> }) => {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const { gameId } = use(params);

  if (!isReady || !userReferenceId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border border-white/20 border-t-white/60 rounded-full animate-spin mb-6" />
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-xs tracking-[0.2em] uppercase">
            Loading
          </p>
        </div>
      </div>
    );
  }

  return <GamePageContent userReferenceId={userReferenceId} gameId={gameId} />;
};

export default GamePage;
