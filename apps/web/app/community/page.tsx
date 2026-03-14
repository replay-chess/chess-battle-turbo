"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight, Users, Trophy, Star } from "lucide-react";
import Link from "next/link";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

const tournaments = [
  { name: "Winter Open 2026", date: "Jan 15-17, 2026", participants: 256, status: "Completed" },
  { name: "Speed Chess Championship", date: "Feb 22, 2026", participants: 128, status: "Upcoming" },
  { name: "Legendary Positions Cup", date: "Mar 8-10, 2026", participants: 64, status: "Upcoming" },
];

const spotlights = [
  { piece: "♔", username: "GrandmasterX", rating: 2450, achievement: "Winter Open Champion" },
  { piece: "♕", username: "QueenGambit99", rating: 2280, achievement: "Longest Win Streak: 23" },
  { piece: "♗", username: "BishopPair", rating: 2190, achievement: "Most Games Played: 1,200" },
];

const leaderboard = [
  { rank: 1, player: "GrandmasterX", rating: 2450, winRate: "72%", games: 847 },
  { rank: 2, player: "QueenGambit99", rating: 2280, winRate: "68%", games: 1203 },
  { rank: 3, player: "BishopPair", rating: 2190, winRate: "65%", games: 1200 },
  { rank: 4, player: "KnightRider42", rating: 2150, winRate: "63%", games: 956 },
  { rank: 5, player: "RookEndgame", rating: 2120, winRate: "61%", games: 789 },
];

export default function CommunityPage() {
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
        <div className="max-w-7xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Community
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
            >
              Join the ReplayChess
              <br />
              <span className="text-cb-text-muted">Community</span>
            </h1>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-center gap-2 mt-6"
            >
              <Users className="w-4 h-4 text-cb-text-muted" />
              <span
                style={{ fontFamily: "'Geist Mono', monospace" }}
                className="text-sm text-cb-text-muted"
              >
                10,000+ members
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Discord Card */}
      <section className="relative py-16 sm:py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="border border-cb-border p-8 sm:p-12 relative overflow-hidden"
          >
            <div className="absolute top-4 right-4 w-16 h-16 border-t border-r border-cb-border" />
            <div className="absolute bottom-4 left-4 w-16 h-16 border-b border-l border-cb-border" />

            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-8">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-cb-hover border border-cb-border flex items-center justify-center">
                    <span className="text-2xl">💬</span>
                  </div>
                  <div>
                    <h2
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-2xl sm:text-3xl text-cb-text"
                    >
                      Join Our Discord
                    </h2>
                    <p
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="text-xs text-cb-text-muted"
                    >
                      3,200 members online
                    </p>
                  </div>
                </div>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-cb-text-muted leading-relaxed max-w-lg"
                >
                  Connect with fellow players, share strategies, find opponents for friendly matches, and stay updated on
                  tournaments and events.
                </p>
              </div>
              <button
                className={cn(
                  "group relative overflow-hidden",
                  "bg-cb-accent text-cb-accent-fg",
                  "px-8 py-3",
                  "text-sm font-semibold tracking-[0.1em] uppercase",
                  "transition-all duration-300 flex-shrink-0"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-2 group-hover:text-cb-text transition-colors duration-300">
                  Join Server
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Tournaments */}
      <section className="relative py-16 sm:py-24 px-6">
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
            className="text-center mb-12"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-16 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Compete
              </span>
              <div className="h-px w-16 bg-cb-border-strong" />
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text"
            >
              Tournaments
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tournaments.map((tournament, index) => (
              <motion.div
                key={tournament.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="border border-cb-border p-6 hover:border-cb-border-strong transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <Trophy className="w-5 h-5 text-cb-text-muted" strokeWidth={1.5} />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className={cn(
                      "text-[10px] px-2 py-0.5 border uppercase tracking-wider",
                      tournament.status === "Completed"
                        ? "border-cb-border text-cb-text-muted"
                        : "border-emerald-500/30 text-emerald-400/70"
                    )}
                  >
                    {tournament.status}
                  </span>
                </div>
                <h3
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-xl text-cb-text mb-2"
                >
                  {tournament.name}
                </h3>
                <p
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-muted mb-1"
                >
                  {tournament.date}
                </p>
                <p
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                  className="text-xs text-cb-text-faint"
                >
                  {tournament.participants} players
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Player Spotlights */}
      <section className="relative py-16 sm:py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text"
            >
              Player Spotlights
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-cb-surface-elevated">
            {spotlights.map((player, index) => (
              <motion.div
                key={player.username}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={cn(
                  "group bg-cb-bg p-8 text-center",
                  "hover:bg-cb-accent transition-colors duration-500"
                )}
              >
                <span className="text-5xl mb-4 block">{player.piece}</span>
                <h3
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-lg font-semibold text-cb-text group-hover:text-cb-accent-fg transition-colors duration-500 mb-1"
                >
                  {player.username}
                </h3>
                <p
                  style={{ fontFamily: "'Geist Mono', monospace" }}
                  className="text-sm text-cb-text-muted group-hover:text-cb-accent-fg/40 transition-colors duration-500 mb-3"
                >
                  {player.rating}
                </p>
                <div className="flex items-center justify-center gap-1.5">
                  <Star className="w-3 h-3 text-cb-text-faint group-hover:text-cb-accent-fg/20 transition-colors duration-500" />
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-xs text-cb-text-muted group-hover:text-cb-accent-fg/40 transition-colors duration-500"
                  >
                    {player.achievement}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Leaderboard */}
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
                Rankings
              </span>
              <div className="h-px w-16 bg-cb-border-strong" />
            </div>
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text"
            >
              Leaderboard
            </h2>
          </motion.div>

          <div className="border border-cb-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cb-border">
                  <th
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="p-4 text-left text-xs text-cb-text-muted uppercase tracking-widest bg-cb-hover"
                  >
                    Rank
                  </th>
                  <th
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="p-4 text-left text-xs text-cb-text-muted uppercase tracking-widest bg-cb-hover"
                  >
                    Player
                  </th>
                  <th
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="p-4 text-right text-xs text-cb-text-muted uppercase tracking-widest bg-cb-hover"
                  >
                    Rating
                  </th>
                  <th
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="p-4 text-right text-xs text-cb-text-muted uppercase tracking-widest bg-cb-hover hidden sm:table-cell"
                  >
                    Win Rate
                  </th>
                  <th
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="p-4 text-right text-xs text-cb-text-muted uppercase tracking-widest bg-cb-hover hidden sm:table-cell"
                  >
                    Games
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.rank} className="border-b border-cb-border hover:bg-cb-hover transition-colors">
                    <td
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="p-4 text-cb-text-secondary"
                    >
                      #{row.rank}
                    </td>
                    <td
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="p-4 text-cb-text font-medium"
                    >
                      {row.player}
                    </td>
                    <td
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="p-4 text-right text-cb-text-secondary"
                    >
                      {row.rating}
                    </td>
                    <td
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="p-4 text-right text-cb-text-muted hidden sm:table-cell"
                    >
                      {row.winRate}
                    </td>
                    <td
                      style={{ fontFamily: "'Geist Mono', monospace" }}
                      className="p-4 text-right text-cb-text-muted hidden sm:table-cell"
                    >
                      {row.games}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Guidelines CTA */}
      <section className="relative py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-sm mb-4"
            >
              Please review our community guidelines to help keep ReplayChess a welcoming place for everyone.
            </p>
            <Link
              href="/help"
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-secondary hover:text-cb-text text-sm underline transition-colors"
            >
              Read Community Guidelines
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
