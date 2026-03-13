"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { motion } from "motion/react";

export const HowToPlay = () => {
  const steps = [
    {
      number: "01",
      title: "Pick a Position",
      description: "Browse legendary games and choose a critical moment from chess history.",
    },
    {
      number: "02",
      title: "Share a Challenge",
      description: "Get a unique link and send it to a friend to play from that exact position.",
    },
    {
      number: "03",
      title: "Play the Moment",
      description: "Step into the game from that exact point and make your own moves.",
    },
    {
      number: "04",
      title: "Compare & Learn",
      description: "See how your continuation stacks up against the best engine line.",
    },
  ];

  return (
    <section className="w-full -mt-24 sm:-mt-32 pt-12 sm:pt-24 pb-12 sm:pb-24 px-6 bg-black relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-20"
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-px w-16 bg-white/20" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-[10px] tracking-[0.4em] uppercase"
            >
              How It Works
            </span>
            <div className="h-px w-16 bg-white/20" />
          </div>

          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-white mb-4"
          >
            Easily Play in Four Simple Steps
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/40 text-lg max-w-xl mx-auto"
          >
            Relive legendary chess moments and challenge your friends
          </p>
        </motion.div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-white/10">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={cn(
                "group relative bg-black p-8",
                "hover:bg-white transition-colors duration-500"
              )}
            >
              {/* Step Number */}
              <div className="mb-8">
                <span
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className={cn(
                    "text-6xl font-light",
                    "text-white/10 group-hover:text-black/10",
                    "transition-colors duration-500"
                  )}
                >
                  {step.number}
                </span>
              </div>

              {/* Content */}
              <div>
                <h3
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className={cn(
                    "text-xl font-semibold mb-3",
                    "text-white group-hover:text-black",
                    "transition-colors duration-500"
                  )}
                >
                  {step.title}
                </h3>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className={cn(
                    "text-sm leading-relaxed",
                    "text-white/50 group-hover:text-black/60",
                    "transition-colors duration-500"
                  )}
                >
                  {step.description}
                </p>
              </div>

              {/* Corner accent */}
              <div className={cn(
                "absolute top-4 right-4 w-8 h-8",
                "border-t border-r",
                "border-white/10 group-hover:border-black/10",
                "transition-colors duration-500"
              )} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
