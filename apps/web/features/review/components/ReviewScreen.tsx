"use client";

// The review screen's client root (phase-03 plan §4.1, §5.2): one viewport, the board always on screen.
//
// Layout: BoardStage with the opponent strip, the board (with the eval bar), the viewer's strip, the review panel
// (aside) and, on phones and iPad portrait, the control bar (footer). Desktop/iPad L vs phone/iPad P is CSS only
// (review.css container queries), so the first render never depends on JS.
//
// It owns: the per-instance view store (ply, tab, flip, moments) mirrored to `?tab`, `?ply`, `?m` with
// history.replaceState (CDL D8); the data flow (useReviewData: the seeded payload, live deltas, A3 on mount, the
// fallback poller, stall detection, Retry); the narration controller; the auto-advance to the summary on `done`
// (a 300 ms cross-fade; under reduced motion an instant swap with focus on the h2); the keyboard shortcuts; and the
// review telemetry.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { BoardStage } from "@/components/layout/BoardStage";
import { afterPaint, analysisEventPly, recordFirstBadge, startAutoAdvanceSpan } from "@/lib/sentry/review";
import { ReviewProvider, useReview, type ReviewContextValue, type ReviewFlags } from "../context";
import { useReviewHotkeys } from "../keys/useReviewHotkeys";
import { clampPly, phaseOf, reviewPlies } from "../model";
import { isAnswered, isAsking, LINE_STEP_MS, lineOf, momentSentences, PLAN_CHIPS, resumeIndex } from "../moments";
import { browserSpeech, Narrator } from "../narration";
import { reviewCompletePath, reviewSharePath } from "../paths";
import { downloadPgn } from "../pgn";
import { bucket10, deviceClass, trackReview } from "../telemetry";
import { useReviewData } from "../useReviewData";
import { useMomentWalkthrough } from "../useMomentWalkthrough";
import { useReviewProgressSync } from "../useReviewProgressSync";
import { createReviewViewStore, urlFor, type ReviewTab, type ReviewViewInit, type ReviewViewStore } from "../view-store";
import { ReviewBoardArea, ReviewPlayerStrip } from "./ReviewBoardColumn";
import { ReviewActionBar, useReviewPrimary } from "./ReviewFooter";
import { ReviewPanel } from "./ReviewPanel";
import "../review.css";

export type ReviewSource = "game_over" | "archive" | "home" | "deeplink" | "share_owner";

export type ReviewScreenProps = {
  refId: string;
  initialTab?: ReviewTab | null;
  initialPly?: number | null;
  /** 0-based (the URL's `?m=` is 1-based). */
  initialMoment?: number | null;
  flags: ReviewFlags;
  /** /dev/ui demo: no network and no socket; the cache is seeded with a fixture. */
  demo?: boolean;
  /** review_opened.source (from the link that opened it); otherwise read from the referrer. */
  source?: ReviewSource;
  /** Demo only: start in the writing phase / with the board flipped / in a moment sub-state. */
  initialWriting?: boolean;
  initialFlipped?: boolean;
  initialMomentPhase?: ReviewViewInit["phase"];
};

