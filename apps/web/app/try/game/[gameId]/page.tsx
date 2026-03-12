"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { GamePageContent } from "@/app/game/[gameId]/GamePageContent";

export default function DemoGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const router = useRouter();
  const [demoUserRef, setDemoUserRef] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("demoUserReferenceId");
    if (stored) {
      setDemoUserRef(stored);
    } else {
      // No demo user ref — redirect back to try page
      router.replace("/try");
    }
  }, [router]);

  if (!demoUserRef) {
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

  return <GamePageContent userReferenceId={demoUserRef} gameId={gameId} isDemo />;
}
