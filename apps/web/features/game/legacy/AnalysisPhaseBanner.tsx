import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface AnalysisPhaseBannerProps {
  isAnalysisPhase: boolean;
  analysisTimeRemaining: number;
  totalAnalysisTime: number;
  currentTurn: "w" | "b";
  myColor: "w" | "b" | null;
}

export function AnalysisPhaseBannerMobile({
  isAnalysisPhase,
  analysisTimeRemaining,
  currentTurn,
  myColor,
}: AnalysisPhaseBannerProps) {
  return (
    <AnimatePresence>
      {isAnalysisPhase && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-2 left-2 right-2 z-50 pointer-events-none lg:hidden"
        >
          <div className="mx-auto max-w-md">
            <div className="bg-cb-backdrop backdrop-blur-md border border-cb-border px-3 py-2 shadow-2xl">
              <div className="flex items-center justify-center gap-3">
                <motion.div
                  key={analysisTimeRemaining}
                  initial={{ scale: 1.1, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", damping: 15 }}
                  className="relative"
                >
                  <div className="absolute inset-0 blur-lg bg-amber-500/30 rounded-full" />
                  <span
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="relative text-3xl font-normal text-amber-200/90 tabular-nums"
                  >
                    {analysisTimeRemaining}
                  </span>
                </motion.div>

                <div className="w-px h-8 bg-cb-border-strong" />

                <div className="text-left">
                  <p
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="text-cb-text text-sm tracking-wide"
                  >
                    Analysis Time
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={cn(
                      "w-2.5 h-2.5",
                      currentTurn === "w" ? "bg-white" : "bg-black border border-cb-text-secondary"
                    )} />
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-[8px] uppercase tracking-[0.15em]"
                    >
                      {currentTurn === "w" ? "White" : "Black"} to move
                    </p>
                  </div>
                  {myColor && (
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-[8px] tracking-[0.1em] mt-0.5"
                    >
                      {myColor === currentTurn ? "You move first" : "Opponent moves first"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AnalysisPhaseBannerDesktop({
  isAnalysisPhase,
  analysisTimeRemaining,
  totalAnalysisTime,
  currentTurn,
  myColor,
}: AnalysisPhaseBannerProps) {
  return (
    <AnimatePresence>
      {isAnalysisPhase && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
          className="border border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-transparent p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.3em] uppercase text-amber-400/60"
            >
              Analysis Phase
            </p>
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "w-2.5 h-2.5",
                currentTurn === "w" ? "bg-white" : "bg-black border border-cb-text-muted"
              )} />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[9px] uppercase tracking-wider"
              >
                {currentTurn === "w" ? "White" : "Black"}&apos;s Move
              </span>
            </div>
          </div>

          <div className="flex items-center justify-center py-4">
            <motion.div
              key={analysisTimeRemaining}
              initial={{ scale: 1.05, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 20 }}
              className="relative"
            >
              <div className="absolute inset-0 blur-2xl bg-amber-500/20 rounded-full scale-150" />
              <span
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="relative text-6xl font-normal text-amber-200 tabular-nums"
              >
                {analysisTimeRemaining}
              </span>
            </motion.div>
          </div>

          <div className="mt-4">
            <div className="h-1 bg-cb-hover overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-500/60 to-amber-400/40"
                initial={{ width: "100%" }}
                animate={{
                  width: totalAnalysisTime > 0
                    ? `${(analysisTimeRemaining / totalAnalysisTime) * 100}%`
                    : "0%"
                }}
                transition={{ duration: 0.3, ease: "linear" }}
              />
            </div>
          </div>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-[10px] text-center mt-3 tracking-wide"
          >
            Study the position before playing
          </p>
          {myColor && (
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-secondary text-[10px] text-center mt-1.5 tracking-wide"
            >
              {myColor === currentTurn ? "You move first" : "Opponent moves first"}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
