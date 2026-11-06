"use client";

// The local (bot) controller (phase-02 plan 5.3, 5.2.6, 8.13–8.15; WP-G's GameController contract in
// features/game/controller.ts). Bot games run entirely in the browser and never touch the socket server:
//
// - rules, clocks and endings: the game-core local runner (`@repo/game-core/local/runner`), fed with Date.now()
//   (the same clock base `serverNow()` gives the screen); clocks start after two plies;
// - the bot: the tab's Stockfish worker through useBotEngine (ladder rung per Elo, seeded weakening layer, 3 s
//   cap), then the think delay of plan 8.15; it never moves while the page is hidden;
// - Hint (twice: piece, then arrow + SAN), Undo (your move and the reply, or only yours while the bot thinks),
//   Resign, Abort (< 2 plies), draw offers answered by the draw policy, Rematch and Restart (new game via
//   POST /api/games);
// - persistence: the journal after every change, checkpoints (beacon on hide, keepalive fetch every 10 plies),
//   resume from the newer of the journal and the server snapshot, `complete` with retries and the pending queue;
// - one tab at a time (lock.ts) and the human's clock paused while the page is hidden (owner Q6).
//
// The screen reads only `store`; UI-only state (selection, history view, resign popover, toasts) is dispatched by
// the screen itself. Methods never throw.

import { useEffect, useState } from "react";
import type { CompleteBody, CompleteResponse, GameCreateInput } from "@repo/contracts/http/games";
import { remainingRaw } from "@repo/game-core/clock/clock";
import { reduceClient, type BotView, type ClientGame, type ToastCode } from "@repo/game-core/client/reducer";
import { CHECKPOINT_PLIES, DRAW_COOLDOWN_PLIES, FLAG_TIMER_SLACK_MS } from "@repo/game-core/constants";
import { FALLBACK_BOT_ELO } from "@repo/game-core/bot/strength";
import { botAcceptsDraw, botThinkDelayMs, canOfferDrawToBot, drawAnswerDelayMs } from "@repo/game-core/local/drawPolicy";
import { chooseResume, type BotJournal } from "@repo/game-core/local/journal";
import * as runner from "@repo/game-core/local/runner";
import type { LocalGame } from "@repo/game-core/local/runner";
import { otherSide, type GameState, type Side } from "@repo/game-core/machine/types";
import { Chess, splitMoves } from "@repo/game-core/rules/chess";
import type { GameSnapshot } from "@repo/game-core/snapshot";
import type { BoardMove } from "@/components/board/types";
import { useCompleteBotGame, useCreateBotGame } from "@/lib/api/mutations/games";
import { trackEngineEvent } from "@/features/engine/EngineProvider";
import { createGameStore, type GameStore } from "../store";
import { withTelemetry } from "../telemetryLazy";
import { createInertController, type GameController } from "../controller";
import { HintCache, nextHint, tookBackText } from "./hints";
import { createTabLock, type TabLock } from "./lock";
import { isFinalCompleteError, markCompleteInFlight } from "./pendingCompletes";
import { readJournal, removeJournal, sendCheckpoint, writeJournal } from "./persist";
import { useBotEngine, type BotEngine } from "./useBotEngine";

export interface LocalControllerDeps {
  engine: BotEngine;
  /** POST /api/games for a rematch / restart; navigates to the new game on success. */
  createGame(body: GameCreateInput): void;
  /** POST /api/games/<ref>/complete with the 1 s / 4 s / 15 s retries. */
  complete(body: CompleteBody): Promise<CompleteResponse>;
  now(): number;
  random(): number;
  /** Persistence and the tab lock (fakes in unit tests). */
  journal?: {
    read(ref: string): BotJournal | null;
    write(ref: string, j: BotJournal): void;
    remove(ref: string): void;
  };
  checkpoint?(ref: string, body: ReturnType<typeof runner.checkpointBody>, mode: "beacon" | "fetch"): void;
  lock?(ref: string, events: { onLost(): void }): TabLock;
  /** Document hooks (visibility, pagehide, online); null in tests that drive them by hand. */
  dom?: LocalDom | null;
  track?: typeof trackEngineEvent<"hint_used" | "undo_used">;
  /**
   * Runs the start of attach() (resume, engine, bot). The browser default waits for the next frame plus a task, so
   * the first store writes land after hydration has finished (an early write while parts of the screen are still
   * hydrating shows up as a hydration mismatch). Tests pass `(fn) => fn()`.
   */
  defer?(fn: () => void): void;
}

