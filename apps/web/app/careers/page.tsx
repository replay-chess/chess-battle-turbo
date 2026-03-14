"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight, Mail } from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

export default function CareersPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    // Opens the user's mail client with a pre-filled subject
    window.location.href = `mailto:careers@playchess.tech?subject=Hiring Updates&body=Hi, I'd like to stay informed about future openings at ReplayChess. My email: ${encodeURIComponent(email)}`;
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Hero */}
      <section className="relative h-[70vh] min-h-[500px] w-full overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 min-w-full min-h-full w-auto h-auto opacity-15 object-cover grayscale"
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
              Careers
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
            Great Things
            <br />
            <span className="text-cb-text-muted">Take Time</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-base sm:text-lg text-cb-text-muted max-w-xl leading-relaxed"
          >
            We&apos;re not hiring right now — but that chapter is coming.
          </motion.p>
        </div>
      </section>

      {/* The Story */}
      <section className="relative py-24 sm:py-36 px-6">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div className="max-w-3xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-10"
          >
            {/* Section label */}
            <div className="flex items-center gap-4">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Where We Are Today
              </span>
            </div>

            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl md:text-5xl text-cb-text leading-[1.1]"
            >
              A company of one,
              <br />
              <span className="text-cb-text-muted">building for thousands.</span>
            </h2>

            <div className="space-y-6">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-base sm:text-lg text-cb-text-muted leading-[1.8]"
              >
                ReplayChess is a solo venture right now — every line of code, every
                pixel, every decision passes through a single pair of hands. That&apos;s
                intentional. Before we grow the team, we&apos;re focused on getting the
                foundation exactly right.
              </p>
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-base sm:text-lg text-cb-text-muted leading-[1.8]"
              >
                The best chess games are won by players who take their time in the
                opening. We&apos;re still in that phase — setting up the pieces,
                preparing for the middle game where things get interesting.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* The Future */}
      <section className="relative py-24 sm:py-36 px-6 border-t border-cb-border">
        <div className="max-w-3xl mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-10"
          >
            {/* Section label */}
            <div className="flex items-center gap-4">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                What&apos;s Ahead
              </span>
            </div>

            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl md:text-5xl text-cb-text leading-[1.1]"
            >
              When we scale,
              <br />
              <span className="text-cb-text-muted">we&apos;ll need brilliant people.</span>
            </h2>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-base sm:text-lg text-cb-text-muted leading-[1.8]"
            >
              As ReplayChess expands into new markets and the platform grows beyond
              what one person can carry, we&apos;ll be looking for people who care
              deeply about craft — engineers, designers, community builders, and chess
              minds who want to shape the future of how the world experiences this game.
            </p>

            {/* Timeline hint */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-cb-surface-elevated">
              {[
                {
                  number: "01",
                  title: "Product–Market Fit",
                  description: "Nail the core experience for our first players.",
                },
                {
                  number: "02",
                  title: "New Markets",
                  description: "Bring ReplayChess to players around the globe.",
                },
                {
                  number: "03",
                  title: "Grow the Team",
                  description: "Hire exceptional people to accelerate the vision.",
                },
              ].map((step, index) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.12 }}
                  className="bg-cb-bg p-7 group hover:bg-cb-hover transition-colors duration-500"
                >
                  <span
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    className="text-4xl font-light text-cb-text-faint block mb-4"
                  >
                    {step.number}
                  </span>
                  <h3
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-semibold text-cb-text mb-2"
                  >
                    {step.title}
                  </h3>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm text-cb-text-muted leading-relaxed"
                  >
                    {step.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stay in the Loop — Email + Contact */}
      <section className="relative py-24 sm:py-36 px-6 border-t border-cb-border">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div className="max-w-2xl mx-auto text-center relative">
          {/* Decorative corners */}
          <div className="absolute -top-10 -left-10 w-28 h-28 border-l border-t border-cb-border hidden sm:block" />
          <div className="absolute -bottom-10 -right-10 w-28 h-28 border-r border-b border-cb-border hidden sm:block" />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-center gap-4 mb-2">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Stay Tuned
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>

            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl md:text-5xl text-cb-text"
            >
              Be the first to know
            </h2>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-base text-cb-text-muted leading-relaxed max-w-lg mx-auto"
            >
              Drop your email below and we&apos;ll reach out when we start hiring.
              No spam, no newsletters — just a heads-up when roles open.
            </p>

            {/* Email form */}
            {!submitted ? (
              <form
                onSubmit={handleSubmit}
                className="flex flex-col sm:flex-row items-stretch gap-3 max-w-md mx-auto pt-4"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className={cn(
                    "flex-1 bg-cb-hover border border-cb-border px-4 py-3",
                    "text-sm text-cb-text placeholder:text-cb-text-faint",
                    "outline-none focus:border-cb-border-strong transition-colors duration-300"
                  )}
                />
                <button
                  type="submit"
                  className={cn(
                    "group relative overflow-hidden",
                    "px-6 py-3 bg-cb-accent text-cb-accent-fg",
                    "text-sm font-medium",
                    "transition-all duration-300 flex items-center justify-center gap-2"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                  <span className="relative group-hover:text-cb-text transition-colors duration-300">
                    Notify Me
                  </span>
                  <ArrowRight className="relative w-3.5 h-3.5 group-hover:text-cb-text transition-colors duration-300" />
                </button>
              </form>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-4"
              >
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-emerald-400/80"
                >
                  We&apos;ll be in touch — thanks for your interest.
                </p>
              </motion.div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-4 pt-8">
              <div className="h-px flex-1 bg-cb-hover" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-faint text-[10px] tracking-[0.3em] uppercase"
              >
                or
              </span>
              <div className="h-px flex-1 bg-cb-hover" />
            </div>

            {/* Direct email */}
            <div className="pt-2">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-sm text-cb-text-muted mb-3"
              >
                Prefer to reach out directly? Write to us anytime.
              </p>
              <a
                href="mailto:careers@playchess.tech"
                className="inline-flex items-center gap-2 text-cb-text-secondary hover:text-cb-text transition-colors duration-300 group"
              >
                <Mail className="w-4 h-4" strokeWidth={1.5} />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm underline underline-offset-4 decoration-cb-border-strong group-hover:decoration-cb-text-secondary transition-all duration-300"
                >
                  careers@playchess.tech
                </span>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
