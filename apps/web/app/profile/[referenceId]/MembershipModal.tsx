"use client";

import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

interface MembershipModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  /** Blocks the backdrop and close button while a request is in flight. */
  locked?: boolean;
  testId?: string;
  children: React.ReactNode;
}

/**
 * Confirmation dialog for membership changes. Same construction as
 * ChessComConnectModal: fixed overlay, blurred backdrop, hairline card.
 */
export function MembershipModal({
  isOpen,
  title,
  description,
  onClose,
  locked = false,
  testId,
  children,
}: MembershipModalProps) {
  const handleClose = () => {
    if (!locked) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-testid={testId}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-cb-backdrop backdrop-blur-sm"
            onClick={handleClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-md"
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={locked}
              aria-label="Close"
              className="absolute -top-12 right-0 p-2 text-cb-text-muted hover:text-cb-text-secondary transition-colors disabled:opacity-40"
            >
              <X className="w-5 h-5" strokeWidth={1.5} />
            </button>

            <div className="border border-cb-border bg-cb-bg p-8">
              <div className="mb-6">
                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl text-cb-text mb-2"
                >
                  {title}
                </h2>
                {description && (
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-muted text-sm"
                  >
                    {description}
                  </p>
                )}
              </div>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
