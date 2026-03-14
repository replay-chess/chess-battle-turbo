import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
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
        {/* Fallen King -- static (no framer-motion, server component) */}
        <div className="mb-10 origin-bottom rotate-[-35deg] opacity-50">
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
        <span className="mb-5 text-[10px] tracking-[0.3em] uppercase text-cb-text-muted">
          Page not found
        </span>

        {/* Heading */}
        <h1 className="mb-5 font-[family-name:var(--font-instrument-serif)] text-5xl italic text-cb-text sm:text-6xl">
          Off the Board
        </h1>

        {/* Gradient divider */}
        <div className="mb-6 h-px w-48 bg-gradient-to-r from-transparent via-cb-border-strong to-transparent" />

        {/* Description */}
        <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-cb-text-muted">
          This square doesn&apos;t exist. The page you&apos;re looking for may have
          been moved or removed.
        </p>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="bg-cb-accent px-8 py-3 text-sm font-semibold tracking-[0.1em] uppercase text-cb-accent-fg transition-all duration-300 hover:opacity-90"
          >
            Return Home
          </Link>
          <Link
            href="/play"
            className="border border-cb-border-strong px-8 py-3 text-sm font-semibold tracking-[0.1em] uppercase text-cb-text-secondary transition-all duration-300 hover:border-cb-text-muted hover:text-cb-text"
          >
            Play Chess
          </Link>
        </div>
      </div>
    </div>
  );
}
