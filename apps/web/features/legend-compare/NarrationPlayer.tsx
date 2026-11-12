"use client";

// The static narration controls (phase-03 plan §4.6 Explanation; V3LegendCompare: a 48 px round Play/Pause, the
// `role="progressbar"` bar, "0:51 / 2:10 · narrated", the 0.75× / 1× / 1.5× speed group). Moved from the legacy
// AudioControls (app/analysis/[gameId]/AudioControls.tsx) and restyled to the DS: square group, Title Case labels,
// 44 px targets. When the audio fails: the warn banner "Audio unavailable. The text below is the same explanation."
// and Play disabled.
import { Banner } from "@/components/ui/banner";
import { clock } from "./model";
import { NARRATION_SPEEDS, type NarrationPlayer as Player } from "./useNarrationPlayer";

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function NarrationPlayer({ player }: { player: Player }) {
  const pct = player.duration > 0 ? Math.min(100, Math.round((player.time / player.duration) * 100)) : 0;
  return (
    <div className="flex flex-col gap-3" data-testid="compare-narration" data-playing={player.playing ? "" : undefined}>
      <div className="lc-player">
        <button
          type="button"
          className="lc-ib"
          data-round=""
          onClick={player.toggle}
          disabled={player.failed}
          aria-label={player.playing ? "Pause narration" : "Play narration"}
          data-testid="compare-narration-toggle"
        >
          <PlayIcon playing={player.playing} />
        </button>
        <div className="lc-player__mid">
          <div className="lc-bar" role="progressbar" aria-label="Narration progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }} data-testid="compare-narration-time">
            {clock(player.time)} / {clock(player.duration)} · narrated
          </span>
        </div>
        <div className="lc-seg" role="group" aria-label="Speed" data-hit="44">
          {NARRATION_SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={player.rate === s} onClick={() => player.setRate(s)} disabled={player.failed}>
              {`${s}×`}
            </button>
          ))}
        </div>
      </div>
      {player.failed ? (
        <Banner tone="warn" layout="note" data-testid="compare-audio-failed">
          Audio unavailable. The text below is the same explanation.
        </Banner>
      ) : null}
    </div>
  );
}
