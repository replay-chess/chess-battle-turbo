"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useUserStore } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { Navbar } from "../../components/Navbar";
import { ThemeToggle } from "../../components/ThemeToggle";
import { ProfileHero } from "./ProfileHero";
import { StatsOverview } from "./StatsOverview";
import { GameHistory } from "./GameHistory";
import { ChessComConnectModal } from "./ChessComConnectModal";

interface ProfileUser {
  referenceId: string;
  code: string;
  name: string;
  profilePictureUrl: string | null;
  createdAt: string;
}

interface ProfileStats {
  totalGamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  winRate: number;
  currentWinStreak: number;
  longestWinStreak: number;
  averageGameDuration: number | null;
  lastPlayedAt: string | null;
}

interface ProfileChessComProfile {
  chessComHandle: string;
  rapidRating: number | null;
  rapidBestRating: number | null;
  blitzRating: number | null;
  blitzBestRating: number | null;
  bulletRating: number | null;
  bulletBestRating: number | null;
  dailyRating: number | null;
  dailyBestRating: number | null;
  lastSyncedAt: string;
}

interface ProfileGame {
  referenceId: string;
  opponent: {
    name: string;
    profilePictureUrl: string | null;
    code: string;
  } | null;
  outcome: "win" | "loss" | "draw";
  result: string;
  timeControl: string;
  completedAt: string | null;
}

interface ProfileData {
  user: ProfileUser;
  stats: ProfileStats | null;
  chessComProfile: ProfileChessComProfile | null;
  games: ProfileGame[];
}

const ProfilePage = ({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) => {
  const router = useRouter();
  const { referenceId } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Read current user's referenceId from store instead of fetching
  const currentUserRefId = useUserStore((s) => s.user?.referenceId ?? null);

  const fetchProfile = async () => {
    try {
      const response = await fetch(`/api/profile/${referenceId}`);
      const result = await response.json();

      if (!result.success) {
        setError(result.error || "Profile not found");
        return;
      }

      setData(result.data);
    } catch {
      setError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [referenceId]);

  const isOwnProfile = currentUserRefId === referenceId;

  const handleConnectSuccess = () => {
    setShowConnectModal(false);
    // Re-fetch profile data to show the new chess.com ratings
    fetchProfile();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cb-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border border-cb-border-strong border-t-cb-text-secondary rounded-full animate-spin mb-6" />
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-xs tracking-[0.2em] uppercase"
          >
            Loading Profile
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-cb-bg flex items-center justify-center">
        <div className="text-center">
          <span className="text-cb-text-faint text-6xl block mb-6">♔</span>
          <p
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-cb-text text-xl mb-2"
          >
            {error || "Profile not found"}
          </p>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-sm mb-8"
          >
            This player may not exist or their profile is unavailable
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2.5 border border-cb-border-strong text-cb-text-secondary hover:border-cb-border-strong hover:text-cb-text transition-colors duration-300"
            style={{ fontFamily: "'Geist', sans-serif" }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Subtle grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 md:pt-28 pb-16">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6 sm:space-y-8"
        >
          {/* Hero / Identity Card with integrated chess.com ratings */}
          <ProfileHero user={data.user} chessComProfile={data.chessComProfile} />

          {/* Theme toggle — own profile only */}
          {isOwnProfile && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <ThemeToggle />
            </motion.div>
          )}

          {/* Chess.com warning banner for own profile */}
          {isOwnProfile && !data.chessComProfile && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="border border-dashed border-cb-border-strong bg-cb-hover p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6"
            >
              <div className="flex items-center gap-4 flex-1">
                <span className="text-cb-text-faint text-3xl flex-shrink-0">♟</span>
                <div>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-secondary text-sm font-medium"
                  >
                    Connect your chess.com account
                  </p>
                  <p
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-cb-text-muted text-xs mt-0.5"
                  >
                    Display your ratings and stats on your profile
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowConnectModal(true)}
                className={cn(
                  "group relative flex items-center gap-2 px-5 py-2.5",
                  "bg-cb-accent text-cb-accent-fg",
                  "transition-all duration-300 overflow-hidden",
                  "flex-shrink-0"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
                <span className="relative z-10 text-sm font-medium group-hover:text-cb-text transition-colors duration-300">
                  Connect
                </span>
                <ArrowRight
                  className="w-3.5 h-3.5 relative z-10 group-hover:text-cb-text transition-colors duration-300"
                  strokeWidth={1.5}
                />
              </button>
            </motion.div>
          )}

          {/* Stats Overview */}
          <StatsOverview stats={data.stats} />

          {/* Game History */}
          <GameHistory games={data.games} />
        </motion.div>
      </div>

      {/* Connect modal */}
      <ChessComConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onSuccess={handleConnectSuccess}
      />
    </div>
  );
};

export default ProfilePage;
