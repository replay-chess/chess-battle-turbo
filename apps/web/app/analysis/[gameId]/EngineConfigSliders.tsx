"use client";

import { cn } from "../../../lib/utils";

interface EngineConfigSlidersProps {
  skillLevel: number; // 0-20
  depth: number; // 1-20
  searchTimeSec: number; // 1-30 seconds (0 = unlimited)
  onSkillLevelChange: (value: number) => void;
  onDepthChange: (value: number) => void;
  onSearchTimeChange: (value: number) => void;
  multiPvCount?: number; // 0-5
  onMultiPvCountChange?: (value: number) => void;
  compact?: boolean; // true for mobile
}

const SKILL_LEVEL_MIN = 0;
const SKILL_LEVEL_MAX = 20;
const DEPTH_MIN = 1;
const DEPTH_MAX = 20;
const SEARCH_TIME_MIN = 0;
const SEARCH_TIME_MAX = 30;
const MULTI_PV_MIN = 0;
const MULTI_PV_MAX = 5;

function getApproxElo(skillLevel: number): number {
  return 600 + skillLevel * 80;
}

function formatSearchTime(sec: number): string {
  if (sec === 0) return "Unlimited";
  return `${sec}s`;
}

function formatMultiPv(count: number): string {
  if (count === 0) return "Off";
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

const SLIDER_CLASS =
  "w-full h-2 bg-cb-surface-elevated rounded-full appearance-none cursor-pointer touch-action-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(251,191,36,0.5)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-amber-400 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:active:cursor-grabbing";

export default function EngineConfigSliders({
  skillLevel,
  depth,
  searchTimeSec,
  onSkillLevelChange,
  onDepthChange,
  onSearchTimeChange,
  multiPvCount,
  onMultiPvCountChange,
  compact = false,
}: EngineConfigSlidersProps) {
  return (
    <div className={cn("space-y-3", compact ? "px-3 py-2" : "")}>
      {/* Skill Level Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
          >
            Skill Level
          </label>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-amber-400/70 font-mono"
          >
            {skillLevel} (~{getApproxElo(skillLevel)} ELO)
          </span>
        </div>
        <input
          type="range"
          min={SKILL_LEVEL_MIN}
          max={SKILL_LEVEL_MAX}
          value={skillLevel}
          onChange={(e) => onSkillLevelChange(parseInt(e.target.value, 10))}
          className={SLIDER_CLASS}
        />
      </div>

      {/* Search Depth Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
          >
            Search Depth
          </label>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-secondary font-mono"
          >
            {depth} {depth === 1 ? "move" : "moves"} ahead
          </span>
        </div>
        <input
          type="range"
          min={DEPTH_MIN}
          max={DEPTH_MAX}
          value={depth}
          onChange={(e) => onDepthChange(parseInt(e.target.value, 10))}
          className={SLIDER_CLASS}
        />
        {depth > 12 && (
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[9px] text-amber-400/50 mt-1"
          >
            Higher depths may be slow
          </p>
        )}
      </div>

      {/* Search Time Limit Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
          >
            Search Time
          </label>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-[10px] text-cb-text-secondary font-mono"
          >
            {formatSearchTime(searchTimeSec)}
          </span>
        </div>
        <input
          type="range"
          min={SEARCH_TIME_MIN}
          max={SEARCH_TIME_MAX}
          value={searchTimeSec}
          onChange={(e) => onSearchTimeChange(parseInt(e.target.value, 10))}
          className={SLIDER_CLASS}
        />
      </div>

      {/* Engine Lines (MultiPV) Slider */}
      {multiPvCount !== undefined && onMultiPvCountChange && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.2em] uppercase text-cb-text-muted"
            >
              Engine Lines
            </label>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] text-amber-400/70 font-mono"
            >
              {formatMultiPv(multiPvCount)}
            </span>
          </div>
          <input
            type="range"
            min={MULTI_PV_MIN}
            max={MULTI_PV_MAX}
            value={multiPvCount}
            onChange={(e) => onMultiPvCountChange(parseInt(e.target.value, 10))}
            className={SLIDER_CLASS}
          />
        </div>
      )}
    </div>
  );
}
