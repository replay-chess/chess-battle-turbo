"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";

export const AgadmatorFeature = () => {
  return (
    <section className="w-full py-12 sm:py-24 px-6 bg-cb-bg relative overflow-hidden">
      {/* Subtle diagonal line pattern */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            var(--cb-grid-line),
            var(--cb-grid-line) 1px,
            transparent 1px,
            transparent 60px
          )`,
        }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-16"
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-16 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
            >
              Featured Content
            </span>
            <div className="h-px w-16 bg-cb-border-strong" />
          </div>

          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-cb-text mb-4"
          >
            Turn Chess Videos into Positions You Can Play
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-lg max-w-2xl mx-auto"
          >
            Practice the moments that make you pause, calculate, and look again.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left Content - Video Card */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            {/* Decorative frame */}
            <div className="absolute -inset-4 border border-cb-border" />
            <div className="absolute -inset-8 border border-cb-border" />

            <div className="relative border border-cb-border bg-cb-bg">
              {/* Video Preview */}
              <div className="aspect-video relative overflow-hidden group">
                <video
                  playsInline
                  preload="none"
                  poster="/og-image.jpg"
                  controls
                  className="absolute inset-0 w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                >
                  <source src="/video_clip.webm" type="video/webm" />
                </video>

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-cb-gradient-from via-transparent to-transparent" />

                {/* Text Overlay */}
                <div className="pointer-events-none absolute bottom-10 left-0 right-0 z-10 flex items-end justify-between p-4">
                  <div>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text text-sm font-medium"
                    >
                      Agadmator’s Chess Channel
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-cb-text-secondary text-xs mt-1"
                    >
                      #pause-the-video
                    </p>
                  </div>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-3 border-t border-cb-border">
                {[
                  { label: "Watch", value: "01" },
                  { label: "Pause", value: "02" },
                  { label: "Play", value: "03" },
                ].map((stat, index) => (
                  <div
                    key={index}
                    className={cn(
                      "text-center py-4",
                      index !== 2 && "border-r border-cb-border",
                    )}
                  >
                    <p
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-xl text-cb-text"
                    >
                      {stat.value}
                    </p>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted mt-1"
                    >
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right Content - Text */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            {/* Quote */}
            <div className="border-l-2 border-cb-border-strong pl-6">
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-2xl sm:text-3xl text-cb-text leading-relaxed italic"
              >
                “Pause the video and try to find the best move.”
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-sm mt-4"
              >
                — Every Agadmator video
              </p>
            </div>

            {/* Description */}
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-secondary leading-relaxed"
            >
              ReplayChess is built for the moment when a chess video makes you
              stop and calculate. Choose a featured position, inspect the board,
              and test your idea in a playable game with a friend.
            </p>

            {/* Features */}
            <div className="space-y-4">
              {[
                "Inspect a curated featured position",
                "Challenge a friend from the same board",
                "Review the game after you finish",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="flex items-center gap-4 group"
                >
                  <div className="w-8 h-8 border border-cb-border flex items-center justify-center group-hover:bg-cb-accent group-hover:border-cb-accent transition-all duration-300">
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs text-cb-text-muted group-hover:text-cb-accent-fg transition-colors"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary group-hover:text-cb-text transition-colors"
                  >
                    {feature}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Channel Badge */}
            <div className="flex items-center gap-4 pt-6 border-t border-cb-border">
              <div className="w-12 h-12 bg-cb-surface border border-cb-border-strong flex items-center justify-center">
                <span className="text-2xl text-cb-text">♔</span>
              </div>
              <div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="font-medium text-cb-text"
                >
                  Agadmator
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-muted"
                >
                  Inspiration for pause-the-video chess puzzles
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
