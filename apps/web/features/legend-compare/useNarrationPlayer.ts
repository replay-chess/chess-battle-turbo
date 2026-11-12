"use client";

// The static narration's player (phase-03 plan §4.6 Explanation, §5.7, §3.2: the legacy AudioControls moved here and
// restyled). The `<audio>` element is the screen's (rendered with `preload="none"`, so nothing downloads until Play);
// this hook drives it. Play starts on a gesture only (a click or Space: the legacy 2 s autoplay is gone). Speeds 0.75×,
// 1× and 1.5× (the board). The audio's `error` event → `failed` (the `audio_failed` banner, Play disabled). Without an
// audio URL the explanation is manual: segments are picked by hand.
//
// `compare_narration_played {pct_listened, speed, audio_failed}` is sent once per listening session: on pause, on
// the end, on a failure after Play, or when the screen leaves while it plays.
import { useEffect, useRef, useState } from "react";
import type { StaticExplanation } from "@repo/contracts/http/legend";
import { trackReview } from "@/features/review/telemetry";
import { narrationLength, segmentAt } from "./explanation";
import { bucket10 } from "./model";

export const NARRATION_SPEEDS = [0.75, 1, 1.5] as const;
export type NarrationSpeed = (typeof NARRATION_SPEEDS)[number];
/** How often the position and the progress bar follow the audio while it plays. */
export const NARRATION_TICK_MS = 200;

export interface NarrationState {
  playing: boolean;
  failed: boolean;
  /** Seconds into the narration (the audio's time, or the picked segment's start in manual mode). */
  time: number;
  duration: number;
  rate: NarrationSpeed;
  segment: number;
  /** Played or a segment picked: the board follows the narration until the user steps a line. */
  engaged: boolean;
  /** No audio: segments only. */
  manual: boolean;
}

export interface NarrationPlayer extends NarrationState {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  toggle(): void;
  pause(): void;
  seekSegment(i: number): void;
  setRate(r: NarrationSpeed): void;
  disengage(): void;
  /** Wire these to the `<audio>` element. */
  audioEvents: {
    onError(): void;
    onEnded(): void;
    onLoadedMetadata(): void;
  };
}

export function useNarrationPlayer(
  explanation: StaticExplanation | null,
  audioUrl: string | null,
  /** The demo's `audio_failed` state starts failed. */
  initialFailed = false,
): NarrationPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(initialFailed);
  const [time, setTime] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState<number | null>(null);
  const [rate, setRateState] = useState<NarrationSpeed>(1);
  const [manualSegment, setManualSegment] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const session = useRef<{ maxTime: number } | null>(null);
  const manual = !audioUrl;
  const duration = loadedDuration ?? (explanation ? narrationLength(explanation) : 0);

  const report = (audioFailed: boolean) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    const pct = duration > 0 ? (Math.min(s.maxTime, duration) / duration) * 100 : 0;
    trackReview("compare_narration_played", { pct_listened: bucket10(pct), speed: rate, audio_failed: audioFailed });
  };

  // Follow the audio while it plays.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      setTime(a.currentTime);
      if (session.current) session.current.maxTime = Math.max(session.current.maxTime, a.currentTime);
    }, NARRATION_TICK_MS);
    return () => clearInterval(t);
  }, [playing]);

  // Leaving the screen while it plays ends the session.
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });
  useEffect(() => () => reportRef.current(false), []);

  const pause = () => {
    const a = audioRef.current;
    if (a && !a.paused) a.pause();
    if (playing) {
      setPlaying(false);
      if (a) setTime(a.currentTime);
      report(false);
    }
  };

  const play = () => {
    const a = audioRef.current;
    if (!a || failed || manual) return;
    a.playbackRate = rate;
    setEngaged(true);
    session.current ??= { maxTime: a.currentTime };
    const p = a.play();
    setPlaying(true);
    if (p && typeof p.then === "function") {
      p.catch((err: unknown) => {
        setPlaying(false);
        // A blocked autoplay (no gesture) is not a broken file; anything else is.
        if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
          setFailed(true);
          report(true);
        } else {
          session.current = null;
        }
      });
    }
  };

  const segments = explanation?.segments ?? [];
  const segment = manual ? manualSegment : segmentAt(segments, time);

  return {
    playing,
    failed,
    time,
    duration,
    rate,
    segment,
    engaged,
    manual,
    audioRef,
    toggle: () => (playing ? pause() : play()),
    pause,
    seekSegment: (i) => {
      const seg = segments[i];
      if (!seg) return;
      setEngaged(true);
      if (manual) {
        setManualSegment(i);
        setTime(seg.startTime);
        return;
      }
      const a = audioRef.current;
      if (a) {
        try {
          a.currentTime = seg.startTime;
        } catch {
          // Seeking before metadata loads throws on some engines; the time below still moves the board.
        }
      }
      setTime(seg.startTime);
    },
    setRate: (r) => {
      setRateState(r);
      if (audioRef.current) audioRef.current.playbackRate = r;
    },
    disengage: () => {
      pause();
      setEngaged(false);
    },
    audioEvents: {
      onError: () => {
        setFailed(true);
        if (playing) {
          setPlaying(false);
          report(true);
        }
      },
      onEnded: () => {
        setPlaying(false);
        if (session.current && audioRef.current) session.current.maxTime = audioRef.current.duration || duration;
        report(false);
      },
      onLoadedMetadata: () => {
        const d = audioRef.current?.duration;
        if (d && Number.isFinite(d)) setLoadedDuration(d);
      },
    },
  };
}
