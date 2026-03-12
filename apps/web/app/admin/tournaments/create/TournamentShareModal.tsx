"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, ArrowRight, X } from "lucide-react";

interface TournamentShareModalProps {
  isOpen: boolean;
  referenceId: string;
  onGoToTournament: () => void;
}

const modalEasing = [0.22, 1, 0.36, 1] as const;

export function TournamentShareModal({ isOpen, referenceId, onGoToTournament }: TournamentShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState("");

  useEffect(() => {
    if (isOpen && referenceId) {
      const link = `${window.location.origin}/join-tournament/${referenceId}`;
      setInviteLink(link);
      navigator.clipboard.writeText(link).catch(() => {});
    }
  }, [isOpen, referenceId]);

  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = inviteLink;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="bg-neutral-900 border border-white/10 p-6 w-[90%] max-w-sm"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.5, ease: modalEasing }}
          >
            <motion.div
              className="flex items-center justify-between mb-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
                >
                  Tournament Created
                </span>
                <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
              </div>
              <button
                onClick={onGoToTournament}
                className="ml-3 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>

            <motion.div
              className="mb-1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, ease: modalEasing }}
            >
              <h2
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-xl text-white"
              >
                Share this link
                <br />
                to invite players
              </h2>
            </motion.div>

            <motion.p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm mb-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, ease: modalEasing }}
            >
              Players can join from this link
            </motion.p>

            <motion.div
              className="bg-white/5 border border-white/10 p-4 relative mb-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, ease: modalEasing }}
            >
              <div className="absolute top-0 left-0 w-1.5 h-1.5 border-l border-t border-white/30" />
              <div className="absolute top-0 right-0 w-1.5 h-1.5 border-r border-t border-white/30" />
              <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-l border-b border-white/30" />
              <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-r border-b border-white/30" />
              <p
                style={{ fontFamily: "'Geist Mono', monospace" }}
                className="text-white/60 text-sm truncate"
              >
                {inviteLink}
              </p>
            </motion.div>

            <motion.button
              onClick={handleCopy}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white h-10 flex items-center justify-center gap-2 transition-all duration-200 mb-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, ease: modalEasing }}
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.div
                    key="check"
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs tracking-[0.1em] font-semibold"
                    >
                      COPIED
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs tracking-[0.1em] font-semibold"
                    >
                      COPY LINK
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>

            <motion.button
              onClick={onGoToTournament}
              className="w-full group relative overflow-hidden bg-white text-black h-10 transition-all duration-300"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, ease: modalEasing }}
            >
              <div className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
              <div className="relative z-10 flex items-center justify-center gap-2">
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs tracking-[0.1em] font-semibold group-hover:text-white transition-colors"
                >
                  GO TO TOURNAMENT
                </span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:text-white group-hover:translate-x-1 transition-all" />
              </div>
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
