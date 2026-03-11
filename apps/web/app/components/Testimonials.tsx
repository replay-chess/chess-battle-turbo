"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";

const testimonials = [
  {
    name: "Alex R.",
    title: "Chess Enthusiast",
    elo: "1800 ELO",
    quote:
      "ReplayChess completely changed how I study openings. Playing through Kasparov's legendary positions with a friend is an experience no other platform offers.",
    stars: 5,
  },
  {
    name: "Maria K.",
    title: "Chess Coach",
    elo: "2100 ELO",
    quote:
      "I use ReplayChess with all my students. Walking them through grandmaster games interactively is far more effective than static analysis boards.",
    stars: 5,
  },
  {
    name: "Daniel T.",
    title: "Agadmator Fan",
    elo: "1500 ELO",
    quote:
      "Finally I can actually play those 'pause the video' moments instead of just guessing in my head. This is exactly what the chess community needed.",
    stars: 5,
  },
];

export const Testimonials = () => {
  return (
    <section className="w-full py-12 sm:py-24 px-6 bg-black relative">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
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
            <div className="h-px w-16 bg-white/20" />
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-[10px] tracking-[0.4em] uppercase"
            >
              What Players Say
            </span>
            <div className="h-px w-16 bg-white/20" />
          </div>

          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl md:text-6xl text-white mb-4"
          >
            Loved by Chess Players
          </h2>

          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-white/40 text-lg max-w-xl mx-auto"
          >
            Join hundreds of players reliving legendary chess moments
          </p>
        </motion.div>

        {/* Testimonials Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10">
          {testimonials.map((testimonial, index) => (
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
              {/* Stars */}
              <div className="flex gap-1 mb-6">
                {Array.from({ length: testimonial.stars }).map((_, i) => (
                  <svg
                    key={i}
                    className={cn(
                      "w-4 h-4",
                      "text-white/40 group-hover:text-black/60",
                      "transition-colors duration-500"
                    )}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>

              {/* Quote */}
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className={cn(
                  "text-sm leading-relaxed mb-8",
                  "text-white/50 group-hover:text-black/60",
                  "transition-colors duration-500"
                )}
              >
                "{testimonial.quote}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-10 h-10 flex items-center justify-center",
                    "border border-white/10 group-hover:border-black/10",
                    "transition-colors duration-500"
                  )}
                >
                  <span
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className={cn(
                      "text-lg",
                      "text-white/40 group-hover:text-black/40",
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
                      "text-white group-hover:text-black",
                      "transition-colors duration-500"
                    )}
                  >
                    {testimonial.name}
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className={cn(
                      "text-[10px] tracking-[0.2em] uppercase",
                      "text-white/30 group-hover:text-black/40",
                      "transition-colors duration-500"
                    )}
                  >
                    {testimonial.title} &middot; {testimonial.elo}
                  </p>
                </div>
              </div>

              {/* Corner accent */}
              <div
                className={cn(
                  "absolute top-4 right-4 w-8 h-8",
                  "border-t border-r",
                  "border-white/10 group-hover:border-black/10",
                  "transition-colors duration-500"
                )}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
