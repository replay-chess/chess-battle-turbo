"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { ArrowRight, ExternalLink, Search } from "lucide-react";
import { ChessComPreviewCard } from "../components/ChessComPreviewCard";
import type { ChessComPreviewData } from "@/lib/types/chess-com";

type Step = "input" | "preview";

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoaded } = useUser();
  const [step, setStep] = useState<Step>("input");
  const [chessComHandle, setChessComHandle] = useState("");
  const [previewData, setPreviewData] = useState<ChessComPreviewData | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chessComHandle.trim()) {
      setError("Please enter your chess.com username");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/user/chess-com-profile/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chessComHandle: chessComHandle.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to look up chess.com profile");
      }

      setPreviewData(data.data);
      setStep("preview");
    } catch (err) {
      logger.error("Preview error", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/user/chess-com-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chessComHandle: chessComHandle.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save chess.com profile");
      }

      router.push("/");
    } catch (err) {
      logger.error("Confirm error", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
      setSaving(false);
    }
  };

  const handleGoBack = () => {
    setStep("input");
    setPreviewData(null);
    setError(null);
  };

  const handleSkip = async () => {
    try {
      await fetch("/api/user/onboarding-skip", { method: "POST" });
    } catch {
      // Don't block navigation on skip failure
    }
    router.push("/");
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-cb-bg flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 border-2 border-cb-border-strong border-t-cb-text rounded-full animate-spin" />
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-sm tracking-wide"
          >
            Loading...
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cb-bg flex items-center justify-center p-4 relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-md w-full">
        <AnimatePresence mode="wait">
          {step === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="border border-cb-border p-8 sm:p-12"
            >
              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-10"
              >
                <h1
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-3xl sm:text-4xl text-cb-text mb-3"
                >
                  Welcome to ReplayChess
                </h1>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted"
                >
                  Connect your chess.com account
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-faint mt-2"
                >
                  You can add this later from your profile
                </p>
              </motion.div>

              <form onSubmit={handleLookup} className="space-y-6">
                {/* Input */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <label
                    htmlFor="chessComHandle"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="block text-xs text-cb-text-muted uppercase tracking-widest mb-3"
                  >
                    Chess.com Username
                  </label>
                  <input
                    type="text"
                    id="chessComHandle"
                    value={chessComHandle}
                    onChange={(e) => setChessComHandle(e.target.value)}
                    placeholder="e.g., hikaru"
                    className={cn(
                      "w-full px-4 py-3 bg-transparent border border-cb-border",
                      "text-cb-text placeholder-cb-text-faint",
                      "focus:outline-none focus:border-cb-border-strong transition-colors duration-300"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    disabled={loading}
                  />
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="mt-2 text-xs text-cb-text-faint"
                  >
                    We&apos;ll fetch your ratings and stats from chess.com
                  </p>
                </motion.div>

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-cb-border-strong p-4"
                  >
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-sm"
                    >
                      {error}
                    </p>
                  </motion.div>
                )}

                {/* Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-3"
                >
                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "group relative w-full flex items-center justify-center gap-2 px-8 py-4",
                      "bg-cb-accent text-cb-accent-fg",
                      "transition-all duration-300 overflow-hidden",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                    <span className="relative z-10 font-medium group-hover:text-cb-text transition-colors duration-300">
                      {loading ? "Looking up..." : "Look Up Profile"}
                    </span>
                    {!loading && (
                      <Search
                        className="w-4 h-4 relative z-10 group-hover:text-cb-text transition-colors duration-300"
                        strokeWidth={1.5}
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={loading}
                    className={cn(
                      "group w-full flex items-center justify-center gap-2 px-8 py-4",
                      "border border-cb-border hover:border-cb-border-strong",
                      "text-cb-text-secondary hover:text-cb-text transition-all duration-300",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    Skip for Now
                  </button>
                </motion.div>

                {/* Link to chess.com */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="text-center pt-4"
                >
                  <a
                    href="https://www.chess.com/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="inline-flex items-center gap-1 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors"
                  >
                    Don&apos;t have an account? Create one
                    <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                  </a>
                </motion.div>
              </form>
            </motion.div>
          )}

          {step === "preview" && previewData && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Preview header */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-6"
              >
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-cb-text-muted text-sm"
                >
                  Is this your account?
                </p>
              </motion.div>

              <ChessComPreviewCard
                previewData={previewData}
                onConfirm={handleConfirm}
                onCancel={handleGoBack}
                loading={saving}
                confirmLabel="Confirm & Connect"
              />

              {/* Error on confirm */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border border-cb-border-strong p-4 mt-4"
                >
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary text-sm"
                  >
                    {error}
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