export function ReviewScreen({
  refId,
  initialTab,
  initialPly,
  initialMoment,
  flags,
  demo = false,
  source,
  initialWriting = false,
  initialFlipped = false,
  initialMomentPhase,
}: ReviewScreenProps) {
  const storeRef = useRef<ReviewViewStore | null>(null);
  // Sentry (plan §10.2): the frame that first grades a ply starts the live first-badge timer; `analysis:done` starts
  // the auto-advance span (both read in the effects below).
  const firstFrameAt = useRef<number | null>(null);
  const autoAdvance = useRef<{ end: () => void } | null>(null);
  const data = useReviewData(refId, {
    demo,
    onEvent: (name, payload) => {
      if (name === "analysis:writing") {
        const w = payload as { at?: number; of?: number } | undefined;
        storeRef.current?.getState().setWriting(true, typeof w?.at === "number" && typeof w.of === "number" ? { at: w.at, of: w.of } : null);
      }
      if (name === "analysis:progress" && firstFrameAt.current === null && (analysisEventPly(payload) ?? 0) > 0) {
        firstFrameAt.current = performance.now();
      }
      if (name === "analysis:done" && !demo) {
        autoAdvance.current?.end();
        autoAdvance.current = startAutoAdvanceSpan();
      }
    },
  });
  const dto = data.dto;
  const plies = reviewPlies(dto);
  const lastPly = plies.san.length - 1;
  const [store] = useState(() =>
    createReviewViewStore({
      ply: initialPly === null || initialPly === undefined ? lastPly : clampPly(plies, initialPly),
      tab: initialTab ?? "coach",
      momentIndex: initialMoment !== null && initialMoment !== undefined && (dto.review?.moments.length ?? 0) > initialMoment ? initialMoment : null,
      writing: initialWriting,
      flipped: initialFlipped,
      phase: initialMomentPhase,
    }),
  );
  useEffect(() => {
    storeRef.current = store;
  }, [store]);
  const writing = useStore(store, (v) => v.writing);
  const writingStep = useStore(store, (v) => v.writingStep);
  const mode = useStore(store, (v) => v.mode);
  const momentIndex = useStore(store, (v) => v.momentIndex);
  const tab = useStore(store, (v) => v.tab);
  const momentPhase = useStore(store, (v) => v.phase);
  const phase = phaseOf(dto, writing, writingStep);

  // The writing flag only lives while the job runs.
  useEffect(() => {
    if (dto.status !== "running" && store.getState().writing) store.getState().setWriting(false);
  }, [dto.status, store]);

  // ── narration (client only; hidden without the Web Speech API) ──
  const [narrator, setNarrator] = useState<Narrator | null>(null);
  useEffect(() => {
    const speech = browserSpeech();
    if (!speech) return;
    const context = () => (store.getState().mode === "moment" ? "moment" : "summary");
    const n = new Narrator({
      ...speech,
      onPlayed: (rate) => trackReview("narration_played", { context: context(), speed: rate }),
      onCompleted: (rate) => trackReview("narration_completed", { context: context(), speed: rate }),
    });
    setNarrator(n);
    const stop = () => n.stop();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      n.destroy();
    };
  }, [store]);
  const moment = mode === "moment" ? dto.review?.moments[momentIndex] : undefined;
  const narrationKey = moment
    ? momentSentences(moment, momentPhase)
        .map((s) => s.t)
        .join("\n")
    : (dto.review?.summary.map((s) => s.t).join("\n") ?? "");
  useEffect(() => {
    narrator?.setText(narrationKey ? narrationKey.split("\n") : []);
  }, [narrator, narrationKey]);
  // It stops on a moment, tab or answer change (the ask becomes the why); a route change unmounts and destroys it.
  const answered = mode === "moment" && isAnswered(momentPhase);
  useEffect(() => {
    narrator?.stop();
  }, [narrator, mode, momentIndex, tab, answered]);

  // ── walkthrough progress (A5): debounced, flushed with keepalive on pagehide / unmount ──
  useReviewProgressSync(refId, store, !demo);

  // ── URL mirror (?tab, ?ply, ?m) with replaceState, so Back leaves the review ──
  const lastPlyRef = useRef(lastPly);
  useEffect(() => {
    lastPlyRef.current = lastPly;
  }, [lastPly]);
  useEffect(
    () =>
      store.subscribe((v, prev) => {
        if (v.tab === prev.tab && v.ply === prev.ply && v.mode === prev.mode && v.momentIndex === prev.momentIndex) return;
        const url = urlFor(window.location.pathname, new URLSearchParams(window.location.search), v, lastPlyRef.current);
        if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
      }),
    [store],
  );

  // ── auto-advance to the summary on done (300 ms cross-fade; reduced motion: instant swap, focus on the h2) ──
  const prevStatus = useRef(dto.status);
  const [fadeKey, setFadeKey] = useState(0);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = dto.status;
    if (dto.status !== "done" || was === "done") return;
    const s = store.getState();
    s.setTab("coach");
    s.setPly(lastPly);
    setFadeKey((k) => k + 1);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="review-title"]')?.focus());
    }
  }, [dto.status, lastPly, store]);

  // ── Sentry: the first badge on screen (once per mount) and the auto-advance span's end at the summary's paint ──
  const gradedPlies = dto.analysis?.gradedPlies ?? 0;
  const badgeAtMount = useRef(gradedPlies > 0);
  const badgeSent = useRef(false);
  useEffect(() => {
    if (demo || badgeSent.current || gradedPlies <= 0) return;
    badgeSent.current = true;
    const live = !badgeAtMount.current && firstFrameAt.current !== null ? firstFrameAt.current : null;
    return afterPaint(() => recordFirstBadge(performance.now() - (live ?? 0), live === null ? "load" : "live"));
  }, [demo, gradedPlies]);
  useEffect(() => {
    if (phase.kind !== "done" || !autoAdvance.current) return;
    const span = autoAdvance.current;
    autoAdvance.current = null;
    return afterPaint(() => span.end());
  }, [phase.kind]);

  // ── telemetry: opened (once), summary viewed (once) ──
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackReview("review_opened", { source: source ?? sourceFromReferrer(), status: dto.status, device: deviceClass() });
  }, [dto.status, source]);
  const summarySeen = useRef(false);
  const accuracy = dto.analysis?.accuracy[dto.you] ?? null;
  useEffect(() => {
    if (summarySeen.current || phase.kind !== "done" || mode !== "moves" || tab !== "coach") return;
    summarySeen.current = true;
    trackReview("review_summary_viewed", {
      accuracy_bucket: accuracy === null ? null : bucket10(accuracy),
      moments: phase.moments,
      is_clean: phase.clean,
    });
  }, [phase, mode, tab, accuracy]);

  const ctx: ReviewContextValue = {
    refId,
    dto,
    plies,
    phase,
    store,
    narrator,
    flags,
    demo,
    lastPly,
    actions: {
      retry: data.retry,
      retrying: data.retrying,
      startReview: () => {
        const n = dto.review?.moments.length ?? 0;
        if (n === 0) return;
        trackReview("review_started", { moments: n });
        store.getState().startWalk(Date.now());
        store.getState().enterMoment(resumeIndex(dto.review?.progress ?? null, n));
      },
      downloadPgn: () => {
        downloadPgn(dto);
        trackReview("pgn_downloaded", { annotated: true });
      },
      refreshFailed: data.refreshFailed,
      refetch: data.refetch,
    },
  };

  return (
    <ReviewProvider value={ctx}>
      <ReviewKeys />
      <MomentEffects />
      <div data-rc-review="" style={{ display: "contents" }} data-status={dto.status} data-phase={phase.kind} data-testid="review-screen">
        <BoardStage
          label="Board"
          top={<ReviewPlayerStrip pos="top" />}
          bottom={<ReviewPlayerStrip pos="bottom" />}
          board={<ReviewBoardArea />}
          aside={
            <div key={fadeKey} className={fadeKey ? "rv-fade" : undefined} style={{ display: "contents" }}>
              <ReviewPanel />
            </div>
          }
          footer={<ReviewActionBar />}
        />
      </div>
    </ReviewProvider>
  );
}

