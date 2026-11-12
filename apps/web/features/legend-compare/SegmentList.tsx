"use client";

// The narration's segments (phase-03 plan §4.6: "clicking a segment seeks and moves the board"; moved from the legacy
// SegmentList and NarrationDisplay). Each row is the segment's start time and its full text; the current one is
// inverted, and while the audio plays its spoken word carries the amber wash (rct-a §2.7: weight and a wash, never
// colour alone). The list is the explanation's text, so it stays readable when the audio fails.
import type { StaticExplanation } from "@repo/contracts/http/legend";
import { wordAt } from "./explanation";
import { clock } from "./model";

function SpokenText({ e, index, time }: { e: StaticExplanation; index: number; time: number }) {
  const seg = e.segments[index]!;
  const a = e.alignment;
  if (!a) return <>{seg.narration}</>;
  const on = wordAt(a, time);
  const words: { w: string; i: number }[] = [];
  a.words.forEach((w, i) => {
    const s = a.startTimes[i] ?? -1;
    if (s >= seg.startTime && s < seg.endTime) words.push({ w, i });
  });
  if (words.length === 0) return <>{seg.narration}</>;
  return (
    <>
      {words.map(({ w, i }, k) => (
        <span key={i}>
          <span className="lc-word" data-on={i === on ? "" : undefined} style={i === on ? { fontWeight: 600 } : undefined}>
            {w}
          </span>
          {k < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function SegmentList({
  explanation,
  current,
  playing,
  time,
  onPick,
}: {
  explanation: StaticExplanation;
  current: number;
  playing: boolean;
  time: number;
  onPick: (i: number) => void;
}) {
  return (
    <ol className="lc-segs" aria-label="Narration, part by part" data-testid="compare-segments">
      {explanation.segments.map((s, i) => (
        <li key={i}>
          <button type="button" aria-current={i === current ? "true" : undefined} onClick={() => onPick(i)} data-testid={`compare-segment-${i}`}>
            <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem", paddingTop: 2 }}>
              {clock(s.startTime)}
            </span>
            <span>{i === current && playing ? <SpokenText e={explanation} index={i} time={time} /> : s.narration}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
