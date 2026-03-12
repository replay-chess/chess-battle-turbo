"use client";

import React, { useState, useEffect, Suspense } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { trackApiResponseTime } from "@/lib/metrics";
import ChessBoard from "../components/ChessBoard";
import TimeControlSelector, { TimeControlValue } from "../components/TimeControlSelector";
import SearchableDropdown from "../components/SearchableDropdown";
import { toast } from "sonner";
import { useRequireAuth, UseRequireAuthReturn } from "@/lib/hooks/useRequireAuth";
import { useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "@/app/components/Navbar";
import { Users, Zap, Crown, Bot, ArrowRight, Sparkles, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ShareLinkModal } from "./ShareLinkModal";
import { useDataStore } from "@/lib/stores";

// Static game mode definitions — never change at runtime
const gameModes = [
  {
    id: "quick" as const,
    title: "Quick Match",
    subtitle: "Find an opponent instantly",
    icon: Zap,
  },
  {
    id: "friend" as const,
    title: "Challenge Friend",
    subtitle: "Share a private invitation",
    icon: Users,
  },
  {
    id: "ai" as const,
    title: "Play the Machine",
    subtitle: "Test your skills against AI",
    icon: Bot,
  },
];

// Static gradient styles for background decorations
const diagonalGradientStyle = {
  background: `linear-gradient(135deg,
    rgba(255,255,255,0.03) 0%,
    transparent 40%,
    transparent 60%,
    rgba(255,255,255,0.02) 100%
  )`,
} as const;

const noiseTextureStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
} as const;

