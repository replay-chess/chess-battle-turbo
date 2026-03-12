"use client";

import { useState, useEffect, use } from "react";
import { AnalysisPageContent } from "@/app/analysis/[gameId]/AnalysisPageContent";

export default function DemoAnalysisPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const [demoUserRef, setDemoUserRef] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("demoUserReferenceId");
    if (stored) {
      setDemoUserRef(stored);
    }
  }, []);

  return (
    <AnalysisPageContent
      gameId={gameId}
      userReferenceId={demoUserRef || undefined}
      isDemo
    />
  );
}
