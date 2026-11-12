"use client";

// Practice from a position `/practice` (phase-03 plan §4.8, §5.9, §8.11; DR/V3Practice.dc.html). The client root:
// BoardStage with the engine chip ("Engine 1400 · Ready · ∞"), the board and your chip; the aside with the eyebrow
// ("Practice · from move 12"), the serif title, the engine line, the state block (engine_loading with the determinate
// bar, engine_failed + Retry, offline, the inline result when the game ends), the coach/hint card and the practice
// line; the footer Compare (a legend game's `?game=` only), Take Back, Reset. Phones and iPad portrait: the game layout
// with the bottom action bar.
//
// Nothing is written on the server; the engine is the browser's (P2's shared worker, lazy: started on mount with a
// metered download). The moves resume from sessionStorage per URL. Telemetry: `practice_started` once,
// `practice_action` per Take Back / Reset / hint level / Compare; `engine_init` is P2's.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PracticeContextDTO } from "@repo/contracts/http/practice";
import { botThinkDelayMs } from "@repo/game-core/local/drawPolicy";
import { startPlyOf } from "@repo/game-core/rules/chess";
import { initialsOf } from "@repo/game-core/rules/describe";
import { Board } from "@/components/board/Board";
import type { BoardMove, Sq } from "@/components/board/types";
import { BoardStage } from "@/components/layout/BoardStage";
import { useOnline } from "@/components/shell/OnlineChip";
import { ShellBackOverride } from "@/components/shell/back-override";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { useReviewShortcuts } from "@/features/review/keys/useReviewShortcuts";
import { bucket10, trackReview } from "@/features/review/telemetry";
import { useScreenKeys } from "@/features/legend-compare/useScreenKeys";
import { cn } from "@/lib/utils";
import { backLabel, shellBack, COLOUR, engineFirstLine, engineLine, loadingLine, practiceFrom, PRACTICE_COPY, readyLine } from "./copy";
import { nextHintLevel, practiceHint, hintKey, type PracticeHint } from "./hint";
import { PRACTICE_SHORTCUTS, practiceKeyFor } from "./keys";
import { canTakeBack, endOf, lineLabels, liveDests, playMove, positionAt, resultText, takeBack, type PracticeGame, type Side } from "./runner";
import { readSession, sessionKey, writeSession } from "./session";
import { usePracticeEngine, type ForcedEngine } from "./usePracticeEngine";
import "@/features/legend-compare/compare.css";
import "./practice.css";

const NO_DESTS = (): Sq[] => [];
const NO_MOVE = (): void => undefined;

export interface PracticeViewer {
  name: string;
  /** "Blitz 1184" (MeUser.ratingLabel) or null. */
  ratingLabel: string | null;
}

export interface PracticeDemo {
  engine?: ForcedEngine;
  offline?: boolean;
}


function Chip({ name, rating, sub, ink }: { name: string; rating: string | null; sub: string; ink?: boolean }) {
  return (
    <div className="lc-chip" data-testid={ink ? "practice-engine-chip" : "practice-you-chip"}>
      <span className="lc-chip__av" data-ink={ink ? "" : undefined} aria-hidden="true">
        {ink ? "E" : initialsOf(name).slice(0, 2) || "?"}
      </span>
      <span className="lc-chip__nm">
        <span>
          {name}{" "}
          {rating ? (
            <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem" }}>
              {rating}
            </span>
          ) : null}
        </span>
        <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem" }} data-testid={ink ? "practice-engine-status" : "practice-you-status"}>
          {sub}
        </span>
      </span>
      <span className="lc-chip__clk" aria-label="Untimed">
        ∞
      </span>
    </div>
  );
}

