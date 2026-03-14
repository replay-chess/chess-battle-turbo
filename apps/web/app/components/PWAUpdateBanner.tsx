"use client";

import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { RefreshCw, X } from "lucide-react";

interface PWAUpdateBannerProps {
  isVisible: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function PWAUpdateBanner({
  isVisible,
  onUpdate,
  onDismiss,
}: PWAUpdateBannerProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          className={cn(
            "fixed bottom-4 left-4 right-4 z-50",
            "sm:left-auto sm:right-4 sm:max-w-sm sm:w-full"
          )}
        >
          <div
            className={cn(
              "relative",
              "bg-cb-surface border border-cb-border",
              "p-4",
              "flex items-center gap-4"
            )}
          >
            {/* Animated refresh icon */}
            <div className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center bg-cb-hover border border-cb-border">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "linear",
                }}
              >
                <RefreshCw className="w-4 h-4 text-cb-text-secondary" strokeWidth={1.5} />
              </motion.div>
              {/* Subtle pulse indicator */}
              <motion.div
                className="absolute top-0 right-0 w-2 h-2 bg-cb-accent"
                animate={{
                  opacity: [1, 0.4, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>

            {/* Text content */}
            <div className="flex-1 min-w-0">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text font-medium tracking-tight"
              >
                Update Available
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-cb-text-muted mt-0.5"
              >
                A new version is ready
              </p>
            </div>

            {/* Update button */}
            <motion.button
              onClick={onUpdate}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "flex-shrink-0",
                "h-9 px-4",
                "bg-cb-accent text-cb-accent-fg",
                "text-xs font-semibold uppercase tracking-wider",
                "hover:bg-cb-accent/90",
                "transition-colors duration-200"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Refresh
            </motion.button>

            {/* Dismiss button */}
            <button
              onClick={onDismiss}
              className={cn(
                "flex-shrink-0",
                "p-1.5",
                "text-cb-text-muted hover:text-cb-text-secondary",
                "transition-colors duration-200"
              )}
              aria-label="Dismiss update notification"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>

            {/* Subtle top accent line */}
            <motion.div
              className="absolute top-0 left-0 h-px bg-cb-border-strong"
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{
                duration: 0.6,
                delay: 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
