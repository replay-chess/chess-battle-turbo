"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";

interface ConfettiPiece {
  id: number;
  x: number;
  delay: number;
  size: number;
  rotation: number;
  opacity: number;
  shape: "square" | "line" | "dot";
  peakY: number;
  sway: number;
}

interface VictoryConfettiProps {
  isActive: boolean;
}

const CONFETTI_COLORS = [
  "rgba(255, 215, 0, 0.9)",   // gold
  "rgba(255, 255, 255, 0.85)", // white
  "rgba(255, 180, 50, 0.8)",   // amber
  "rgba(200, 200, 200, 0.7)",  // silver
  "rgba(255, 240, 180, 0.8)",  // cream
];

export const VictoryConfetti = ({ isActive }: VictoryConfettiProps) => {
  const pieces = useMemo(() => {
    if (!isActive) return [];

    const newPieces: ConfettiPiece[] = [];
    const pieceCount = 50;
    const shapes: ("square" | "line" | "dot")[] = ["square", "line", "dot"];

    for (let i = 0; i < pieceCount; i++) {
      newPieces.push({
        id: i,
        x: 30 + Math.random() * 40, // cluster toward center (30–70vw)
        delay: Math.random() * 0.4,
        size: 4 + Math.random() * 8,
        rotation: Math.random() * 360,
        opacity: 0.4 + Math.random() * 0.5,
        shape: shapes[Math.floor(Math.random() * shapes.length)]!,
        peakY: -(window.innerHeight * (0.4 + Math.random() * 0.5)), // fly 40–90% of viewport height upward
        sway: (Math.random() - 0.5) * 120, // horizontal drift during fall
      });
    }

    return newPieces;
  }, [isActive]);

  if (!isActive || pieces.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map((piece) => {
        const color = CONFETTI_COLORS[piece.id % CONFETTI_COLORS.length]!;
        const totalDuration = 2.5 + Math.random() * 1;
        // Time split: ~30% going up, ~70% falling down
        const upRatio = 0.25 + Math.random() * 0.1;

        return (
          <motion.div
            key={piece.id}
            initial={{
              bottom: 0,
              left: `${piece.x}vw`,
              y: 0,
              x: 0,
              rotate: piece.rotation,
              opacity: 0,
            }}
            animate={{
              y: [0, piece.peakY, window.innerHeight * 0.2],
              x: [0, piece.sway * 0.3, piece.sway],
              rotate: piece.rotation + 360 + Math.random() * 180,
              opacity: [0, piece.opacity, piece.opacity, 0],
            }}
            transition={{
              duration: totalDuration,
              delay: piece.delay,
              y: {
                duration: totalDuration,
                times: [0, upRatio, 1],
                ease: ["easeOut", "easeIn"],
              },
              x: {
                duration: totalDuration,
                ease: "easeOut",
              },
              opacity: {
                duration: totalDuration,
                times: [0, 0.15, 0.7, 1],
              },
            }}
            className="absolute"
            style={{
              width: piece.shape === "line" ? 2 : piece.size,
              height: piece.shape === "dot" ? piece.size : piece.shape === "line" ? piece.size * 2 : piece.size,
              backgroundColor: piece.shape === "dot" ? "transparent" : color,
              borderRadius: piece.shape === "dot" ? "50%" : piece.shape === "line" ? 1 : 0,
              border: piece.shape === "dot" ? `1px solid ${color}` : "none",
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
};

interface DefeatOverlayProps {
  isActive: boolean;
}

export const DefeatOverlay = ({ isActive }: DefeatOverlayProps) => {
  return (
    <AnimatePresence>
      {isActive && (
        <>
          {/* Top-to-bottom decay sweep */}
          <motion.div
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-30 pointer-events-none origin-top"
            style={{
              background: `linear-gradient(
                to bottom,
                var(--cb-defeat-wash-start) 0%,
                var(--cb-defeat-wash-start) 30%,
                var(--cb-defeat-wash-end) 60%,
                var(--cb-defeat-wash-end) 100%
              )`,
            }}
          />

          {/* Grayscale/desaturation filter overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5, delay: 0.3 }}
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
              backdropFilter: "saturate(0.3) brightness(0.85)",
              WebkitBackdropFilter: "saturate(0.3) brightness(0.85)",
            }}
          />

          {/* Subtle scan lines for "skeleton" effect */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.08 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="absolute inset-0 z-40 pointer-events-none"
            style={{
              backgroundImage: `repeating-linear-gradient(
                0deg,
                transparent,
                transparent 2px,
                var(--cb-defeat-scanline) 2px,
                var(--cb-defeat-scanline) 4px
              )`,
            }}
          />

          {/* Vignette effect */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5, delay: 0.2 }}
            className="absolute inset-0 z-35 pointer-events-none"
            style={{
              background: `radial-gradient(
                ellipse at center,
                transparent 30%,
                var(--cb-defeat-vignette) 100%
              )`,
            }}
          />

          {/* Falling ash particles */}
          <AshParticles />
        </>
      )}
    </AnimatePresence>
  );
};

const AshParticles = () => {
  const particles = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 3,
      duration: 4 + Math.random() * 3,
      size: 2 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 30,
    }));
  }, []);

  return (
    <div className="absolute inset-0 z-45 pointer-events-none overflow-hidden">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          initial={{
            x: `${particle.x}%`,
            y: "-5%",
            opacity: 0,
          }}
          animate={{
            x: `${particle.x + particle.drift}%`,
            y: "105%",
            opacity: [0, 0.4, 0.3, 0],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            ease: "linear",
            repeat: Infinity,
          }}
          className="absolute rounded-full"
          style={{
            width: particle.size,
            height: particle.size,
            backgroundColor: "var(--cb-defeat-ash)",
            filter: "blur(0.5px)",
          }}
        />
      ))}
    </div>
  );
};

