"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

export default function Hero() {
  const { isSignedIn } = useAuth();

  return (
    <section aria-label="Hero" className="relative h-full w-full flex items-center justify-center overflow-hidden bg-cb-bg">
      {/* Video Background */}
      <video
        aria-hidden="true"
        autoPlay
        loop
        muted
        playsInline
        preload="none"
        poster="/og-image.jpg"
        className="absolute inset-0 w-full h-full object-cover opacity-20 grayscale"
      >
        <source src="/Kings_Gambit_Chess_Board_Animation.mp4" type="video/mp4" />
      </video>

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-cb-gradient-from via-transparent to-cb-gradient-from" />
      <div className="absolute inset-0 bg-gradient-to-r from-cb-backdrop via-transparent to-cb-backdrop" />

      {/* Decorative elements */}
      <div className="absolute top-20 left-8 w-32 h-32 border-l border-t border-cb-border" />
      <div className="absolute bottom-20 right-8 w-32 h-32 border-r border-b border-cb-border" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
        }}
      />

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col items-center justify-center text-center px-4 max-w-5xl"
      >
        {/* Eyebrow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-3 mb-8"
        >
          <div className="h-px w-12 bg-cb-text-muted" />
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-secondary text-[10px] tracking-[0.4em] uppercase"
          >
            Experience Iconic Chess Moments Like Never Before
          </span>
          <div className="h-px w-12 bg-cb-text-muted" />
        </motion.div>

        {/* Main Title */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-cb-text leading-[0.95] tracking-tight mb-6 text-center sm:text-left"
        >
          Relive Legendary
          <br />
          <span className="text-cb-text-muted">Chess Moments</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-muted text-lg sm:text-xl md:text-2xl max-w-2xl leading-relaxed mb-12 text-center sm:text-left"
        >
          Play and Relive the Critical Moves of Chess Legends.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="hidden sm:flex flex-col items-center gap-3"
        >
          {isSignedIn ? (
            <Link href="/play">
              <button
                className={cn(
                  "group relative overflow-hidden",
                  "bg-cb-accent text-cb-accent-fg",
                  "px-10 py-4",
                  "text-sm font-semibold tracking-[0.1em] uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-3 group-hover:text-cb-text transition-colors duration-300">
                  Play Legendary Games — Free
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
          ) : (
            <Link href="/try">
              <button
                className={cn(
                  "group relative overflow-hidden",
                  "bg-cb-accent text-cb-accent-fg",
                  "px-10 py-4",
                  "text-sm font-semibold tracking-[0.1em] uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-3 group-hover:text-cb-text transition-colors duration-300">
                  Try a Position — No Sign-up
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
          )}
        </motion.div>

      </motion.div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-cb-gradient-from to-transparent" />

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 p-3 bg-cb-backdrop backdrop-blur-sm border-t border-cb-border">
        {isSignedIn ? (
          <Link href="/play" className="block">
            <button
              className={cn(
                "group relative overflow-hidden w-full",
                "bg-cb-accent text-cb-accent-fg",
                "px-3 py-3",
                "text-sm font-semibold tracking-wide uppercase",
                "transition-all duration-300"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative flex items-center justify-center gap-2 group-hover:text-cb-text transition-colors duration-300">
                Play Free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </Link>
        ) : (
          <Link href="/try" className="block">
            <button
              className={cn(
                "group relative overflow-hidden w-full",
                "bg-cb-accent text-cb-accent-fg",
                "px-3 py-3",
                "text-sm font-semibold tracking-wide uppercase",
                "transition-all duration-300"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative flex items-center justify-center gap-2 group-hover:text-cb-text transition-colors duration-300">
                Try a Position
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </Link>
        )}
      </div>
    </section>
  );
}
