"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, ArrowRight, Share2, MessageCircle, Send, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface ShareLinkModalProps {
  isOpen: boolean;
  inviteLink: string;
  onGoToGame: () => void;
  onCancel: () => Promise<void>;
}

const modalEasing = [0.22, 1, 0.36, 1] as const;

function hasNativeShare(): boolean {
  return typeof navigator !== "undefined" && !!navigator.share;
}

export function ShareLinkModal({ isOpen, inviteLink, onGoToGame, onCancel }: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Auto-copy on mount (fire-and-forget for headless Chrome)
  useEffect(() => {
    if (isOpen && inviteLink) {
      navigator.clipboard.writeText(inviteLink).catch(() => {});
    }
  }, [isOpen, inviteLink]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      setCancelling(false);
    }
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      // Textarea fallback
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

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: "Chess Battle Challenge",
        text: "I challenge you to a chess battle!",
        url: inviteLink,
      });
    } catch {
      // User cancelled or share failed — ignore
    }
  };

  const shareText = encodeURIComponent("I challenge you to a chess battle! " + inviteLink);
  const shareUrl = encodeURIComponent(inviteLink);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={async () => {
            if (cancelling) return;
            setCancelling(true);
            await onCancel();
          }}
        >
          <motion.div
            className="bg-neutral-900 border border-white/10 p-6 w-[90%] max-w-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.5, ease: modalEasing }}
          >
            {/* Divider label + close button */}
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
                  Share Invitation
                </span>
                <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
              </div>
              <button
                onClick={async () => {
                  if (cancelling) return;
                  setCancelling(true);
                  await onCancel();
                }}
                className="ml-3 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>

            {/* Heading */}
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
                with your friend
              </h2>
            </motion.div>

            {/* Subtitle */}
            <motion.p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm mb-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, ease: modalEasing }}
            >
              They&apos;ll need it to join
            </motion.p>

            {/* Link box with corner ornaments */}
            <motion.div
              className="bg-white/5 border border-white/10 p-4 relative mb-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, ease: modalEasing }}
            >
              {/* Corner ornaments */}
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

            {/* Copy button */}
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

            {/* Share buttons row */}
            <motion.div
              className="flex gap-2 mb-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, ease: modalEasing }}
            >
              {hasNativeShare() && (
                <button
                  onClick={handleNativeShare}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white h-10 flex items-center justify-center gap-2 transition-all duration-200"
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="text-xs tracking-[0.1em] font-semibold">SHARE</span>
                </button>
              )}
              <a
                href={`https://wa.me/?text=${shareText}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white h-10 flex items-center justify-center gap-2 transition-all duration-200"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs tracking-[0.1em] font-semibold"
                >
                  WHATSAPP
                </span>
              </a>
              <a
                href={`https://t.me/share/url?url=${shareUrl}&text=${encodeURIComponent("I challenge you to a chess battle!")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white h-10 flex items-center justify-center gap-2 transition-all duration-200"
              >
                <Send className="w-3.5 h-3.5" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs tracking-[0.1em] font-semibold"
                >
                  TELEGRAM
                </span>
              </a>
            </motion.div>

            {/* QR Code */}
            <motion.div
              className="flex justify-center mb-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, ease: modalEasing }}
            >
              <div className="bg-white p-3 rounded-sm">
                <QRCodeSVG value={inviteLink} size={120} level="M" />
              </div>
            </motion.div>

            {/* Go to Game button */}
            <motion.button
              data-testid="go-to-game-button"
              onClick={cancelling ? undefined : onGoToGame}
              disabled={cancelling}
              className="w-full group relative overflow-hidden bg-white text-black h-10 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, ease: modalEasing }}
            >
              <div className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
              <div className="relative z-10 flex items-center justify-center gap-2">
                <AnimatePresence mode="wait">
                  {cancelling ? (
                    <motion.div
                      key="cancelling"
                      className="flex items-center gap-2"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <motion.div
                        className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs tracking-[0.1em] font-semibold"
                      >
                        CANCELLING
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="go-to-game"
                      className="flex items-center gap-2"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs tracking-[0.1em] font-semibold group-hover:text-white transition-colors"
                      >
                        GO TO GAME
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:text-white group-hover:translate-x-1 transition-all" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
