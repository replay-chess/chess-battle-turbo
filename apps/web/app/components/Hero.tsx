"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { useUserStore } from "@/lib/stores";

export default function Hero() {
  const user = useUserStore((s) => s.user);

  return (
    <section aria-label="Hero" className="relative h-full w-full flex items-center justify-center overflow-hidden bg-black">
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
      <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />

      {/* Decorative elements */}
      <div className="absolute top-20 left-8 w-32 h-32 border-l border-t border-white/10" />
      <div className="absolute bottom-20 right-8 w-32 h-32 border-r border-b border-white/10" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
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
          <div className="h-px w-12 bg-white/30" />
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/50 text-[10px] tracking-[0.4em] uppercase"
          >
            Experience Iconic Chess Moments Like Never Before
          </span>
          <div className="h-px w-12 bg-white/30" />
        </motion.div>

        {/* Main Title */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-white leading-[0.95] tracking-tight mb-6 text-center sm:text-left"
        >
          Relive Legendary
          <br />
          <span className="text-white/40">Chess Moments</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-white/40 text-lg sm:text-xl md:text-2xl max-w-2xl leading-relaxed mb-12 text-center sm:text-left"
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
          {user ? (
            <>
              <Link href="/play">
                <button
                  className={cn(
                    "group relative overflow-hidden",
                    "bg-white text-black",
                    "px-10 py-4",
                    "text-sm font-semibold tracking-[0.1em] uppercase",
                    "transition-all duration-300"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative flex items-center gap-3 group-hover:text-white transition-colors duration-300">
                    Play Legendary Games — Free
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </button>
              </Link>
              <Link href="/challenge/new">
                <button
                  className={cn(
                    "group relative overflow-hidden",
                    "border border-white/20 hover:border-white/40 text-white/60 hover:text-white",
                    "px-10 py-3",
                    "text-sm font-semibold tracking-[0.1em] uppercase",
                    "transition-all duration-300"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="relative flex items-center gap-3 transition-colors duration-300">
                    <Users className="w-4 h-4" strokeWidth={1.5} />
                    Challenge a Friend
                  </span>
                </button>
              </Link>
            </>
          ) : (
            <Link href="/try">
              <button
                className={cn(
                  "group relative overflow-hidden",
                  "bg-white text-black",
                  "px-10 py-4",
                  "text-sm font-semibold tracking-[0.1em] uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-3 group-hover:text-white transition-colors duration-300">
                  Try a Position — No Sign-up
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
          )}
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-16 flex items-center gap-8 sm:gap-12"
        >
          {[
            { value: "10K+", label: "Legendary Positions" },
            { value: "100+", label: "Players" },
            { value: "100+", label: "Games Played" },
          ].map((stat, index, arr) => (
            <div key={index} className="flex items-center gap-8 sm:gap-12">
              <div className="text-center">
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl sm:text-3xl text-white mb-1"
                >
                  {stat.value}
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.2em] uppercase text-white/30"
                >
                  {stat.label}
                </p>
              </div>
              {index < arr.length - 1 && (
                <div className="h-10 w-px bg-white/20" />
              )}
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 p-3 bg-black/90 backdrop-blur-sm border-t border-white/[0.06]">
        {user ? (
          <div className="flex gap-2">
            <Link href="/play" className="flex-1">
              <button
                className={cn(
                  "group relative overflow-hidden w-full",
                  "bg-white text-black",
                  "px-3 py-3",
                  "text-sm font-semibold tracking-wide uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center justify-center gap-2 group-hover:text-white transition-colors duration-300">
                  Play Free
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
            <Link href="/challenge/new" className="flex-1">
              <button
                className={cn(
                  "group relative overflow-hidden w-full",
                  "border border-white/20 text-white/60",
                  "px-3 py-3",
                  "text-sm font-semibold tracking-wide uppercase",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="relative flex items-center justify-center gap-2 transition-colors duration-300">
                  <Users className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                  vs Friend
                </span>
              </button>
            </Link>
          </div>
        ) : (
          <Link href="/try" className="block">
            <button
              className={cn(
                "group relative overflow-hidden w-full",
                "bg-white text-black",
                "px-3 py-3",
                "text-sm font-semibold tracking-wide uppercase",
                "transition-all duration-300"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative flex items-center justify-center gap-2 group-hover:text-white transition-colors duration-300">
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