export interface LocalDom {
  hidden(): boolean;
  on(event: "visibilitychange" | "pagehide" | "online", fn: () => void): () => void;
}

export interface LocalController extends GameController {
  /** Binds timers, listeners, the tab lock and the engine; returns the unbind (React effect shape). */
  attach(): () => void;
  /** Tests: the runner state. */
  peek(): LocalGame;
  /** Tests and the visibility listener: page hidden / shown. */
  setHidden(hidden: boolean): void;
}

const browserDom: LocalDom = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  on(event, fn) {
    const target: EventTarget = event === "visibilitychange" ? document : window;
    target.addEventListener(event, fn);
    return () => target.removeEventListener(event, fn);
  },
};

const plyCount = (g: LocalGame) => splitMoves(g.state.moves).length;

/** Rebuilds an ended game from a journal's pending complete (the other tab or a crash ended it). */
function endedFromComplete(g: LocalGame, body: NonNullable<BotJournal["pendingComplete"]>, now: number): LocalGame {
  const winner: Side | null = body.result === "w" || body.result === "b" ? body.result : null;
  const c = g.state.clocks;
  const result: NonNullable<GameState["result"]> = {
    winner,
    method: body.method,
    ply: g.state.startPly + plyCount(g),
    endedAt: body.endedAtClient || now,
  };
  if (body.method === "aborted") result.abortedBy = g.human;
  return {
    ...g,
    ended: true,
    paused: null,
    state: { ...g.state, phase: "ended", clocks: { ...c, run: null, at: now }, drawOffer: null, result },
  };
}

