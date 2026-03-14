"use client";

import * as Sentry from "@sentry/nextjs";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { useEffect } from "react";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export default function GlobalError({
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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "var(--cb-bg)",
          color: "var(--cb-text)",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        }}
      >
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(24px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes kingFall {
            from { opacity: 0; transform: translate(-50%, -50%) rotate(0deg); }
            to { opacity: 0.35; transform: translate(-50%, -50%) rotate(-45deg); }
          }
          @keyframes scaleIn {
            from { opacity: 0; transform: scaleX(0); }
            to { opacity: 1; transform: scaleX(1); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
          @keyframes drift {
            0% { transform: translateY(0) rotate(0deg); opacity: 0; }
            10% { opacity: 0.15; }
            90% { opacity: 0.15; }
            100% { transform: translateY(-80px) rotate(45deg); opacity: 0; }
          }
        `}</style>

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            overflow: "hidden",
            padding: "24px",
          }}
        >
          {/* Grid background */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.015,
              backgroundImage:
                "linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
              pointerEvents: "none",
            }}
          />

          {/* Heavy vignette */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at center, transparent 10%, var(--cb-bg) 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Scan lines */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, var(--cb-hover) 2px, var(--cb-hover) 4px)",
              pointerEvents: "none",
            }}
          />

          {/* Floating debris particles */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: "3px",
                height: "3px",
                backgroundColor: "var(--cb-text)",
                left: `${25 + i * 10}%`,
                bottom: "30%",
                animation: `drift ${4 + i * 0.8}s ease-in-out ${i * 0.6}s infinite`,
                pointerEvents: "none",
              }}
            />
          ))}

          <div
            style={{
              position: "relative",
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Fallen King */}
            <div
              style={{
                position: "relative",
                width: "120px",
                height: "120px",
                marginBottom: "40px",
              }}
            >
              <svg
                width="100"
                height="100"
                viewBox="0 0 45 45"
                fill="none"
                role="img"
                aria-label="Fallen chess king"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  animation:
                    "kingFall 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards",
                }}
              >
                <g
                  stroke="var(--cb-text)"
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

              {/* Red glow */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "60%",
                  transform: "translate(-50%, -50%)",
                  width: "60px",
                  height: "60px",
                  background:
                    "radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)",
                  animation: "pulse 3s ease-in-out infinite",
                  pointerEvents: "none",
                }}
              />
            </div>

            {/* Error indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "20px",
                animation: "fadeIn 0.6s ease 0.5s both",
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  backgroundColor: "#ef4444",
                  animation: "pulse 2s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: "var(--cb-text-muted)",
                }}
              >
                Critical Failure
              </span>
            </div>

            {/* Heading */}
            <h1
              style={{
                fontFamily: "var(--font-instrument-serif), serif",
                fontStyle: "italic",
                fontSize: "clamp(3rem, 8vw, 5rem)",
                fontWeight: 400,
                margin: "0 0 20px 0",
                lineHeight: 1,
                animation:
                  "slideUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.6s both",
              }}
            >
              Game Over
            </h1>

            {/* Gradient divider */}
            <div
              style={{
                height: "1px",
                width: "200px",
                background:
                  "linear-gradient(to right, transparent, var(--cb-border-strong), transparent)",
                marginBottom: "24px",
                animation: "scaleIn 0.8s ease 0.9s both",
              }}
            />

            {/* Description */}
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.7,
                color: "var(--cb-text-muted)",
                textAlign: "center",
                maxWidth: "440px",
                margin: "0 0 32px 0",
                animation: "slideUp 0.6s ease 1s both",
              }}
            >
              A critical error brought down the entire application. This has been
              reported to our team automatically.
            </p>

            {/* Error digest */}
            {error.digest && (
              <code
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "11px",
                  color: "var(--cb-text-faint)",
                  marginBottom: "32px",
                  userSelect: "all",
                  animation: "fadeIn 0.6s ease 1.2s both",
                }}
              >
                {error.digest}
              </code>
            )}

            {/* Actions */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                animation: "slideUp 0.6s ease 1.3s both",
              }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  backgroundColor: "var(--cb-accent)",
                  color: "var(--cb-accent-fg)",
                  border: "none",
                  padding: "12px 32px",
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "opacity 0.3s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
              >
                Try Again
              </button>
              <a
                href="/"
                style={{
                  border: "1px solid var(--cb-border-strong)",
                  color: "var(--cb-text-secondary)",
                  padding: "12px 32px",
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  cursor: "pointer",
                  transition: "all 0.3s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--cb-text-muted)";
                  e.currentTarget.style.color = "var(--cb-text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--cb-border-strong)";
                  e.currentTarget.style.color = "var(--cb-text-secondary)";
                }}
              >
                Return Home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
