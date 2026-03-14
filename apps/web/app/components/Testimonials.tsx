"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";

const testimonials = [
  {
    name: "Alex R.",
    handle: "@alexr_chess",
    text: "ReplayChess completely changed how I study openings. Playing through Kasparov's legendary positions with a friend is an experience no other platform offers.",
    tweetUrl: "https://twitter.com",
  },
  {
    name: "Maria K.",
    handle: "@mariak_coach",
    text: "I use ReplayChess with all my students. Walking them through grandmaster games interactively is far more effective than static analysis boards.",
    tweetUrl: "https://twitter.com",
  },
  {
    name: "Daniel T.",
    handle: "@dant_agad",
    text: "Finally I can actually play those 'pause the video' moments instead of just guessing in my head. This is exactly what the chess community needed.",
    tweetUrl: "https://twitter.com",
  },
];

export const Testimonials = () => {
  return (
    <section className="w-full py-12 sm:py-24 px-6 bg-cb-bg relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
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
            <div className="h-px w-16 bg-cb-border-strong" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
            >
              What Players Say
            </span>
            <div className="h-px w-16 bg-cb-border-strong" />
          </div>

          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-cb-text mb-4"
          >
            Loved by Chess Players
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-lg max-w-xl mx-auto"
          >
            See what players are saying on X
          </p>
        </motion.div>

        {/* Testimonials Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-cb-border">
          {testimonials.map((testimonial, index) => (
            <motion.a
              key={index}
              href={testimonial.tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={cn(
                "group relative bg-cb-bg p-8 block",
                "hover:bg-cb-accent transition-colors duration-500"
              )}
            >
              {/* X icon */}
              <div className="mb-6">
                <svg
                  className={cn(
                    "w-5 h-5",
                    "text-cb-text-muted group-hover:text-cb-accent-fg/60",
                    "transition-colors duration-500"
                  )}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>

              {/* Quote */}
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className={cn(
                  "text-sm leading-relaxed mb-8",
                  "text-cb-text-secondary group-hover:text-cb-accent-fg/60",
                  "transition-colors duration-500"
                )}
              >
                &ldquo;{testimonial.text}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-10 h-10 flex items-center justify-center",
                    "border border-cb-border group-hover:border-cb-accent-fg/10",
                    "transition-colors duration-500"
                  )}
                >
                  <span
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className={cn(
                      "text-lg",
                      "text-cb-text-muted group-hover:text-cb-accent-fg/40",
                      "transition-colors duration-500"
                    )}
                  >
                    {testimonial.name[0]}
                  </span>
                </div>
                <div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className={cn(
                      "text-sm font-medium",
                      "text-cb-text group-hover:text-cb-accent-fg",
                      "transition-colors duration-500"
                    )}
                  >
                    {testimonial.name}
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className={cn(
                      "text-[10px] tracking-[0.2em] uppercase",
                      "text-cb-text-muted group-hover:text-cb-accent-fg/40",
                      "transition-colors duration-500"
                    )}
                  >
                    {testimonial.handle}
                  </p>
                </div>
              </div>

              {/* Corner accent */}
              <div
                className={cn(
                  "absolute top-4 right-4 w-8 h-8",
                  "border-t border-r",
                  "border-cb-border group-hover:border-cb-accent-fg/10",
                  "transition-colors duration-500"
                )}
              />
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
};
