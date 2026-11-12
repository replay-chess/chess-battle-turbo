"use client";

import { withSentry } from "@/lib/sentry/lazy";
import Link from "next/link";
import { useEffect } from "react";

/**
 * The entrance animation, in CSS (FIX-1): this root error boundary is part of every route's first load, and its
 * `motion/react` import put ~36 kB gzipped of animation library into the shared chunk (the /r Lighthouse gate, G5).
 * Same timings as before; none under reduced motion.
 */
const ERROR_CSS = `
@keyframes rc-err-king { from { opacity: 0; transform: translateY(-30px) rotate(0deg) } to { opacity: .5; transform: translateY(0) rotate(-35deg) } }
@keyframes rc-err-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rc-err-rise { from { opacity: 0; transform: translateY(var(--rc-err-y, 10px)) } to { opacity: 1; transform: none } }
@keyframes rc-err-line { from { opacity: 0; transform: scaleX(0) } to { opacity: 1; transform: scaleX(1) } }
.rc-err-king { opacity: .5; transform: rotate(-35deg); animation: rc-err-king 1.4s cubic-bezier(.22,1,.36,1) both }
.rc-err-a { animation: rc-err-fade .6s both }
.rc-err-r { animation: rc-err-rise .6s both }
.rc-err-h { --rc-err-y: 20px; animation: rc-err-rise .8s cubic-bezier(.22,1,.36,1) both }
.rc-err-l { animation: rc-err-line .8s both }
@media (prefers-reduced-motion: reduce) { .rc-err-king, .rc-err-a, .rc-err-r, .rc-err-h, .rc-err-l { animation: none } }
`;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    withSentry((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-cb-bg px-6">
      <style>{ERROR_CSS}</style>
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
        <div
          className="mb-10 origin-bottom rc-err-king"
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
        </div>

        {/* Micro label */}
        <span
          className="mb-5 text-[10px] tracking-[0.3em] uppercase text-cb-text-muted rc-err-a" style={{ animationDelay: "0.4s" }}
        >
          Something went wrong
        </span>

        {/* Heading */}
        <h1
          className="mb-5 font-[family-name:var(--font-instrument-serif)] text-5xl italic text-cb-text sm:text-6xl rc-err-h" style={{ animationDelay: "0.5s" }}
        >
          Position Lost
        </h1>

        {/* Gradient divider */}
        <div
          className="mb-6 h-px w-48 bg-gradient-to-r from-transparent via-cb-border-strong to-transparent rc-err-l" style={{ animationDelay: "0.7s" }}
        />

        {/* Description */}
        <p
          className="mb-8 max-w-md text-center text-sm leading-relaxed text-cb-text-muted rc-err-r" style={{ animationDelay: "0.8s" }}
        >
          An unexpected error disrupted the game. The position has been reported
          and we&apos;re working to restore it.
        </p>

        {/* Error digest */}
        {error.digest && (
          <code
            className="mb-8 select-all font-[family-name:var(--font-geist-mono)] text-[11px] text-cb-text-faint rc-err-a" style={{ animationDelay: "1s" }}
          >
            {error.digest}
          </code>
        )}

        {/* Actions */}
        <div
          className="flex items-center gap-4 rc-err-r" style={{ animationDelay: "1.1s" }}
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
        </div>
      </div>
    </div>
  );
}
