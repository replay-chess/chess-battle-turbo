"use client";

import { use } from "react";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks";
import { AnalysisPageContent } from "./AnalysisPageContent";

const AnalysisPage = ({ params }: { params: Promise<{ gameId: string }> }) => {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const { gameId } = use(params);

  if (!isReady) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border border-white/20 border-t-white/60 rounded-full animate-spin mb-6" />
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/40 text-xs tracking-[0.2em] uppercase"
          >
            Loading Analysis
          </p>
        </div>
      </div>
    );
  }

  return <AnalysisPageContent gameId={gameId} userReferenceId={userReferenceId} />;
};

export default AnalysisPage;