/** The keyboard shortcuts, wired to the screen's context. */
function ReviewKeys() {
  const { dto, phase, store, narrator, flags, demo, refId, lastPly } = useReview();
  const primary = useReviewPrimary();
  const walk = useMomentWalkthrough();
  const router = useRouter();
  useReviewHotkeys({
    store,
    lastPly,
    moments: dto.review?.moments.length ?? 0,
    narration: () => narrator?.toggle(),
    primary: () => {
      if (primary.kind === "button") {
        if (!primary.disabled) primary.run();
      } else if (!demo) router.push(primary.href);
    },
    tab: (t) => {
      if (phase.kind !== "done") return false;
      if (store.getState().tab !== t) trackReview("review_tab_switched", { tab: t });
      store.getState().setTab(t);
      return true;
    },
    done: () => {
      if (phase.kind !== "done" || !phase.clean || demo) return false;
      router.push(reviewCompletePath(refId));
      return true;
    },
    share: () => {
      if (!flags.share || dto.status !== "done" || demo) return false;
      router.push(reviewSharePath(refId));
      return true;
    },
    onMomentKey: (key) => {
      const v = store.getState();
      if (key === "show-line") {
        if (!isAnswered(v.phase)) return false;
        walk.showLine();
        return true;
      }
      const n = /^plan-([1-5])$/.exec(key)?.[1];
      const chip = n ? PLAN_CHIPS[Number(n) - 1] : undefined;
      if (!chip || !isAsking(v.phase)) return false;
      walk.pickChip(chip.key);
      return true;
    },
  });
  return null;
}

/**
 * Moment side effects: `moment_viewed` + the A5 `viewed` event once per moment opened, and the Show Line animation
 * (one ply per LINE_STEP_MS; reduced motion already jumped to the end in `showLine`).
 */
function MomentEffects() {
  const { dto, plies, store } = useReview();
  const mode = useStore(store, (v) => v.mode);
  const momentIndex = useStore(store, (v) => v.momentIndex);
  const phase = useStore(store, (v) => v.phase);
  const lineN = useStore(store, (v) => v.lineN);
  const moment = mode === "moment" ? dto.review?.moments[momentIndex] : undefined;

  const viewedKey = moment ? `${momentIndex}:${moment.ply}` : null;
  const lastViewed = useRef<string | null>(null);
  useEffect(() => {
    if (!viewedKey) {
      lastViewed.current = null;
      return;
    }
    if (lastViewed.current === viewedKey || !moment) return;
    lastViewed.current = viewedKey;
    trackReview("moment_viewed", { idx: momentIndex, judgement: moment.judgement });
    store.getState().queueEvent({ type: "viewed", ply: moment.ply, at: new Date().toISOString() });
  }, [viewedKey, moment, momentIndex, store]);

  const lineLength = moment ? lineOf(plies.fens[Math.min(moment.ply, plies.fens.length - 1)] ?? dto.game.startFen, moment.line).length : 0;
  useEffect(() => {
    if (phase !== "line" || lineN < 0 || lineN >= lineLength) return;
    const t = setTimeout(() => {
      const v = store.getState();
      if (v.phase === "line" && v.lineN === lineN) v.setPhase("line", { lineN: lineN + 1 });
    }, LINE_STEP_MS);
    return () => clearTimeout(t);
  }, [phase, lineN, lineLength, store]);
  return null;
}

/** review_opened.source from where the user came, when the link did not say. */
function sourceFromReferrer(): "game_over" | "archive" | "home" | "deeplink" {
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (!r || r.origin !== window.location.origin) return "deeplink";
    if (r.pathname.startsWith("/game/")) return "game_over";
    if (r.pathname === "/games" || r.pathname.startsWith("/games/")) return "archive";
    if (r.pathname === "/home" || r.pathname === "/") return "home";
    return "deeplink";
  } catch {
    return "deeplink";
  }
}
