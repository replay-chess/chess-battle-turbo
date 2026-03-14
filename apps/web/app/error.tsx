"use client";

import * as Sentry from "@sentry/nextjs";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-cb-bg px-6">
      {/* Grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Radial vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,var(--cb-bg)_80%)]" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Fallen King */}
        <motion.div
          initial={{ opacity: 0, rotate: 0, y: -30 }}
          animate={{ opacity: 0.5, rotate: -35, y: 0 }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 origin-bottom"
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 45 45"
            fill="none"
            role="img"
            aria-label="Fallen chess king"
          >
            <g
              stroke="currentColor"
              className="text-cb-text"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22.5" y1="11.63" x2="22.5" y2="6" />
              <line x1="20" y1="8" x2="25" y2="8" />
              <path
                d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"
                fill="var(--cb-hover)"
              />
              <path
                d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4l0 3.5 0-3.5c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7z"
                fill="var(--cb-hover)"
              />
              <path d="M12.5 30c5.5-3 14.5-3 20 0" />
              <path d="M12.5 33.5c5.5-3 14.5-3 20 0" />
              <path d="M12.5 37c5.5-3 14.5-3 20 0" />
            </g>
          </svg>
        </motion.div>

        {/* Micro label */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mb-5 text-[10px] tracking-[0.3em] uppercase text-cb-text-muted"
        >
          Something went wrong
        </motion.span>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-5 font-[family-name:var(--font-instrument-serif)] text-5xl italic text-cb-text sm:text-6xl"
        >
          Position Lost
        </motion.h1>

        {/* Gradient divider */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
          className="mb-6 h-px w-48 bg-gradient-to-r from-transparent via-cb-border-strong to-transparent"
        />

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mb-8 max-w-md text-center text-sm leading-relaxed text-cb-text-muted"
        >
          An unexpected error disrupted the game. The position has been reported
          and we&apos;re working to restore it.
        </motion.p>

        {/* Error digest */}
        {error.digest && (
          <motion.code
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1 }}
            className="mb-8 select-all font-[family-name:var(--font-geist-mono)] text-[11px] text-cb-text-faint"
          >
            {error.digest}
          </motion.code>
        )}

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.1 }}
          className="flex items-center gap-4"
        >
          <button
            type="button"
            onClick={reset}
            className="bg-cb-accent px-8 py-3 text-sm font-semibold tracking-[0.1em] uppercase text-cb-accent-fg transition-all duration-300 hover:opacity-90"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="border border-cb-border-strong px-8 py-3 text-sm font-semibold tracking-[0.1em] uppercase text-cb-text-secondary transition-all duration-300 hover:border-cb-text-muted hover:text-cb-text"
          >
            Return Home
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
