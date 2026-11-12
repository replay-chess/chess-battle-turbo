"use client";

// Narration controls (plan §4.1, §8.10; V3ReviewSummary): play/pause (aria-pressed), the progress bar, "0:07 / 0:18"
// and the speed chip 1× → 1.25× → 1.5×. Loaded with next/dynamic only where speechSynthesis exists (CoachLine).

import { BUTTONS } from "../copy";
import { useReview } from "../context";
import { narrationPct, narrationTime, rateLabel } from "../narration";
import { useNarration } from "../useNarration";

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export default function NarrationControls({ context }: { context: "summary" | "moment" }) {
  const { narrator } = useReview();
  const n = useNarration();
  if (!narrator) return null;
  const playing = n.status === "playing";
  const label = playing ? BUTTONS.pause : n.status === "paused" ? BUTTONS.resume : BUTTONS.listen;
  return (
    <div className="rv-narr" data-testid="narration" data-status={n.status} data-context={context}>
      <button
        type="button"
        className="rv-ib"
        data-round=""
        aria-label={label}
        title={label}
        aria-pressed={playing}
        onClick={() => narrator.toggle()}
        data-testid="narration-toggle"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="rv-bar" aria-hidden="true">
        <span style={{ width: `${narrationPct(n)}%` }} />
      </div>
      <span className="rv-narr__time rv-mono">{narrationTime(n)}</span>
      <button
        type="button"
        className="rv-chip"
        aria-label={`Playback speed ${rateLabel(n.rate)}`}
        onClick={() => narrator.cycleRate()}
        data-testid="narration-speed"
      >
        {rateLabel(n.rate)}
      </button>
    </div>
  );
}
