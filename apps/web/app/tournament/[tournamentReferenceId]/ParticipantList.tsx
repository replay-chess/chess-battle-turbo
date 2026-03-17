"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { TournamentData } from "@/lib/hooks/useTournamentLobby";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;

type Participant = TournamentData["participants"][number];

interface ParticipantListProps {
  participants: Participant[];
  participantCount: number;
  tournamentReferenceId: string;
}

export default function ParticipantList({
  participants,
  participantCount,
  tournamentReferenceId,
}: ParticipantListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Participant[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tournament/${tournamentReferenceId}?search=${encodeURIComponent(searchQuery.trim())}`
        );
        const data = await res.json();
        if (data.success && data.searchResults) {
          setSearchResults(data.searchResults);
        }
      } catch {
        // ignore
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, tournamentReferenceId]);

  const displayParticipants = searchResults ?? participants.slice(0, 30);

  return (
    <div className="border border-cb-border">
      <div className="px-4 py-3 border-b border-cb-border">
        <h2 style={geistFont} className="text-sm font-medium text-cb-text-secondary tracking-wider uppercase">
          Participants ({participantCount.toLocaleString()})
        </h2>
      </div>

      {/* Search */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cb-text-muted" />
          <input
            type="text"
            placeholder="Search players..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border border-cb-border text-cb-text text-sm pl-9 pr-9 py-2 outline-none placeholder:text-cb-text-muted focus:border-cb-border-strong transition-colors"
            style={geistFont}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-text-muted hover:text-cb-text-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {isSearching ? (
          <p style={geistFont} className="text-cb-text-muted text-sm text-center py-4">
            Searching...
          </p>
        ) : displayParticipants.length === 0 ? (
          <p style={geistFont} className="text-cb-text-muted text-sm text-center py-4">
            {searchQuery ? "No players found" : "No participants yet"}
          </p>
        ) : (
          <>
            {searchQuery && searchResults && (
              <p style={geistFont} className="text-cb-text-muted text-xs mb-3 uppercase tracking-wider">
                Search Results
              </p>
            )}
            <div className="divide-y divide-cb-border">
              {displayParticipants.map((p) => (
                <Link
                  key={p.referenceId}
                  href={`/profile/${p.user.referenceId}`}
                  className="flex items-center gap-3 px-2 py-2.5 hover:bg-cb-hover transition-colors"
                >
                  {p.user.profilePictureUrl ? (
                    <Image
                      src={p.user.profilePictureUrl}
                      alt={p.user.name}
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 bg-cb-surface-elevated rounded-full shrink-0" />
                  )}
                  <span style={geistFont} className="text-sm text-cb-text truncate">
                    {p.user.name}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
