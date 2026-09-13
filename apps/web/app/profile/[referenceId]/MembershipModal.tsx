"use client";

import { useEffect, useId, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

interface MembershipModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  /** Blocks the backdrop, close button and Escape while a request is in flight. */
  locked?: boolean;
  testId?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Confirmation dialog for membership changes. Same construction as
 * ChessComConnectModal: fixed overlay, blurred backdrop, hairline card.
 *
 * Keyboard behaviour: focus moves into the card on open (first control, else
 * the close button), Tab and Shift+Tab wrap inside the card, Escape closes
 * unless `locked`, and focus returns to the opener on close.
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
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = () => {
    if (!locked) onClose();
  };

  // Move focus into the dialog on open and give it back on close. Keyed on
  // isOpen rather than unmount because AnimatePresence keeps the node around
  // for the exit animation.
  useEffect(() => {
    if (!isOpen) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    if (card) {
      const [first] = focusableElements(card).filter((el) => el !== closeButtonRef.current);
      (first ?? closeButtonRef.current ?? card).focus();
    }
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, [isOpen]);

  // Escape closes; Tab and Shift+Tab wrap inside the card.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (locked) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusable = focusableElements(card);
      if (focusable.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && card.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, locked, onClose]);

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
          aria-labelledby={titleId}
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
            ref={cardRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-md focus:outline-none"
          >
            <button
              ref={closeButtonRef}
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
                  id={titleId}
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
