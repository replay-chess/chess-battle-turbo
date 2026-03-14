"use client";

import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Color } from "chess.js";

type PromotionPiece = "q" | "r" | "b" | "n";

interface PromotionPopupProps {
  isOpen: boolean;
  color: Color;
  onSelect: (piece: PromotionPiece) => void;
}

const PROMOTION_PIECES: { piece: PromotionPiece; name: string }[] = [
  { piece: "q", name: "Queen" },
  { piece: "r", name: "Rook" },
  { piece: "b", name: "Bishop" },
  { piece: "n", name: "Knight" },
];

export const PromotionPopup = ({ isOpen, color, onSelect }: PromotionPopupProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - clicking does nothing (no cancel) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-cb-backdrop backdrop-blur-sm z-50"
          />

          {/* Popup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-cb-bg border border-cb-border p-6 pointer-events-auto">
              {/* Header */}
              <h2
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-cb-text text-xl text-center mb-4"
              >
                Promote Pawn
              </h2>

              {/* Piece options */}
              <div className="grid grid-cols-4 gap-3">
                {PROMOTION_PIECES.map(({ piece, name }) => (
                  <motion.button
                    key={piece}
                    onClick={() => onSelect(piece)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex flex-col items-center gap-2 p-3 border border-cb-border hover:border-cb-border-strong hover:bg-cb-hover transition-colors"
                  >
                    <div className="w-12 h-12 sm:w-16 sm:h-16">
                      <Image
                        src={`/chess-icons/${color}${piece}.png`}
                        alt={`${color === "w" ? "White" : "Black"} ${name}`}
                        width={64}
                        height={64}
                        className="w-full h-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                        draggable={false}
                      />
                    </div>
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-xs uppercase tracking-wider"
                    >
                      {name}
                    </span>
                  </motion.button>
                ))}
              </div>

              {/* Helper text */}
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-xs text-center mt-4"
              >
                Select a piece to promote your pawn
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PromotionPopup;