// Draw result indicator (for draw games)
interface DrawOverlayProps {
  isActive: boolean;
}

export const DrawOverlay = ({ isActive }: DrawOverlayProps) => {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            background: `linear-gradient(
              135deg,
              var(--cb-draw-gradient-edge) 0%,
              var(--cb-draw-gradient-mid) 50%,
              var(--cb-draw-gradient-edge) 100%
            )`,
          }}
        >
          {/* Balanced scale-like pattern */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-[1px] bg-cb-border-strong"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Result banner that appears centered on the chess board
interface GameResultBannerProps {
  gameEndState: "victory" | "defeat" | "draw" | "white_wins" | "black_wins" | null;
}

const BANNER_CONFIG = {
  victory: { text: "You Won!", color: "text-amber-200", bg: "var(--cb-result-victory-bg)" },
  defeat: { text: "You Lost", color: "text-cb-text-secondary", bg: "var(--cb-result-defeat-bg)" },
  draw: { text: "Draw", color: "text-cb-text", bg: "var(--cb-result-draw-bg)" },
  white_wins: { text: "White Wins", color: "text-amber-200", bg: "var(--cb-result-victory-bg)" },
  black_wins: { text: "Black Wins", color: "text-amber-200", bg: "var(--cb-result-victory-bg)" },
} as const;

export const GameResultBanner = ({ gameEndState }: GameResultBannerProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!gameEndState) {
      setVisible(false);
      return;
    }

    // Appear 1s after game ends
    const showTimer = setTimeout(() => setVisible(true), 1000);
    // Auto-dismiss after 4s total (1s delay + 3s display)
    const hideTimer = setTimeout(() => setVisible(false), 4000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [gameEndState]);

  const config = gameEndState ? BANNER_CONFIG[gameEndState] : null;

  return (
    <AnimatePresence>
      {visible && config && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: 0.9, ease: [0, 0, 0.2, 1] }}
          className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center"
        >
          <div
            className="px-8 py-4 backdrop-blur-sm"
            style={{ backgroundColor: config.bg }}
          >
            <h2
              className={`text-3xl sm:text-4xl md:text-5xl tracking-[0.2em] uppercase ${config.color}`}
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              {config.text}
            </h2>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Game End Overlay with Analysis Button (for analysis page)
interface GameEndOverlayProps {
  isActive: boolean;
  result: "victory" | "defeat" | "draw" | "white_wins" | "black_wins";
  onAnalysisClick: () => void;
  onBackClick?: () => void;
  onFindGameClick?: () => void;
  onDismiss: () => void;
  analysisLabel?: string;
}

export const GameEndOverlay = ({
  isActive,
  result,
  onAnalysisClick,
  onBackClick,
  onFindGameClick,
  onDismiss,
  analysisLabel = "Compare",
}: GameEndOverlayProps) => {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    if (isActive) {
      setShowButton(true);
    } else {
      setShowButton(false);
    }
  }, [isActive, result]);

  const getResultText = () => {
    switch (result) {
      case "victory":
        return "Victory";
      case "defeat":
        return "Defeat";
      case "draw":
        return "Draw";
      case "white_wins":
        return "White Wins";
      case "black_wins":
        return "Black Wins";
      default:
        return "Game Over";
    }
  };

  const getResultColor = () => {
    switch (result) {
      case "victory":
      case "white_wins":
      case "black_wins":
        return "text-cb-text";
      case "defeat":
        return "text-cb-text-secondary";
      case "draw":
        return "text-cb-text-secondary";
      default:
        return "text-cb-text";
    }
  };

  const handleDismiss = () => {
    setShowButton(false);
    onDismiss();
  };

  return (
    <AnimatePresence>
      {isActive && showButton && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-auto"
          style={{
            background: "var(--cb-overlay-scrim)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
          onClick={handleDismiss}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col items-center gap-6 p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Result text */}
            <div className="text-center">
              <h2
                className={`text-4xl md:text-5xl tracking-[0.15em] ${getResultColor()}`}
                style={{ fontFamily: "'Instrument Serif', serif" }}
              >
                {getResultText()}
              </h2>
            </div>

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={onAnalysisClick}
                  className="group relative px-8 py-3 bg-cb-accent text-cb-accent-fg hover:bg-cb-accent/90 transition-all duration-300"
                >
                  <span
                    className="text-sm uppercase tracking-[0.2em]"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {analysisLabel}
                  </span>
                </button>
                {onFindGameClick && (
                  <button
                    onClick={onFindGameClick}
                    className="group relative px-8 py-3 bg-cb-accent text-cb-accent-fg hover:bg-cb-accent/90 transition-all duration-300"
                  >
                    <span
                      className="text-sm uppercase tracking-[0.2em]"
                      style={{ fontFamily: "'Geist', sans-serif" }}
                    >
                      Find Game
                    </span>
                  </button>
                )}
              </div>
              <button
                onClick={onBackClick || onDismiss}
                className="group relative px-8 py-3 border border-cb-border-strong bg-cb-hover hover:bg-cb-surface-elevated hover:border-cb-border-strong transition-all duration-300"
              >
                <span
                  className="text-sm uppercase tracking-[0.2em] text-cb-text-secondary group-hover:text-cb-text"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  Back
                </span>
              </button>
            </motion.div>

            {/* Skip text */}
            <p
              className="text-cb-text-muted text-xs"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Click anywhere to dismiss
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