/** Shifts the running clock's reference time (the bot's clock while the page was hidden). */
function shiftClock(g: LocalGame, ms: number): LocalGame {
  const c = g.state.clocks;
  if (!c.run || ms <= 0) return g;
  return { ...g, state: { ...g.state, clocks: { ...c, at: c.at + ms } } };
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

/** The first legal move (the bot's last resort when the engine answered nothing usable). */
function anyLegalMove(fen: string): string | null {
  try {
    const m = new Chess(fen).moves({ verbose: true })[0];
    return m ? `${m.from}${m.to}${m.promotion ?? ""}` : null;
  } catch {
    return null;
  }
}

/** The local game a snapshot starts with (server `rev` kept, so later checkpoints are newer). */
function fromSnapshot(snapshot: GameSnapshot, now: number): LocalGame {
  const g = runner.createLocalGame(snapshot, now);
  return { ...g, rev: snapshot.rev };
}

export function createLocalController(snapshot: GameSnapshot, deps: LocalControllerDeps): LocalController {
  const ref = snapshot.ref;
  const journal = deps.journal ?? { read: (r: string) => readJournal(r), write: (r: string, j: BotJournal) => void writeJournal(r, j), remove: (r: string) => removeJournal(r) };
  const checkpoint = deps.checkpoint ?? ((r, body, mode) => sendCheckpoint(r, body, mode));
  const makeLock = deps.lock ?? ((r, events) => createTabLock(r, events));
  const dom = deps.dom === undefined ? browserDom : deps.dom;
  const track = deps.track ?? ((name, props) => trackEngineEvent(name, props));
  const elo = snapshot.bot?.elo ?? FALLBACK_BOT_ELO;
  const defer =
    deps.defer ??
    ((fn: () => void) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(fn, 0));
      else setTimeout(fn, 0);
    });
  let attachGeneration = 0;

  // The first render (server and hydration) uses the snapshot at its own render time, so both sides agree;
  // attach() then resumes from the journal or rebases the clocks to the real time.
  let game: LocalGame = fromSnapshot(snapshot, snapshot.serverNow);
  const store: GameStore = createGameStore(game.state, { joined: true, conn: "live", bot: true, now: snapshot.serverNow });
  const human: Side = game.human;
  const botSide: Side = otherSide(human);

  let attached = false;
  let viewedOnce = false;
  let lost = false;
  let hidden = false;
  let botHiddenAt: number | null = null;
  let botToken = 0;
  let botAbort: AbortController | null = null;
  let hintToken = 0;
  let hintAbort: AbortController | null = null;
  let drawToken = 0;
  let flagTimer: ReturnType<typeof setTimeout> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let lastCheckpointRev = snapshot.rev;
  let lastCheckpointPly = splitMoves(snapshot.moves).length;
  let completing = false;
  let lock: TabLock | null = null;
  let unlisten: (() => void)[] = [];
  let releaseEngine: (() => void) | null = null;
  const hintCache = new HintCache();

  // ── store ──

  const setBot = (patch: Partial<BotView>) => store.dispatch({ type: "bot", patch });

  /** Publishes the runner state; `patch` merges UI fields in the same store update (one render). */
  function publish(opts: { reason?: "local" | "snapshot"; patch?: Partial<ClientGame>; toast?: { code: ToastCode; params?: Record<string, string | number> } } = {}) {
    const t = deps.now();
    const { store: next } = reduceClient(store.getState(), { type: "replace", state: game.state, reason: opts.reason ?? "local", now: t });
    let merged: ClientGame = opts.patch ? { ...next, ...opts.patch } : next;
    if (opts.toast) merged = reduceClient(merged, { type: "toast", code: opts.toast.code, now: t, params: opts.toast.params }).store;
    store.setState(merged, true);
  }

  // ── persistence ──

  function persist() {
    if (lost) return;
    const t = deps.now();
    const j: BotJournal = runner.toJournal(game, t);
    const pending = game.ended ? runner.completeBody(game, t) : null;
    if (pending) j.pendingComplete = pending;
    journal.write(ref, j);
  }

  function sendCheckpointNow(mode: "beacon" | "fetch") {
    if (lost || game.ended || game.rev <= lastCheckpointRev) return;
    checkpoint(ref, runner.checkpointBody(game), mode);
    lastCheckpointRev = game.rev;
    lastCheckpointPly = plyCount(game);
  }

  function maybeCheckpoint() {
    if (!hidden && plyCount(game) - lastCheckpointPly >= CHECKPOINT_PLIES) sendCheckpointNow("fetch");
  }

  // ── timers ──

  function later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, ms));
    timers.add(id);
    return id;
  }

  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const id = later(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(id);
          timers.delete(id);
          resolve();
        },
        { once: true },
      );
    });

  function clearFlagTimer() {
    if (flagTimer) clearTimeout(flagTimer);
    flagTimer = null;
  }

  function scheduleFlag() {
    clearFlagTimer();
    if (!attached || lost || game.ended || game.paused || hidden) return;
    const c = game.state.clocks;
    if (!game.state.tc || !c.run) return;
    const left = remainingRaw(c, c.run, deps.now());
    flagTimer = setTimeout(onFlagTimer, Math.max(0, left) + FLAG_TIMER_SLACK_MS);
  }

  function onFlagTimer() {
    flagTimer = null;
    const next = runner.tick(game, deps.now());
    if (next === game) return scheduleFlag();
    commit(next);
  }

  // ── commits ──

  /** Applies a new runner state: store, journal, flag timer, checkpoint cadence, and `complete` once it ended. */
  function commit(
    next: LocalGame,
    opts: { positionChanged?: boolean; toast?: { code: ToastCode; params?: Record<string, string | number> } } = {},
  ) {
    const wasEnded = game.ended;
    game = next;
    const patch: Partial<ClientGame> = {};
    if (opts.positionChanged) Object.assign(patch, { selected: null, promotion: null, view: null, flashBackToLive: false });
    if (game.ended) Object.assign(patch, { resignOpen: false, promotion: null });
    const bot = store.getState().bot;
    if (bot && (opts.positionChanged || game.ended)) patch.bot = { ...bot, hint: null, thinking: game.ended ? false : bot.thinking };
    publish({ patch, toast: opts.toast });
    persist();
    scheduleFlag();
    if (game.ended && !wasEnded) {
      cancelBot();
      void finish();
    } else if (!game.ended) maybeCheckpoint();
  }

  async function finish() {
    if (completing) return;
    const body = runner.completeBody(game, deps.now());
    if (!body) return;
    completing = true;
    const unmark = markCompleteInFlight(ref);
    try {
      await deps.complete(body);
      journal.remove(ref);
    } catch (err) {
      // Network errors and 5xx after the retries stay in the journal for the pending queue; final refusals go.
      if (isFinalCompleteError(err)) journal.remove(ref);
    } finally {
      unmark();
      completing = false;
    }
  }

  // ── the bot ──

  const canAct = () => attached && !lost && !game.ended && snapshot.you.role === "player";

  function botShouldMove() {
    return canAct() && !hidden && game.state.turn === botSide && !store.getState().bot?.engineError;
  }

  function cancelBot() {
    botToken++;
    botAbort?.abort();
    botAbort = null;
    if (store.getState().bot?.thinking) setBot({ thinking: false });
  }

  async function runBot() {
    if (!botShouldMove()) return;
    const token = ++botToken;
    botAbort?.abort();
    const ac = new AbortController();
    botAbort = ac;
    setBot({ thinking: true });
    try {
      const uci = await deps.engine.reply(game.state, elo, ac.signal);
      if (token !== botToken || uci === null) return;
      const c = game.state.clocks;
      const remainingMs = game.state.tc ? (c.run === botSide ? remainingRaw(c, botSide, deps.now()) : c[botSide]) : null;
      await sleep(botThinkDelayMs({ rand: deps.random(), legalMoves: legalMoveCount(game.state.fen), remainingMs }), ac.signal);
      if (token !== botToken || !botShouldMove()) return;
      let r = runner.botMove(game, uci, deps.now());
      if (!r.ok) {
        const fallback = anyLegalMove(game.state.fen);
        if (fallback) r = runner.botMove(game, fallback, deps.now());
      }
      if (!r.ok) return;
      botAbort = null;
      const bot = store.getState().bot;
      if (bot) store.setState({ ...store.getState(), bot: { ...bot, thinking: false } }, true);
      commit(r.game, { positionChanged: true });
    } catch {
      if (token !== botToken) return;
      setBot({ thinking: false, engineError: true });
    } finally {
      if (token === botToken && store.getState().bot?.thinking) setBot({ thinking: false });
    }
  }

  function startEngine() {
    if (game.ended || snapshot.you.role !== "player") return;
    releaseEngine ??= deps.engine.retain();
    deps.engine.newGame();
    deps.engine.ready().then(
      () => {
        if (store.getState().bot?.engineError) setBot({ engineError: false });
      },
      () => {
        if (attached) setBot({ engineError: true, thinking: false });
      },
    );
  }

  // ── resume (plan 5.3.2: the journal when its rev is newer than the snapshot's, else the snapshot) ──

  function resume() {
    const t = deps.now();
    const j = journal.read(ref);
    if (snapshot.phase === "ended" || (snapshot.status !== "IN_PROGRESS" && snapshot.status !== "WAITING_FOR_OPPONENT")) {
      // The server already has the result (this device, another one, or the stale sweep): nothing to resume.
      if (j) journal.remove(ref);
      game = fromSnapshot(snapshot, t);
      publish({ reason: "snapshot" });
      return;
    }
    let next: LocalGame | null = null;
    if (j && chooseResume(j, snapshot.rev) === "journal") {
      const resumed = runner.resumeFromJournal(snapshot, j, t);
      if (resumed) next = j.pendingComplete ? endedFromComplete(resumed, j.pendingComplete, t) : resumed;
    }
    game = next ?? fromSnapshot(snapshot, t);
    publish({ reason: "snapshot" });
    if (!next && j) persist(); // an older journal (another device moved on) is replaced by the snapshot's line
    if (game.ended) void finish();
    else if (game.rev > lastCheckpointRev) sendCheckpointNow("fetch"); // the server is behind this device
  }

  /** "Use this tab" / "Reload game": re-read the journal another tab may have advanced. */
  function reloadFromJournal() {
    const j = journal.read(ref);
    if (!j || j.rev <= game.rev) return;
    const resumed = runner.resumeFromJournal(snapshot, j, deps.now());
    if (!resumed) return;
    const next = j.pendingComplete ? endedFromComplete(resumed, j.pendingComplete, deps.now()) : resumed;
    const wasEnded = game.ended;
    game = next;
    publish({ reason: "snapshot", patch: { selected: null, promotion: null, view: null } });
    if (game.ended && !wasEnded) void finish();
  }

  // ── visibility, page hide, lock ──

  function setHidden(next: boolean) {
    if (next === hidden) return;
    hidden = next;
    const t = deps.now();
    if (hidden) {
      clearFlagTimer();
      if (game.ended || lost) return;
      if (game.state.clocks.run === human) game = runner.hide(game, t);
      else if (game.state.turn === botSide) {
        cancelBot();
        botHiddenAt = t;
      }
      sendCheckpointNow("beacon");
      return;
    }
    if (game.paused) game = runner.show(game, t);
    if (botHiddenAt !== null) {
      game = shiftClock(game, t - botHiddenAt);
      botHiddenAt = null;
    }
    if (game.ended || lost) return;
    publish();
    scheduleFlag();
    void runBot();
  }

  function onPageHide() {
    // The journal is already current (written on every change); the server gets the line too.
    sendCheckpointNow("beacon");
  }

  function onLost() {
    lost = true;
    cancelBot();
    hintAbort?.abort();
    clearFlagTimer();
    // Freeze the clocks on this tab; the other tab owns the game now.
    const c = game.state.clocks;
    const frozen = c.run ? { ...c, [c.run]: Math.max(0, remainingRaw(c, c.run, deps.now())), run: null, at: deps.now() } : c;
    const { store: next } = reduceClient(store.getState(), { type: "replace", state: { ...game.state, clocks: frozen }, reason: "local", now: deps.now() });
    store.setState({ ...next, bot: next.bot ? { ...next.bot, otherTab: true, thinking: false, hint: null } : next.bot }, true);
  }

  // ── the controller ──

  const controller: LocalController = {
    kind: "local",
    store,
    serverNow: () => deps.now(),

    move(m: BoardMove) {
      if (!canAct()) return;
      const t = deps.now();
      const r = runner.humanMove(game, m.uci, t);
      if (!r.ok) {
        if (r.reason === "promotion_required") store.dispatch({ type: "promotion", open: { from: m.from, to: m.to } });
        else if (r.reason === "illegal") store.dispatch({ type: "illegal", from: m.from, to: m.to, now: t });
        return;
      }
      hintToken++;
      hintAbort?.abort();
      commit(r.game, { positionChanged: true });
      void runBot();
    },

    setPremove() {
      // No premoves against the bot (owner Q10).
    },
    ready() {},

    abort() {
      if (!canAct()) return;
      const r = runner.abort(game, deps.now());
      if (r.ok) commit(r.game);
    },

    resign() {
      if (!canAct()) {
        store.dispatch({ type: "resign", open: false });
        return;
      }
      const r = runner.resign(game, deps.now());
      if (r.ok) commit(r.game);
    },

    offerDraw() {
      if (!canAct()) return;
      const s = game.state;
      const plies = plyCount(game);
      const ply = s.startPly + plies;
      if (s.drawOffer || !canOfferDrawToBot(plies)) return;
      if (ply < s.canOfferAtPly[human]) {
        store.dispatch({ type: "toast", code: "draw_cooldown", now: deps.now(), params: { canOfferAtPly: s.canOfferAtPly[human] } });
        return;
      }
      game = { ...game, state: { ...s, drawOffer: { by: human, ply } } };
      publish();
      persist();
      const token = ++drawToken;
      const started = deps.now();
      void (async () => {
        let evalCp: number | null = null;
        try {
          evalCp = await deps.engine.evaluate(game.state);
        } catch {
          evalCp = null; // no evaluation: the bot declines
        }
        await sleep(drawAnswerDelayMs(deps.random()) - (deps.now() - started));
        const offer = game.state.drawOffer;
        if (token !== drawToken || !canAct() || !offer || offer.by !== human || offer.ply !== ply) return;
        const accepted = botAcceptsDraw({ plies: plyCount(game), evalCp });
        const r = runner.drawAnswered(game, accepted, deps.now());
        if (!r.ok) return;
        if (accepted) {
          commit(r.game);
          return;
        }
        const g = r.game;
        commit(
          { ...g, state: { ...g.state, canOfferAtPly: { ...g.state.canOfferAtPly, [human]: ply + DRAW_COOLDOWN_PLIES } } },
          { toast: { code: "engine_declined_draw" } },
        );
      })();
    },
    answerDraw() {},
    answerRematch() {},
    cancelRematch() {},

    offerRematch() {
      newGame("rematch");
    },
    restart() {
      newGame("restart");
    },

    hint() {
      if (!canAct() || game.state.turn !== human || store.getState().bot?.thinking) return;
      const state = game.state;
      const fen = state.fen;
      const token = ++hintToken;
      hintAbort?.abort();
      const ac = new AbortController();
      hintAbort = ac;
      void nextHint(state, game.hint, deps.engine, hintCache, ac.signal).then(
        (out) => {
          if (token !== hintToken || !canAct() || game.state.fen !== fen) return;
          if (out.kind === "shown") {
            game = runner.hintShown(game, out.level);
            const bot = store.getState().bot;
            if (bot) store.setState({ ...store.getState(), bot: { ...bot, hint: out.view } }, true);
            persist();
            track("hint_used", { level: out.level });
          } else if (out.kind === "repeat") {
            const bot = store.getState().bot;
            if (bot) store.setState({ ...store.getState(), bot: { ...bot, hint: out.view } }, true);
          }
        },
        () => {
          if (token === hintToken && attached) setBot({ engineError: true });
        },
      );
    },

    undo() {
      if (!canAct()) return;
      const thinking = store.getState().bot?.thinking ?? false;
      if (thinking) cancelBot();
      const r = runner.undo(game, deps.now(), { botThinking: thinking || game.state.turn === botSide });
      if (!r) {
        if (thinking) void runBot(); // nothing to take back: let the bot carry on
        return;
      }
      drawToken++;
      hintToken++;
      hintAbort?.abort();
      commit(r.game, { positionChanged: true, toast: { code: "took_back", params: { text: tookBackText(r.sans, r.firstPly, game.state.startPly) } } });
      track("undo_used", {});
      void runBot();
    },

    sync() {
      if (lost) {
        lost = false;
        lock?.claim();
        setBot({ otherTab: false });
        reloadFromJournal();
        if (!game.ended) {
          // The clocks were frozen on this tab while the other one played: rebase them to now.
          game = { ...game, state: { ...game.state, clocks: { ...game.state.clocks, at: deps.now() } } };
          publish();
        }
        scheduleFlag();
        void runBot();
        return;
      }
      if (store.getState().bot?.engineError) {
        setBot({ engineError: false });
        deps.engine.retry().then(
          () => void runBot(),
          () => {
            if (attached) setBot({ engineError: true });
          },
        );
        return;
      }
      reloadFromJournal();
      scheduleFlag();
      void runBot();
    },

    attach() {
      if (!attached && !viewedOnce) {
        viewedOnce = true;
        withTelemetry((t) => t.trackGameViewed(snapshot));
      }
      attached = true;
      if (snapshot.you.role !== "player") {
        return () => {
          attached = false;
        };
      }
      lost = false;
      const generation = ++attachGeneration;
      const start = () => {
        if (!attached || generation !== attachGeneration) return;
        lock = makeLock(ref, { onLost });
        lock.claim();
        resume();
        if (dom) {
          unlisten = [
            dom.on("visibilitychange", () => setHidden(dom.hidden())),
            dom.on("pagehide", onPageHide),
            dom.on("online", () => {
              if (game.ended) void finish();
            }),
          ];
          hidden = false;
          if (dom.hidden()) setHidden(true);
        }
        startEngine();
        scheduleFlag();
        void runBot();
      };
      defer(start);
      return () => controller.destroy();
    },

    destroy() {
      if (!attached) return;
      attached = false;
      attachGeneration++;
      for (const off of unlisten) off();
      unlisten = [];
      sendCheckpointNow("beacon");
      cancelBot();
      hintAbort?.abort();
      drawToken++;
      clearFlagTimer();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      lock?.close();
      lock = null;
      releaseEngine?.();
      releaseEngine = null;
    },

    peek: () => game,
    setHidden,
  };

  function newGame(reason: "rematch" | "restart") {
    if (snapshot.you.role !== "player") return;
    const tc = snapshot.tc
      ? { initialSeconds: Math.round(snapshot.tc.initialMs / 1000), incrementSeconds: Math.round(snapshot.tc.incrementMs / 1000) }
      : null;
    deps.createGame({ mode: "BOT", parentGameRef: ref, reason, tc });
  }

  return controller;
}

/**
 * The bot game controller for `/game/[ref]` (BotGameScreen). Spectators of a bot game (not watchable in P2) get
 * an inert controller and never start the engine.
 */
export function useLocalGame(snapshot: GameSnapshot): GameController {
  const create = useCreateBotGame();
  const complete = useCompleteBotGame(snapshot.ref);
  const engine = useBotEngine();
  const [controller] = useState<GameController & { attach?: () => () => void }>(() =>
    snapshot.you.role === "player"
      ? createLocalController(snapshot, {
          engine,
          createGame: (body) => create.mutate(body),
          complete: (body) => complete.mutateAsync(body),
          now: () => Date.now(),
          random: () => Math.random(),
        })
      : createInertController(snapshot, { bot: true, now: snapshot.serverNow }),
  );
  useEffect(() => controller.attach?.(), [controller]);
  return controller;
}