export function PracticeScreen({
  context,
  viewer,
  urlKey,
  from = null,
  demo,
}: {
  context: PracticeContextDTO;
  viewer: PracticeViewer;
  /** The path and query, for the session resume. */
  urlKey: string;
  from?: string | null;
  demo?: PracticeDemo;
}) {
  const human: Side = context.humanColor;
  const engineSide: Side = human === "w" ? "b" : "w";
  const start: PracticeGame = { startFen: context.fen, moves: [] };
  const storageKey = sessionKey(urlKey);
  const [game, setGame] = useState<PracticeGame>(start);
  const [restored, setRestored] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Side>(human);
  const [thinking, setThinking] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [hint, setHint] = useState<{ key: string; level: 1 | 2; best: string; view: PracticeHint } | null>(null);
  const hintAbort = useRef<AbortController | null>(null);
  const engine = usePracticeEngine(demo?.engine ?? null);
  const realOnline = useOnline();
  const online = demo?.offline ? false : realOnline;

  useReviewShortcuts("practice", PRACTICE_SHORTCUTS);

  // ── resume (sessionStorage, after hydration so the server HTML is the start position) ──
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    if (demo) return;
    const saved = readSession(storageKey, context.fen);
    if (saved) setGame(saved);
  }, [restored, demo, storageKey, context.fen]);
  useEffect(() => {
    if (restored && !demo) writeSession(storageKey, game);
  }, [restored, demo, storageKey, game]);

  // ── telemetry: started once ──
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let refPath: string | null = null;
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.origin === window.location.origin) refPath = r.pathname;
    } catch {
      refPath = null;
    }
    const ply = context.source === "game" ? Math.max(0, startPlyOf(context.fen)) : null;
    trackReview("practice_started", { from: practiceFrom(from, refPath, context.source), ply_bucket: ply === null ? null : bucket10(ply) });
  }, [context.source, context.fen, from]);

  const live = positionAt(game);
  const viewing = viewIndex !== null && viewIndex < game.moves.length;
  const shown = viewing ? positionAt(game, viewIndex) : live;
  const end = endOf(game);
  const ready = engine.status === "ready" && !crashed;
  const failed = engine.status === "failed" || crashed;
  const humanToMove = live.turn === human;
  const inputOn = ready && !viewing && !end && humanToMove && !thinking;

  // ── the engine's reply ──
  useEffect(() => {
    if (!ready || viewing || end || live.turn === human) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const t0 = Date.now();
    setThinking(true);
    const minDelay = botThinkDelayMs({ rand: Math.random(), legalMoves: 20, remainingMs: null });
    engine.bot
      .reply(
        { ref: `practice:${context.source}`, startFen: game.startFen, moves: game.moves.join(" "), fen: live.fen, startPly: startPlyOf(game.startFen) },
        context.botElo,
        ac.signal,
      )
      .then(
        (uci) => {
          if (ac.signal.aborted || !uci) return;
          timer = setTimeout(
            () => {
              setGame((g) => (g === game ? (playMove(g, uci) ?? g) : g));
              setThinking(false);
            },
            Math.max(0, minDelay - (Date.now() - t0)),
          );
        },
        () => {
          if (ac.signal.aborted) return;
          setThinking(false);
          setCrashed(true);
        },
      );
    return () => {
      ac.abort();
      if (timer) clearTimeout(timer);
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one search per live position
  }, [ready, viewing, end, game]);

  // A new live position drops the hint (its level resets with the position).
  useEffect(() => {
    hintAbort.current?.abort();
    setHint((h) => (h && h.key === hintKey(live.fen) ? h : null));
  }, [live.fen]);

  const showHint = () => {
    if (!inputOn) return;
    const level = nextHintLevel(hint ? { key: hint.key, level: hint.level } : null, live.fen);
    if (level === null) return;
    trackReview("practice_action", { action: level === 1 ? "hint1" : "hint2" });
    if (level === 2 && hint) {
      const view = practiceHint(live.fen, hint.best, 2);
      if (view) setHint({ ...hint, level: 2, view });
      return;
    }
    hintAbort.current?.abort();
    const ac = new AbortController();
    hintAbort.current = ac;
    const fen = live.fen;
    void engine.bot.best({ startFen: game.startFen, moves: game.moves.join(" ") }, ac.signal).then(
      (best) => {
        if (ac.signal.aborted || !best) return;
        const view = practiceHint(fen, best, 1);
        if (view) setHint({ key: hintKey(fen), level: 1, best, view });
      },
      () => undefined,
    );
  };

  const doTakeBack = () => {
    if (!canTakeBack(game, human)) return;
    trackReview("practice_action", { action: "takeback" });
    setViewIndex(null);
    setGame(takeBack(game, human));
  };
  const doReset = () => {
    if (game.moves.length === 0 && viewIndex === null) return;
    trackReview("practice_action", { action: "reset" });
    setViewIndex(null);
    setGame(start);
  };
  const onMove = (m: BoardMove) => {
    const next = playMove(game, m.uci);
    if (next) setGame(next);
  };
  const stepView = (delta: number) => {
    const n = game.moves.length;
    const cur = viewIndex ?? n;
    const target = Math.min(Math.max(0, cur + delta), n);
    setViewIndex(target >= n ? null : target);
  };

  useScreenKeys((e, ctx) => {
    const key = practiceKeyFor(e, ctx);
    switch (key) {
      case "takeback":
        if (!canTakeBack(game, human)) return false;
        doTakeBack();
        return true;
      case "reset":
        doReset();
        return true;
      case "hint":
        showHint();
        return true;
      case "prev":
        if ((viewIndex ?? game.moves.length) <= 0) return false;
        stepView(-1);
        return true;
      case "next":
        if (viewIndex === null) return false;
        stepView(1);
        return true;
      case "flip":
        setOrientation((o) => (o === "w" ? "b" : "w"));
        return true;
      default:
        return false;
    }
  });

  // ── board ──
  const dests = inputOn ? (() => {
    const map = liveDests(game);
    return (sq: Sq) => (map.get(sq) ?? []) as Sq[];
  })() : NO_DESTS;
  const arrow = hint && hint.level === 2 && hint.view.arrow && !viewing ? [hint.view.arrow] : [];
  const dimmed = !ready;
  const boardLabel = `Practice board. ${shown.label ? `Position after ${shown.label}.` : "Start position."} ${COLOUR[shown.turn]} to move.${inputOn ? " Your move." : ""}`;

  const engineSub = failed ? "Not started" : !ready ? "Loading" : thinking ? "Thinking" : "Ready";
  const youSub = viewing ? "Viewing" : end ? "Game over" : !ready ? "Waiting for the engine" : humanToMove ? "Your move" : "Engine to move";
  const engineChip = <Chip name="Engine" rating={String(context.botElo)} sub={engineSub} ink />;
  const ratingNo = viewer.ratingLabel?.match(/\d+/)?.[0] ?? null;
  const youChip = <Chip name={viewer.name || "You"} rating={ratingNo} sub={youSub} />;
  const top = orientation === human ? engineChip : youChip;
  const bottom = orientation === human ? youChip : engineChip;
  const labels = lineLabels(game);
  const state = failed ? "engine_failed" : !ready ? "engine_loading" : !online ? "offline" : end ? "over" : "default";

  const compareButton = (bar: boolean) =>
    context.compareHref ? (
      online ? (
        <Link
          href={context.compareHref}
          prefetch={false}
          className={cn(buttonVariants({ variant: "secondary" }), "min-w-0 flex-1", bar && "min-h-12")}
          onClick={() => trackReview("practice_action", { action: "compare" })}
          data-testid={bar ? "practice-bar-compare" : "practice-compare"}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {PRACTICE_COPY.compare}
        </Link>
      ) : (
        <Button variant="secondary" className={cn("min-w-0 flex-1", bar && "min-h-12")} disabled data-testid={bar ? "practice-bar-compare" : "practice-compare"}>
          {PRACTICE_COPY.compare}
        </Button>
      )
    ) : null;
  const actions = (bar: boolean) => (
    <>
      {compareButton(bar)}
      <Button
        variant="secondary"
        className={cn("min-w-0 flex-1", bar && "min-h-12")}
        onClick={doTakeBack}
        disabled={!canTakeBack(game, human) || failed}
        data-testid={bar ? "practice-bar-takeback" : "practice-takeback"}
      >
        {PRACTICE_COPY.takeBack}
      </Button>
      <Button
        variant="secondary"
        className={cn("min-w-0 flex-1", bar && "min-h-12")}
        onClick={doReset}
        disabled={(game.moves.length === 0 && viewIndex === null) || failed}
        data-testid={bar ? "practice-bar-reset" : "practice-reset"}
      >
        {PRACTICE_COPY.reset}
      </Button>
      {bar ? (
        <Button variant="secondary" className="min-h-12 min-w-0 flex-1" onClick={showHint} disabled={!inputOn} data-testid="practice-bar-hint">
          {PRACTICE_COPY.hint}
        </Button>
      ) : null}
    </>
  );

  const engineFirst = context.sideToMove === engineSide && game.moves.length === 0;

  return (
    <div data-rc-practice="" style={{ display: "contents" }} data-testid="practice-screen" data-state={state} data-source={context.source}>
      <BoardStage
        label="Board"
        top={top}
        bottom={bottom}
        board={
          <div className="relative size-full" data-testid="practice-board" data-fen={shown.fen} data-moves={game.moves.length} data-input={inputOn ? "" : undefined}>
            <Board
              fen={shown.fen}
              orientation={orientation}
              mover={inputOn ? human : null}
              dests={dests}
              onMove={inputOn ? onMove : NO_MOVE}
              lastMove={shown.last}
              check={shown.check}
              arrows={arrow}
              dimmed={dimmed}
              label={boardLabel}
            />
          </div>
        }
        aside={
          <div className="lc-side" role="region" aria-label="Practice" data-testid="practice-panel">
            <TopBarTitle>
              <span className="lc-lbl" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                Practice
              </span>
            </TopBarTitle>
            {/* The phone top bar's Back goes where this practice came from (FIX-2), not to the section landing. */}
            <ShellBackOverride target={shellBack(context.backHref)} />
            <div className="pr-body rc-scroll" tabIndex={0} role="group" aria-label="Practice status">
              {/* The head shows in both modes (FIX-1): in stack mode (phones, iPad portrait) the top bar carries Back
                  (lib/nav/destinations.ts backTarget) and the eyebrow, title and intro sit compact at the top of the
                  strip; only the in-panel back link is side-only. */}
              <div className="pr-head flex flex-col gap-1.5" data-testid="practice-head">
                <Link
                  href={context.backHref}
                  prefetch={false}
                  className={cn(buttonVariants({ variant: "text" }), "min-h-9 self-start")}
                  data-rc-side-only=""
                  data-testid="practice-back"
                >
                  {backLabel(context.backHref)}
                </Link>
                {context.fromLabel ? <span className="lc-lbl">{context.fromLabel}</span> : null}
                <h1 className="lc-h1 pr-h1" data-testid="practice-title">
                  {context.title}
                </h1>
                <p className="lc-soft pr-short-hide pr-intro" style={{ margin: 0 }}>
                  {engineFirst ? engineFirstLine(context.botElo, human) : engineLine(context.botElo, human)}
                </p>
              </div>

              {state === "engine_loading" ? (
                <div role="status" className="flex flex-col gap-2" data-testid="practice-loading">
                  <span className="lc-lbl" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="pr-spin" aria-hidden="true" />
                    {loadingLine(engine.pct)}
                  </span>
                  <div className="lc-bar" role="progressbar" aria-label="Engine download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={engine.pct}>
                    <span style={{ width: `${engine.pct}%` }} />
                  </div>
                  <span className="lc-soft" style={{ fontSize: "0.875rem" }}>
                    {PRACTICE_COPY.loadingNote}
                  </span>
                </div>
              ) : null}

              {state === "engine_failed" ? (
                <Banner
                  tone="bad"
                  layout="note"
                  data-testid="practice-failed"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setCrashed(false);
                        engine.retry();
                      }}
                      data-testid="practice-retry"
                    >
                      {PRACTICE_COPY.retry}
                    </Button>
                  }
                >
                  {PRACTICE_COPY.failed}
                </Banner>
              ) : null}

              {state === "offline" ? (
                <Banner tone="warn" layout="note" data-testid="practice-offline">
                  {PRACTICE_COPY.offline}
                </Banner>
              ) : null}

              {end ? (
                <div className="pr-result" role="status" data-testid="practice-result">
                  <span>{resultText(end, human)}</span>
                  <Button size="sm" onClick={doReset}>
                    {PRACTICE_COPY.reset}
                  </Button>
                </div>
              ) : null}

              {ready && !end ? (
                <div role="status" className="pr-status" data-testid="practice-status">
                  <span className="pr-dot" data-tone={thinking ? "busy" : undefined} aria-hidden="true" />
                  <span>{viewing ? PRACTICE_COPY.viewing : thinking ? PRACTICE_COPY.thinking : humanToMove ? readyLine(human) : PRACTICE_COPY.thinking}</span>
                </div>
              ) : null}

              {online && context.planLine && !failed ? (
                <div className="pr-coach" data-testid="practice-plan">
                  <span className="pr-coach__mark" aria-hidden="true">
                    C
                  </span>
                  <span>{context.planLine}</span>
                </div>
              ) : null}

              {ready && !end ? (
                <div className="flex flex-col items-start gap-2" data-testid="practice-hint">
                  {hint ? (
                    <p className="lc-p" aria-live="polite" data-testid="practice-hint-text" data-level={hint.level}>
                      {hint.view.text}
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={showHint}
                    disabled={!inputOn || (hint?.level === 2 && hint.key === hintKey(live.fen))}
                    data-rc-side-only=""
                    data-testid="practice-hint-button"
                  >
                    {hint && hint.key === hintKey(live.fen) ? PRACTICE_COPY.hintArrow : PRACTICE_COPY.hint}
                  </Button>
                </div>
              ) : null}

              {labels.length ? (
                <ol className="pr-line" aria-label="Your practice moves" data-testid="practice-line">
                  {labels.map((l, i) => (
                    <li key={i}>
                      <button type="button" aria-current={(viewIndex ?? game.moves.length) === i + 1 ? "true" : undefined} onClick={() => setViewIndex(i + 1 >= game.moves.length ? null : i + 1)}>
                        {l}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div className="lc-foot" data-rc-side-only="">
              {actions(false)}
            </div>
          </div>
        }
        footer={<div className="flex w-full gap-1.5 border-t border-cb-border bg-cb-surface px-3 pt-2">{actions(true)}</div>}
      />
    </div>
  );
}
