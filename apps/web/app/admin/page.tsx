"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import { Crown, ArrowRight, Trophy } from "lucide-react";
import { motion } from "motion/react";

// Chess piece icon component for positions card
function ChessPieceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Knight piece simplified */}
      <path d="M9 22h6" />
      <path d="M7 22l1-6h8l1 6" />
      <path d="M8 16V9a1 1 0 011-1h1l1-2h2l1 2h1a1 1 0 011 1v7" />
      <path d="M10 6V4a2 2 0 114 0v2" />
    </svg>
  );
}

interface Stats {
  legends: number;
  positions: number;
  tournaments: number;
}

interface FeatureCardProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  countLabel: string;
  isLoading: boolean;
}

function FeatureCard({
  href,
  icon,
  title,
  description,
  count,
  countLabel,
  isLoading,
}: FeatureCardProps) {
  return (
    <Link href={href}>
      <motion.div
        className={cn(
          "group relative border border-cb-border p-8",
          "hover:border-cb-border-strong transition-all duration-300",
          "cursor-pointer"
        )}
        whileHover={{ y: -4 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {/* Icon container */}
        <div className="w-14 h-14 border border-cb-border-strong flex items-center justify-center mb-6">
          {icon}
        </div>

        {/* Title */}
        <h2
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-2xl text-cb-text mb-2"
        >
          {title}
        </h2>

        {/* Description */}
        <p
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-cb-text-muted text-sm mb-6"
        >
          {description}
        </p>

        {/* Footer with count + arrow */}
        <div className="flex items-center justify-between">
          {isLoading ? (
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-xs tracking-wide"
            >
              Loading...
            </span>
          ) : (
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-xs tracking-wide"
            >
              {count} {countLabel}
            </span>
          )}
          <ArrowRight
            className={cn(
              "w-5 h-5 text-cb-text-muted",
              "group-hover:text-cb-text group-hover:translate-x-1",
              "transition-all duration-300"
            )}
            strokeWidth={1.5}
          />
        </div>

        {/* Hover gradient overlay */}
        <div
          className={cn(
            "absolute inset-0 opacity-0 group-hover:opacity-100",
            "bg-gradient-to-br from-cb-hover to-transparent",
            "transition-opacity duration-300 pointer-events-none"
          )}
        />
      </motion.div>
    </Link>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ legends: 0, positions: 0, tournaments: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [legendsRes, positionsRes, tournamentsRes] = await Promise.all([
          fetch("/api/legends"),
          fetch("/api/chess-positions"),
          fetch("/api/tournament?count=true"),
        ]);

        const legendsData = await legendsRes.json();
        const positionsData = await positionsRes.json();
        const tournamentsData = await tournamentsRes.json();

        setStats({
          legends: legendsData.data?.legends?.length || 0,
          positions: positionsData.data?.positions?.length || 0,
          tournaments: tournamentsData.data?.count || 0,
        });
      } catch (error) {
        logger.error("Failed to fetch stats:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-cb-bg pt-20 md:pt-28 relative">
        {/* Subtle grid background */}
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-cb-text-muted to-transparent" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-secondary text-[10px] tracking-[0.4em] uppercase"
              >
                Admin Panel
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-cb-text-muted to-transparent" />
            </div>

            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-4xl sm:text-5xl text-cb-text mb-2 text-center"
            >
              Dashboard
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-sm text-center"
            >
              Manage your chess platform
            </p>
          </div>

          {/* Separator */}
          <div className="border-t border-cb-border mb-8" />

          {/* Feature Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Legends Card */}
            <FeatureCard
              href="/admin/legends"
              icon={<Crown className="w-6 h-6 text-cb-text-secondary" strokeWidth={1.5} />}
              title="Manage Legends"
              description="Create and edit chess legends for the platform"
              count={stats.legends}
              countLabel="legends"
              isLoading={isLoading}
            />

            {/* Positions Card */}
            <FeatureCard
              href="/admin/chess-positions"
              icon={<ChessPieceIcon className="w-6 h-6 text-cb-text-secondary" />}
              title="Chess Positions"
              description="Add and manage chess positions for battles"
              count={stats.positions}
              countLabel="positions"
              isLoading={isLoading}
            />

            {/* Tournaments Card */}
            <FeatureCard
              href="/admin/tournaments"
              icon={<Trophy className="w-6 h-6 text-cb-text-secondary" strokeWidth={1.5} />}
              title="Tournaments"
              description="Create and manage time-boxed tournaments"
              count={stats.tournaments}
              countLabel="tournaments"
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* Decorative corner elements */}
        <div className="fixed top-20 left-6 w-12 h-12 border-l border-t border-cb-border pointer-events-none" />
        <div className="fixed bottom-6 right-6 w-12 h-12 border-r border-b border-cb-border pointer-events-none" />
      </div>
    </>
  );
}
