"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, X, Link, Swords, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface AnalysisShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameReferenceId: string;
  chessPositionReferenceId: string | null;
  openingReferenceId: string | null;
  userReferenceId: string;
}

const modalEasing = [0.22, 1, 0.36, 1] as const;

const TIME_PRESETS = [
  { label: "3+2", initialTime: 180, increment: 2 },
  { label: "5+3", initialTime: 300, increment: 3 },
  { label: "10+0", initialTime: 600, increment: 0 },
  { label: "15+10", initialTime: 900, increment: 10 },
] as const;

function CopyButton({
  text,
  copied,
  onCopy,
}: {
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      onClick={onCopy}
      className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/70 hover:text-white h-9 flex items-center justify-center gap-2 transition-all duration-200"
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
    </button>
  );
}

function LinkBox({ url }: { url: string }) {
  return (
    <div className="bg-white/5 border border-white/10 p-3 relative mb-3">
      <div className="absolute top-0 left-0 w-1.5 h-1.5 border-l border-t border-white/30" />
      <div className="absolute top-0 right-0 w-1.5 h-1.5 border-r border-t border-white/30" />
      <div className="absolute bottom-0 left-0 w-1.5 h-1.5 border-l border-b border-white/30" />
      <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-r border-b border-white/30" />
      <p
        style={{ fontFamily: "'Geist Mono', monospace" }}
        className="text-white/60 text-xs truncate"
      >
        {url}
      </p>
    </div>
  );
}

export function AnalysisShareModal({
  isOpen,
  onClose,
  gameReferenceId,
  chessPositionReferenceId,
  openingReferenceId,
  userReferenceId,
}: AnalysisShareModalProps) {
  const [gameLinkCopied, setGameLinkCopied] = useState(false);
  const [positionLinkCopied, setPositionLinkCopied] = useState(false);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [selectedTimePreset, setSelectedTimePreset] = useState(1); // default 5+3
  const [creatingGame, setCreatingGame] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const gameLink = `${origin}/analysis/${gameReferenceId}`;

  const hasPosition = !!(chessPositionReferenceId || openingReferenceId);
  const positionLink = chessPositionReferenceId
    ? `${origin}/position/${chessPositionReferenceId}`
    : openingReferenceId
      ? `${origin}/position/${openingReferenceId}?type=opening`
      : "";

  const handleCopy = async (
    text: string,
    setCopied: (v: boolean) => void
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
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

  const handleCreateGame = async () => {
    setCreatingGame(true);
    try {
      const preset = TIME_PRESETS[selectedTimePreset] ?? TIME_PRESETS[1];
      const body: Record<string, unknown> = {
        userReferenceId,
        initialTimeSeconds: preset.initialTime,
        incrementSeconds: preset.increment,
        gameMode: "friend",
        playAsLegend: false,
        selectedLegend: null,
      };

      if (chessPositionReferenceId) {
        body.chessPositionReferenceId = chessPositionReferenceId;
      } else if (openingReferenceId) {
        body.selectedOpening = openingReferenceId;
      }

      const response = await fetch("/api/chess/create-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create game");
      }

      const newInviteLink = `${origin}/join/${data.data.game.referenceId}?autojoin=true`;
      setInviteLink(newInviteLink);
      navigator.clipboard.writeText(newInviteLink).catch(() => {});
    } catch (err) {
      logger.error("Error creating game from analysis share:", err);
    } finally {
      setCreatingGame(false);
    }
  };

  const handleClose = () => {
    setInviteLink(null);
    setGameLinkCopied(false);
    setPositionLinkCopied(false);
    setInviteLinkCopied(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleClose}
        >
          <motion.div
            className="bg-neutral-900 border border-white/10 p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/15"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.5, ease: modalEasing }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3 flex-1">
                <div className="h-px flex-1 bg-gradient-to-r from-white/30 to-transparent" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
                >
                  Share
                </span>
                <div className="h-px flex-1 bg-gradient-to-l from-white/30 to-transparent" />
              </div>
              <button
                onClick={handleClose}
                className="ml-3 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Section 1: Share Game Analysis */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <Link className="w-3.5 h-3.5 text-white/40" />
                <h3
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-lg text-white"
                >
                  Share Game Analysis
                </h3>
              </div>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/40 text-xs mb-3"
              >
                Send this link so your friend can review what you played
              </p>
              <LinkBox url={gameLink} />
              <CopyButton
                text={gameLink}
                copied={gameLinkCopied}
                onCopy={() => handleCopy(gameLink, setGameLinkCopied)}
              />
            </div>

            {/* Section 2: Share Position */}
            {hasPosition && (
              <>
                <div className="h-px bg-white/10 mb-6" />
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Swords className="w-3.5 h-3.5 text-white/40" strokeWidth={1.5} />
                    <h3
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-lg text-white"
                    >
                      Share Position
                    </h3>
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-white/40 text-xs mb-3"
                  >
                    Send this position so they can try playing it too
                  </p>
                  <LinkBox url={positionLink} />
                  <CopyButton
                    text={positionLink}
                    copied={positionLinkCopied}
                    onCopy={() => handleCopy(positionLink, setPositionLinkCopied)}
                  />
                </div>
              </>
            )}

            {/* Section 3: Play with a Friend */}
            {hasPosition && (
              <>
                <div className="h-px bg-white/10 mb-6" />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-white/40" strokeWidth={1.5} />
                    <h3
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-lg text-white"
                    >
                      Play with a Friend
                    </h3>
                  </div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-white/40 text-xs mb-4"
                  >
                    Start a game from this position with a friend
                  </p>

                  {!inviteLink ? (
                    <>
                      {/* Time control selector */}
                      <div className="flex gap-2 mb-4">
                        {TIME_PRESETS.map((preset, i) => (
                          <button
                            key={preset.label}
                            onClick={() => setSelectedTimePreset(i)}
                            className={cn(
                              "flex-1 py-2 text-xs border transition-all duration-200",
                              selectedTimePreset === i
                                ? "border-white/40 text-white bg-white/10"
                                : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                            )}
                            style={{ fontFamily: "'Geist', sans-serif" }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Create game button */}
                      <button
                        onClick={handleCreateGame}
                        disabled={creatingGame}
                        className={cn(
                          "w-full group relative overflow-hidden bg-white text-black h-10 transition-all duration-300",
                          "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                      >
                        <div className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-out" />
                        <div className="relative z-10 flex items-center justify-center gap-2">
                          <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-xs tracking-[0.1em] font-semibold group-hover:text-white transition-colors"
                          >
                            {creatingGame ? "CREATING..." : "CREATE GAME"}
                          </span>
                        </div>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Invite link created */}
                      <LinkBox url={inviteLink} />
                      <CopyButton
                        text={inviteLink}
                        copied={inviteLinkCopied}
                        onCopy={() => handleCopy(inviteLink, setInviteLinkCopied)}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
