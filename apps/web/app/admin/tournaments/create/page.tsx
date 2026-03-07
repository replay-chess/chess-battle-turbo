"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Navbar } from "@/app/components/Navbar";
import TimeControlSelector, { type TimeControlValue } from "@/app/components/TimeControlSelector";
import SearchableDropdown from "@/app/components/SearchableDropdown";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TournamentShareModal } from "./TournamentShareModal";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;
const serifFont = { fontFamily: "'Instrument Serif', serif" } as const;

interface OpeningItem {
  id: string;
  name: string;
  eco: string;
}

interface LegendItem {
  id: string;
  referenceId: string;
  name: string;
  era: string;
}

const durationPresets = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "2 hr", value: 120 },
  { label: "Custom", value: -1 },
];

const modeOptions = [
  { value: "FREE", label: "Free", description: "Random positions each game" },
  { value: "OPENING", label: "Same Opening", description: "All games start from the same opening" },
  { value: "LEGEND", label: "Legend Games", description: "Games from a specific chess legend" },
  { value: "ENDGAME", label: "Endgame", description: "All games start from an endgame position" },
] as const;

export default function CreateTournamentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<string>("FREE");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customDuration, setCustomDuration] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [timeControl, setTimeControl] = useState<TimeControlValue>({
    mode: "Blitz",
    control: "5 | 5",
    time: 300,
    increment: 5,
  });

  // Mode-specific selections
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [createdRef, setCreatedRef] = useState<string | null>(null);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);
  const [selectedLegend, setSelectedLegend] = useState<string | null>(null);

  // Data for dropdowns
  const [openings, setOpenings] = useState<OpeningItem[]>([]);
  const [legends, setLegends] = useState<LegendItem[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      fetch("/api/openings").then((r) => r.json()),
      fetch("/api/legends").then((r) => r.json()),
    ]).then(([openingsResult, legendsResult]) => {
      if (openingsResult.status === "fulfilled" && openingsResult.value.data?.openings) {
        setOpenings(openingsResult.value.data.openings);
      }
      if (legendsResult.status === "fulfilled" && legendsResult.value.data?.legends) {
        setLegends(legendsResult.value.data.legends);
      }
      setIsLoadingData(false);
    });
  }, []);

  const isCustomDuration = durationMinutes === -1;
  const effectiveDuration = isCustomDuration ? (parseInt(customDuration, 10) || 60) : durationMinutes;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        mode,
        durationMinutes: effectiveDuration,
        initialTimeSeconds: timeControl.time,
        incrementSeconds: timeControl.increment,
      };

      if (maxParticipants) {
        body.maxParticipants = parseInt(maxParticipants, 10);
      }
      if (mode === "OPENING" && selectedOpening) {
        body.openingReferenceId = selectedOpening;
      }
      if (mode === "LEGEND" && selectedLegend) {
        body.legendReferenceId = selectedLegend;
      }

      body.scheduledStartAt = new Date(scheduledStartAt).toISOString();

      const res = await fetch("/api/tournament/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setCreatedRef(data.data.referenceId);
      } else {
        logger.error("Failed to create tournament:", data.error);
      }
    } catch (error) {
      logger.error("Error creating tournament:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-black pt-20 md:pt-28 relative">
        <div
          className="fixed inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-2xl mx-auto px-4 py-8 z-10">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link
              href="/admin/tournaments"
              className="p-2 border border-white/10 hover:border-white/30 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-white/60" />
            </Link>
            <div>
              <h1 style={serifFont} className="text-3xl text-white">
                Create Tournament
              </h1>
              <p style={geistFont} className="text-white/40 text-sm">
                Configure a new time-boxed tournament
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Tournament Name */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Tournament Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Friday Night Blitz"
                style={geistFont}
                className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-3 outline-none focus:border-white/30 placeholder:text-white/20 transition-colors"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Casual blitz for all skill levels"
                maxLength={50}
                style={geistFont}
                className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-3 outline-none focus:border-white/30 placeholder:text-white/20 transition-colors"
                required
              />
              <p style={geistFont} className="text-white/20 text-xs mt-1 text-right">
                {description.length}/50
              </p>
            </div>

            {/* Duration */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Tournament Duration
              </label>
              <div className="flex gap-2">
                {durationPresets.map((preset) =>
                  preset.value === -1 && isCustomDuration ? (
                    <div
                      key={preset.value}
                      className="flex-1 flex items-center border border-white bg-white/10 overflow-hidden"
                    >
                      <input
                        type="number"
                        value={customDuration}
                        onChange={(e) => setCustomDuration(e.target.value)}
                        placeholder="60"
                        min="5"
                        max="480"
                        autoFocus
                        className="w-full bg-transparent text-white text-sm font-medium px-2 py-2.5 outline-none text-center tabular-nums placeholder:text-white/30"
                        style={geistFont}
                      />
                      <span style={geistFont} className="text-white/40 text-xs pr-2.5 shrink-0">
                        min
                      </span>
                    </div>
                  ) : (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        setDurationMinutes(preset.value);
                        if (preset.value !== -1) setCustomDuration("");
                      }}
                      className={cn(
                        "flex-1 px-3 py-2.5 text-sm font-medium transition-all duration-200 border",
                        durationMinutes === preset.value
                          ? "bg-white text-black border-white"
                          : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border-white/10"
                      )}
                      style={geistFont}
                    >
                      {preset.label}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Game Mode */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Game Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {modeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={cn(
                      "p-3 border text-left transition-all duration-200",
                      mode === opt.value
                        ? "border-white/40 bg-white/10"
                        : "border-white/10 hover:border-white/20 bg-transparent"
                    )}
                  >
                    <span style={geistFont} className="block text-sm text-white font-medium">
                      {opt.label}
                    </span>
                    <span style={geistFont} className="block text-xs text-white/40 mt-0.5">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Mode-specific selectors */}
            {mode === "OPENING" && (
              <div>
                <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                  Select Opening
                </label>
                <SearchableDropdown
                  items={openings}
                  selectedId={selectedOpening}
                  onSelect={setSelectedOpening}
                  getLabel={(o) => o.name}
                  getSubLabel={(o) => o.eco}
                  getId={(o) => o.id}
                  placeholder="Search openings..."
                  isLoading={isLoadingData}
                />
              </div>
            )}

            {mode === "LEGEND" && (
              <div>
                <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                  Select Legend
                </label>
                <SearchableDropdown
                  items={legends}
                  selectedId={selectedLegend}
                  onSelect={setSelectedLegend}
                  getLabel={(l) => l.name}
                  getSubLabel={(l) => l.era}
                  getId={(l) => l.id}
                  placeholder="Search legends..."
                  isLoading={isLoadingData}
                />
              </div>
            )}

            {/* Time Control */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Time Control (per game)
              </label>
              <TimeControlSelector value={timeControl} onChange={setTimeControl} />
            </div>

            {/* Scheduled Start Time */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Scheduled Start Time
              </label>
              <input
                type="datetime-local"
                value={scheduledStartAt}
                onChange={(e) => setScheduledStartAt(e.target.value)}
                required
                style={geistFont}
                className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-3 outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
              />
            </div>

            {/* Max Participants */}
            <div>
              <label style={geistFont} className="block text-white/60 text-xs tracking-wider uppercase mb-2">
                Max Participants (optional)
              </label>
              <input
                type="number"
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                placeholder="No limit"
                min="2"
                max="256"
                style={geistFont}
                className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-3 outline-none focus:border-white/30 placeholder:text-white/20 transition-colors"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !description.trim() || !scheduledStartAt}
              className={cn(
                "w-full py-3 text-sm font-medium tracking-wide transition-all duration-300",
                isSubmitting || !name.trim() || !description.trim() || !scheduledStartAt
                  ? "bg-white/10 text-white/30 cursor-not-allowed"
                  : "bg-white text-black hover:bg-white/90"
              )}
              style={geistFont}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create Tournament"
              )}
            </button>
          </form>
        </div>
      </div>

      <TournamentShareModal
        isOpen={!!createdRef}
        referenceId={createdRef ?? ""}
        onGoToTournament={() => {
          if (createdRef) router.push(`/tournament/${createdRef}`);
        }}
      />
    </>
  );
}
