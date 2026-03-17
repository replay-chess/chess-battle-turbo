"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Loader2, Search, X } from "lucide-react";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;

interface FindMatchButtonProps {
  tournamentReferenceId: string;
  isActive: boolean;
}

export default function FindMatchButton({
  tournamentReferenceId,
  isActive,
}: FindMatchButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "searching" | "matched">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function findMatch() {
    setStatus("searching");
    setError(null);

    try {
      const res = await fetch("/api/tournament/find-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to find match");
        setStatus("idle");
        return;
      }

      if (data.data.status === "MATCHED") {
        setStatus("matched");
        router.push(`/game/${data.data.gameReferenceId}`);
        return;
      }

      if (data.data.status === "IN_GAME") {
        router.push(`/game/${data.data.gameReferenceId}`);
        return;
      }

      // Status is SEARCHING - start polling
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch("/api/tournament/find-match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tournamentReferenceId }),
          });

          const pollData = await pollRes.json();

          if (pollData.data?.status === "MATCHED") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("matched");
            router.push(`/game/${pollData.data.gameReferenceId}`);
          } else if (pollData.data?.status === "IN_GAME") {
            if (pollRef.current) clearInterval(pollRef.current);
            router.push(`/game/${pollData.data.gameReferenceId}`);
          }
        } catch {
          // Polling error - continue trying
        }
      }, 2000 + Math.random() * 2000);
    } catch {
      setError("Connection error");
      setStatus("idle");
    }
  }

  async function cancelSearch() {
    if (pollRef.current) clearInterval(pollRef.current);

    try {
      await fetch("/api/tournament/cancel-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentReferenceId }),
      });
    } catch {
      // Ignore cancel errors
    }

    setStatus("idle");
  }

  if (!isActive) return null;

  return (
    <div className="space-y-2">
      {status === "idle" && (
        <button
          data-testid="find-match-button"
          onClick={findMatch}
          className={cn(
            "w-full py-3 text-sm font-medium tracking-wide transition-all duration-300",
            "bg-cb-accent text-cb-accent-fg hover:opacity-90"
          )}
          style={geistFont}
        >
          <span className="flex items-center justify-center gap-2">
            <Search className="w-4 h-4" />
            Find Match
          </span>
        </button>
      )}

      {status === "searching" && (
        <div className="space-y-2">
          <div
            data-testid="find-match-searching"
            className="w-full py-3 text-center text-sm font-medium tracking-wide bg-cb-surface-elevated text-cb-text"
            style={geistFont}
          >
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching for opponent...
            </span>
          </div>
          <button
            data-testid="find-match-cancel"
            onClick={cancelSearch}
            className={cn(
              "w-full py-2 text-sm tracking-wide border border-cb-border text-cb-text-secondary",
              "hover:border-cb-border-strong hover:text-cb-text transition-all duration-300"
            )}
            style={geistFont}
          >
            <span className="flex items-center justify-center gap-2">
              <X className="w-3.5 h-3.5" />
              Cancel
            </span>
          </button>
        </div>
      )}

      {status === "matched" && (
        <div
          className="w-full py-3 text-center text-sm font-medium tracking-wide bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
          style={geistFont}
        >
          Match found! Redirecting...
        </div>
      )}

      {error && (
        <p style={geistFont} className="text-red-400 text-xs text-center">
          {error}
        </p>
      )}
    </div>
  );
}