function PlayContent() {
  const { isReady, userObject }: UseRequireAuthReturn = useRequireAuth();
  const userReferenceId = userObject?.user?.referenceId;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [timeControl, setTimeControl] = useState<TimeControlValue>({
    mode: "Blitz",
    control: "5 | 5",
    time: 300,
    increment: 5,
  });
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"quick" | "friend" | "ai">("ai");
  const [playAsLegend, setPlayAsLegend] = useState(false);
  const [selectedHero, setSelectedHero] = useState<string | null>(null);
  const [hoveredMode, setHoveredMode] = useState<string | null>(null);
  const [shareLinkModalOpen, setShareLinkModalOpen] = useState(false);
  const [createdGameRef, setCreatedGameRef] = useState<string | null>(null);

  // Opening state
  const [playOpening, setPlayOpening] = useState(false);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);

  // Read legends & openings from Zustand data store (cached with 24h TTL)
  const legends = useDataStore((s) => s.legends);
  const legendsLoading = useDataStore((s) => s.legendsLoading);
  const openings = useDataStore((s) => s.openings);
  const openingsLoading = useDataStore((s) => s.openingsLoading);
  const fetchLegends = useDataStore((s) => s.fetchLegends);
  const fetchOpenings = useDataStore((s) => s.fetchOpenings);

  useEffect(() => {
    fetchLegends();
    fetchOpenings();
  }, [fetchLegends, fetchOpenings]);

  // Pre-select legend from URL param (e.g. /play?legend=abc123)
  const legendParam = searchParams.get("legend");
  useEffect(() => {
    if (legendParam) {
      setPlayAsLegend(true);
      setSelectedHero(legendParam);
    }
  }, [legendParam]);

  // Pre-select opening from URL param (e.g. /play?opening=abc123)
  const openingParam = searchParams.get("opening");
  useEffect(() => {
    if (openingParam) {
      setPlayOpening(true);
      setSelectedOpening(openingParam);
    }
  }, [openingParam]);

  const inviteLink = createdGameRef
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${createdGameRef}?autojoin=true`
    : "";

  const handleGoToGame = () => {
    if (createdGameRef) router.push(`/game/${createdGameRef}`);
  };

  const handleCreateGame = async () => {
    // TODO:  This error should ideally not Happen, because we dont load the page untill the auth state is ready, but just in case
    // if (!userReferenceId) {
    //   alert("User not authenticated. Please sign in.");
    //   return;
    // }

    setIsCreatingGame(true);

    if (selectedMode === "quick") {
      const params = new URLSearchParams({
        time: timeControl.time.toString(),
        increment: timeControl.increment.toString(),
      });
      if (playAsLegend && selectedHero) {
        params.set("legend", selectedHero);
        const selectedLegendData = legends.find(l => l.id === selectedHero);
        if (selectedLegendData) {
          params.set("legendName", selectedLegendData.name);
        }
      }
      if (playOpening && selectedOpening) {
        params.set("opening", selectedOpening);
      }
      router.push(`/queue?${params.toString()}`);
    } else if (selectedMode === "ai") {
      const aiGameData = {
        userReferenceId: userReferenceId,
        initialTimeSeconds: timeControl.time,
        incrementSeconds: timeControl.increment,
        ...(playAsLegend && selectedHero && { selectedLegend: selectedHero }),
        ...(playOpening && selectedOpening && { selectedOpening: selectedOpening }),
      };

      try {
        const start = Date.now();
        const response = await fetch("/api/chess/create-ai-game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(aiGameData),
        });

        const data = await response.json();
        trackApiResponseTime("chess.createAiGame", Date.now() - start);

        if (!data.success) {
          throw new Error(data.error || "Failed to create AI game");
        }

        router.push(`/game/${data.data.game.referenceId}`);
      } catch (error) {
        logger.error("Error creating AI game", error);
        toast.error(error instanceof Error ? error.message : "Failed to create AI game");
        setIsCreatingGame(false);
      }
    }
    else {
      const gameData = {
        userReferenceId: userReferenceId,
        initialTimeSeconds: timeControl.time,
        incrementSeconds: timeControl.increment,
        gameMode: selectedMode,
        playAsLegend: playAsLegend,
        selectedLegend: playAsLegend ? selectedHero : null,
        selectedOpening: playOpening ? selectedOpening : null,
      };

      try {
        const start = Date.now();
        const response = await fetch("/api/chess/create-game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(gameData),
        });

        const data = await response.json();
        trackApiResponseTime("chess.createGame", Date.now() - start);

        if (!data.success) {
          throw new Error(data.error || "Failed to create game");
        }

        const gameRef = data.data.game.referenceId;
        setCreatedGameRef(gameRef);
        setShareLinkModalOpen(true);
        setIsCreatingGame(false);
      } catch (error) {
        logger.error("Error creating game", error);
        setIsCreatingGame(false);
      }
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-screen bg-black items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-6"
        >
          {/* Chess piece loading animation */}
          <div className="relative w-16 h-16">
            <motion.div
              className="absolute inset-0 border-2 border-white/20 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-2 border-2 border-white/40 rounded-full"
              animate={{ rotate: -360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3 h-3 bg-white rounded-full" />
            </div>
          </div>
          <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-sm tracking-[0.2em] uppercase">
            Loading
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <Navbar />

      <div className="min-h-screen bg-black flex flex-col lg:flex-row pt-16 sm:pt-18 md:pt-24 relative overflow-hidden">
        {/* Dramatic diagonal gradient */}
        <div
          className="absolute inset-0 opacity-60"
          style={diagonalGradientStyle}
        />

        {/* Subtle noise texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={noiseTextureStyle}
        />

        {/* Left Side - Controls */}
        <div className="flex-1 flex items-center lg:items-start justify-center pt-4 sm:pt-2 lg:pt-6 px-6 sm:px-8 lg:px-12 pb-8 lg:pb-0 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-3 mb-4 lg:mb-6"
            >
              <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
              <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/50 text-[10px] tracking-[0.4em] uppercase">
                New Game
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
            </motion.div>

            {/* Game Mode Cards */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-1.5 mb-5 lg:mb-8"
            >
              {gameModes.map((mode, index) => {
                const Icon = mode.icon;
                const isSelected = selectedMode === mode.id;
                const isHovered = hoveredMode === mode.id;

                return (
                  <motion.button
                    key={mode.id}
                    data-testid={`mode-${mode.id}`}
                    initial={{ opacity: 0, y: -40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1, duration: 0.4 }}
                    onClick={() => setSelectedMode(mode.id)}
                    onMouseEnter={() => setHoveredMode(mode.id)}
                    onMouseLeave={() => setHoveredMode(null)}
                    className={cn(
                      "w-full group relative overflow-hidden transition-all duration-500",
                      "border rounded-none",
                      isSelected
                        ? "bg-white border-white"
                        : "bg-transparent border-white/10 hover:border-white/30"
                    )}
                  >
                    {/* Hover fill animation */}
                    <motion.div
                      className="absolute inset-0 bg-white origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: isHovered && !isSelected ? 1 : 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    />

                    <div className="relative p-4 lg:p-5 flex items-center gap-4">
                      {/* Icon */}
                      <div className={cn(
                        "w-9 h-9 lg:w-10 lg:h-10 flex items-center justify-center transition-colors duration-300",
                        "border",
                        isSelected
                          ? "border-black/20 bg-black/5"
                          : isHovered
                            ? "border-black/20 bg-black/5"
                            : "border-white/20"
                      )}>
                        <Icon className={cn(
                          "w-4 h-4 transition-colors duration-300",
                          isSelected || isHovered ? "text-black" : "text-white/70"
                        )} strokeWidth={1.5} />
                      </div>

                      {/* Text */}
                      <div className="flex-1 text-left">
                        <p style={{ fontFamily: "'Geist', sans-serif" }} className={cn(
                          "font-medium tracking-tight transition-colors duration-300",
                          isSelected || isHovered ? "text-black" : "text-white"
                        )}>
                          {mode.title}
                        </p>
                        <p style={{ fontFamily: "'Geist', sans-serif" }} className={cn(
                          "text-xs transition-colors duration-300",
                          isSelected || isHovered ? "text-black/50" : "text-white/40"
                        )}>
                          {mode.subtitle}
                        </p>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>

            {/* Legends Section */}
            {(legendsLoading || legends.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className={cn(
                  "mb-5 lg:mb-8 border overflow-hidden transition-all duration-500",
                  playAsLegend
                    ? "border-white bg-white/5"
                    : "border-white/10"
                )}
              >
                {/* Toggle */}
                <button
                  onClick={() => {
                    const newVal = !playAsLegend;
                    setPlayAsLegend(newVal);
                    if (!newVal) setSelectedHero(null);
                    if (newVal) {
                      // Mutually exclusive: turn off openings
                      setPlayOpening(false);
                      setSelectedOpening(null);
                    }
                  }}
                  className="w-full p-4 lg:p-5 flex items-center justify-between group"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-9 h-9 lg:w-10 lg:h-10 border flex items-center justify-center transition-all duration-300",
                      playAsLegend ? "border-white bg-white" : "border-white/20"
                    )}>
                      <Crown className={cn(
                        "w-4 h-4 transition-colors",
                        playAsLegend ? "text-black" : "text-white/60"
                      )} strokeWidth={1.5} />
                    </div>
                    <div className="text-left">
                      <p style={{ fontFamily: "'Geist', sans-serif" }} className={cn(
                        "font-medium tracking-tight transition-colors",
                        playAsLegend ? "text-white" : "text-white/80"
                      )}>
                        Play as Legend
                      </p>
                      <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-white/40 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        Master iconic positions
                      </p>
                    </div>
                  </div>

                  {/* Minimal toggle */}
                  <div className={cn(
                    "w-10 h-5 border relative overflow-hidden transition-colors duration-300 flex-shrink-0",
                    playAsLegend ? "border-white bg-white" : "border-white/30"
                  )}>
                    <motion.div
                      className={cn(
                        "absolute top-0 w-1/2 h-full transition-colors duration-300",
                        playAsLegend ? "bg-black" : "bg-white/50"
                      )}
                      animate={{ left: playAsLegend ? "50%" : "0%" }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </div>
                </button>

                {/* Expandable legends — now using SearchableDropdown */}
                <AnimatePresence>
                  {playAsLegend && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="px-5 pb-5 pt-4 border-t border-white/10">
                        <SearchableDropdown
                          items={legends}
                          selectedId={selectedHero}
                          onSelect={setSelectedHero}
                          getLabel={(l) => l.name}
                          getSubLabel={(l) => l.era}
                          getId={(l) => l.id}
                          placeholder="Search legends..."
                          isLoading={legendsLoading}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Play Opening Section */}
            {(openingsLoading || openings.length > 0) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 }}
                className={cn(
                  "mb-5 lg:mb-8 border overflow-hidden transition-all duration-500",
                  playOpening
                    ? "border-white bg-white/5"
                    : "border-white/10"
                )}
              >
                {/* Toggle */}
                <button
                  onClick={() => {
                    const newVal = !playOpening;
                    setPlayOpening(newVal);
                    if (!newVal) setSelectedOpening(null);
                    if (newVal) {
                      // Mutually exclusive: turn off legends
                      setPlayAsLegend(false);
                      setSelectedHero(null);
                    }
                  }}
                  className="w-full p-4 lg:p-5 flex items-center justify-between group"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-9 h-9 lg:w-10 lg:h-10 border flex items-center justify-center transition-all duration-300",
                      playOpening ? "border-white bg-white" : "border-white/20"
                    )}>
                      <BookOpen className={cn(
                        "w-4 h-4 transition-colors",
                        playOpening ? "text-black" : "text-white/60"
                      )} strokeWidth={1.5} />
                    </div>
                    <div className="text-left">
                      <p style={{ fontFamily: "'Geist', sans-serif" }} className={cn(
                        "font-medium tracking-tight transition-colors",
                        playOpening ? "text-white" : "text-white/80"
                      )}>
                        Play Opening
                      </p>
                      <p style={{ fontFamily: "'Geist', sans-serif" }} className="text-xs text-white/40 flex items-center gap-1.5">
                        <BookOpen className="w-3 h-3" />
                        Start from a known opening
                      </p>
                    </div>
                  </div>

                  {/* Minimal toggle */}
                  <div className={cn(
                    "w-10 h-5 border relative overflow-hidden transition-colors duration-300 flex-shrink-0",
                    playOpening ? "border-white bg-white" : "border-white/30"
                  )}>
                    <motion.div
                      className={cn(
                        "absolute top-0 w-1/2 h-full transition-colors duration-300",
                        playOpening ? "bg-black" : "bg-white/50"
                      )}
                      animate={{ left: playOpening ? "50%" : "0%" }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </div>
                </button>

                {/* Expandable openings */}
                <AnimatePresence>
                  {playOpening && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="px-5 pb-5 pt-4 border-t border-white/10">
                        <SearchableDropdown
                          items={openings}
                          selectedId={selectedOpening}
                          onSelect={setSelectedOpening}
                          getLabel={(o) => o.name}
                          getSubLabel={(o) => o.eco}
                          getId={(o) => o.id}
                          placeholder="Search openings..."
                          isLoading={openingsLoading}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Time Control */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              className="mb-5 lg:mb-8"
            >
              <div className="flex items-center gap-3 mb-2 lg:mb-3">
                <span style={{ fontFamily: "'Geist', sans-serif" }} className="text-white/40 text-[10px] tracking-[0.3em] uppercase">
                  Time Control
                </span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <TimeControlSelector value={timeControl} onChange={setTimeControl} />
            </motion.div>

            {/* Start Button */}
            <motion.button
              data-testid="start-game-button"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 }}
              onClick={handleCreateGame}
              disabled={isCreatingGame}
              className={cn(
                "w-full group relative overflow-hidden transition-all duration-300",
                "bg-white text-black",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {/* Invert animation on hover - uses CSS for reliable hover */}
              <div
                className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out"
              />

              <div className="relative z-10 py-4 px-6 flex items-center justify-center gap-3">
                {isCreatingGame ? (
                  <>
                    <motion.div
                      className="w-4 h-4 border-2 border-black/30 border-t-black group-hover:border-white/30 group-hover:border-t-white"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="font-semibold text-sm tracking-wide group-hover:text-white transition-colors">
                      {selectedMode === "quick" ? "FINDING OPPONENT" : "CREATING GAME"}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: "'Geist', sans-serif" }} className="font-semibold text-sm tracking-[0.1em] group-hover:text-white transition-colors">
                      {selectedMode === "quick" ? "FIND MATCH" : "START GAME"}
                    </span>
                    <ArrowRight className="w-4 h-4 group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </>
                )}
              </div>
            </motion.button>
          </motion.div>
        </div>

        {/* Right Side - Chess Board */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-8 relative">
          {/* Subtle light source effect */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/[0.02] rounded-full blur-3xl" />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.6, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-xl relative"
          >
            {/* Chess board - m-8 accounts for the -inset-8 outer frame */}
            <div className="m-8">
              <ChessBoard isInteractive={false} showCoordinates={true} />
            </div>
          </motion.div>
        </div>

        {/* Decorative corner elements */}
        <div className="absolute top-20 left-6 w-16 h-16 border-l border-t border-white/10" />
        <div className="absolute bottom-6 right-6 w-16 h-16 border-r border-b border-white/10" />
      </div>

      <ShareLinkModal
        isOpen={shareLinkModalOpen}
        inviteLink={inviteLink}
        onGoToGame={handleGoToGame}
        onCancel={async () => {
          await fetch("/api/chess/cancel-game", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gameReferenceId: createdGameRef,
              userReferenceId,
            }),
          });
          setShareLinkModalOpen(false);
          setCreatedGameRef(null);
        }}
      />
    </>
  );
}

export default function Play() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen bg-black items-center justify-center">
          <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <PlayContent />
    </Suspense>
  );
}
