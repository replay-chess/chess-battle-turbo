"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const stats = [
  { value: "10,000+", label: "Positions" },
  { value: "50+", label: "Legends" },
  { value: "100+", label: "Games Played" },
];

const milestones = [
  { year: "2026", title: "The First Move", description: "Founded to solve a specific problem: allowing you to play legendary chess positions against a real opponent. What started as a personal frustration became a platform.", upcoming: false },
  { year: "", title: "The Next Chapter", description: "Expanding the position library, refining multiplayer matchmaking, and building tools that make chess history more accessible than ever.", upcoming: true },
  { year: "", title: "Building the Community", description: "Tournaments, rankings, and a space for players who share a love for the beauty of chess — coming soon.", upcoming: true },
];


export default function AboutPage() {
  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] w-full overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 min-w-full min-h-full w-auto h-auto opacity-20 object-cover grayscale"
        >
          <source src="/Kings_Gambit_Chess_Board_Animation.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-gradient-to-b from-cb-gradient-from via-transparent to-cb-gradient-from" />
        <div className="absolute inset-0 bg-gradient-to-r from-cb-backdrop via-transparent to-cb-backdrop" />

        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }}
        />

        {/* Decorative corners */}
        <div className="absolute top-20 left-8 w-32 h-32 border-l border-t border-cb-border" />
        <div className="absolute bottom-20 right-8 w-32 h-32 border-r border-b border-cb-border" />

        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-4">
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
              Our Story
            </span>
            <div className="h-px w-12 bg-cb-text-muted" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl mb-6 text-cb-text leading-[0.95]"
          >
            Where Legends
            <br />
            <span className="text-cb-text-muted">Meet the Board</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-lg sm:text-xl text-cb-text-muted max-w-2xl"
          >
            We&apos;re on a mission to make chess history interactive, immersive, and unforgettable.
          </motion.p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="relative py-20 sm:py-32 px-6">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div className="max-w-6xl mx-auto relative grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl lg:text-5xl text-cb-text-secondary italic leading-snug"
            >
              &ldquo;Every great chess game tells a story. We built a platform where you can live those stories.&rdquo;
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-base leading-relaxed mb-6"
            >
              ReplayChess was born from a simple idea: the greatest moments in chess history shouldn&apos;t just be
              studied — they should be experienced. We believe that stepping into the shoes of Kasparov, Fischer, or
              Carlsen at the critical moment of a legendary game is the most powerful way to learn and appreciate chess.
            </p>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-base leading-relaxed"
            >
              Our platform combines real-time multiplayer gaming with a curated library of historic positions,
              AI-powered analysis, and a community of passionate players who share our love for the royal game.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="relative px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-cb-surface-elevated">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="bg-cb-bg p-8 text-center"
              >
                <p
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-4xl sm:text-5xl text-cb-text mb-2"
                >
                  {stat.value}
                </p>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
                >
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="relative py-20 sm:py-32 px-6">
        <div className="max-w-6xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Our Journey
              </span>
              <div className="h-px w-16 bg-cb-border-strong" />
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text"
            >
              Milestones
            </h2>
          </motion.div>

          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 sm:left-8 top-0 bottom-0 w-px bg-cb-surface-elevated" />

            <div className="space-y-12">
              {milestones.map((milestone, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className={cn(
                    "relative pl-16 sm:pl-24",
                    milestone.upcoming && "opacity-40"
                  )}
                >
                  {/* Dot */}
                  <div className={cn(
                    "absolute left-[13px] sm:left-[29px] top-1 w-2 h-2",
                    milestone.upcoming ? "border border-dashed border-cb-text-muted" : "bg-cb-text"
                  )} />

                  {milestone.year && (
                    <p
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="text-xs text-cb-text-muted mb-1"
                    >
                      {milestone.year}
                    </p>
                  )}
                  {milestone.upcoming && (
                    <p
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="text-xs text-cb-text-muted mb-1"
                    >
                      Coming Soon
                    </p>
                  )}
                  <h3
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className={cn(
                      "text-xl sm:text-2xl mb-2",
                      milestone.upcoming ? "text-cb-text-secondary" : "text-cb-text"
                    )}
                  >
                    {milestone.title}
                  </h3>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-cb-text-muted leading-relaxed max-w-lg"
                  >
                    {milestone.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Founder */}
      <section className="relative py-20 sm:py-32 px-6">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div className="max-w-6xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                The Founder
              </span>
              <div className="h-px w-16 bg-cb-border-strong" />
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text"
            >
              Behind the Board
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-md mx-auto"
          >
            <div className="group relative bg-cb-bg border border-cb-border p-8 text-center">
              <div className="relative w-28 h-28 mx-auto mb-6 overflow-hidden">
                <Image
                  src="/rohit-pandit.jpeg"
                  alt="Rohit Pandit"
                  fill
                  className="object-cover"
                />
              </div>
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-lg font-semibold text-cb-text mb-1"
              >
                Rohit Pandit
              </h3>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-cb-text-muted uppercase tracking-widest mb-6"
              >
                Software Developer / Indie Hacker
              </p>
              <p
                style={{ fontFamily: "'Instrument Serif', serif" }}
                className="text-lg text-cb-text-secondary italic leading-relaxed"
              >
                &ldquo;I like to solve the problems I&apos;ve faced in my life — for everyone else.&rdquo;
              </p>

              {/* Corner accents */}
              <div className="absolute top-4 right-4 w-8 h-8 border-t border-r border-cb-border" />
              <div className="absolute bottom-4 left-4 w-8 h-8 border-b border-l border-cb-border" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-20 sm:py-32 px-6">
        <div className="max-w-3xl mx-auto text-center relative">
          {/* Decorative corners */}
          <div className="absolute -top-8 -left-8 w-24 h-24 border-l border-t border-cb-border" />
          <div className="absolute -bottom-8 -right-8 w-24 h-24 border-r border-b border-cb-border" />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text mb-6"
            >
              Join Our Team
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-lg mb-8 max-w-xl mx-auto"
            >
              We&apos;re always looking for passionate people who love chess and building great products.
            </p>
            <Link href="/careers">
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
                  View Open Positions
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
