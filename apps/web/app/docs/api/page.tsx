"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

const endpoints = [
  {
    group: "Games",
    description: "Create, retrieve, and manage chess games",
    methods: ["GET", "POST"],
  },
  {
    group: "Players",
    description: "Player profiles, ratings, and statistics",
    methods: ["GET"],
  },
  {
    group: "Positions",
    description: "Browse and retrieve legendary chess positions",
    methods: ["GET"],
  },
  {
    group: "Legends",
    description: "Historical player data and game collections",
    methods: ["GET"],
  },
  {
    group: "Analysis",
    description: "AI-powered game analysis and evaluation",
    methods: ["GET", "POST"],
  },
];

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Hero */}
      <section className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist Mono', monospace" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Developer
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>

            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
            >
              ReplayChess API
            </h1>

            <span
              style={{ fontFamily: "'Geist Mono', monospace" }}
              className="inline-block text-xs px-3 py-1 border border-cb-border-strong text-cb-text-secondary mb-6"
            >
              v0.1.0
            </span>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-lg text-cb-text-muted max-w-xl mx-auto"
            >
              Programmatic access to games, positions, player data, and AI-powered analysis.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Coming Soon */}
      <section className="relative py-16 sm:py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl text-cb-text-secondary italic mb-6"
            >
              Coming Soon
            </p>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-cb-text-muted leading-relaxed max-w-lg mx-auto"
            >
              We&apos;re building a comprehensive REST API that will give developers full access to ReplayChess&apos;s
              platform — from game data and player stats to our legendary positions library and AI analysis engine.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Planned Endpoints */}
      <section className="relative py-16 sm:py-24 px-6">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div className="max-w-4xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Planned Endpoints
              </span>
              <div className="h-px w-16 bg-cb-border-strong" />
            </div>
          </motion.div>

          <div className="space-y-3">
            {endpoints.map((endpoint, index) => (
              <motion.div
                key={endpoint.group}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="border border-cb-border p-5 flex flex-wrap items-center gap-4 hover:border-cb-border-strong transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                  <span
                    style={{ fontFamily: "'Geist Mono', monospace" }}
                    className="text-sm text-cb-text font-medium"
                  >
                    /api/{endpoint.group.toLowerCase()}
                  </span>
                </div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-muted flex-1 min-w-[200px]"
                >
                  {endpoint.description}
                </p>
                <div className="flex items-center gap-2">
                  {endpoint.methods.map((method) => (
                    <span
                      key={method}
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className={cn(
                        "text-[10px] px-2 py-0.5 border uppercase tracking-wider",
                        method === "GET"
                          ? "border-emerald-500/30 text-emerald-400/70"
                          : "border-blue-500/30 text-blue-400/70"
                      )}
                    >
                      {method}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Email Signup */}
      <section className="relative py-20 px-6">
        <div className="max-w-xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl text-cb-text mb-4"
            >
              Get Notified
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-sm mb-6"
            >
              Be the first to know when the API launches.
            </p>
            <form className="flex max-w-md mx-auto">
              <input
                type="email"
                placeholder="Enter your email"
                className={cn(
                  "flex-1 bg-cb-hover border border-cb-border",
                  "px-4 py-3 text-sm text-cb-text",
                  "placeholder:text-cb-text-faint",
                  "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              />
              <button
                type="submit"
                className={cn(
                  "group/btn relative overflow-hidden",
                  "px-6 py-3 bg-cb-accent text-cb-accent-fg",
                  "text-sm font-medium",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover/btn:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-2 group-hover/btn:text-cb-text transition-colors duration-300">
                  Subscribe
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
