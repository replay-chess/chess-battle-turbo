"use client";

// TrainerRunner (phase-05 plan §4.4–4.6, §5.2 S4/S5): one component for the Mistake Bank drill and the puzzle
// session (`payload.kind`). One viewport: BoardStage (trainer variant) with the label bars, the board, the panel and,
// on phones, the control bar. The payload arrives from the page (RSC, `getSession` / `createOrResumeSession`) and seeds
// `qk.train.session(ref)`; the runner never fetches it again. Moves are checked locally; grades go to the IndexedDB
// outbox first and flush in batches (lib/offline); the open session keeps working offline (T8) and is mirrored to
// `rc-offline` for P11.
//
// It owns: the per-instance store (features/train/runner-store.ts) and its merge with attempts still in the outbox
// (resume index, local Again re-queues), the phase timers (setup 400 ms, reply 450 ms, solution 600 ms per ply), the
// keys (useTrainerKeys), the stream extend (useSessionExtend), the session end (flush ≤ 3 s → W4 → summary), skip,
// report, the theme switch, focus after a grade and the runner's telemetry. `demo` (the /dev/ui routes) replays a
// script of user actions to reach a board state and never touches the network or the outbox.
import { useQueryClient } from "@tanstack/react-query";
import { Shapes } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReportBody, ReportResult } from "@repo/contracts/http/reports";
import type { SessionCreateInput, SessionPayload, SessionSource, SessionSummary } from "@repo/contracts/http/train";
import type { GradeKey } from "@repo/chess-training/grade";
import { BoardStage } from "@/components/layout/BoardStage";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { notify } from "@/components/ui/toast";
import { timerFor, type RunEvent } from "@/features/train/machine";
import { createRunnerStore, mergeOutbox, upcomingItem, type RunnerStore } from "@/features/train/runner-store";
import { setResumeUrl } from "@/features/train/resume-url";
import { applyScript, type DemoStep } from "@/features/train/script";
import { captureBrokenItem, markMoveStart, measureGradeToNext } from "@/features/train/telemetry";
import { useGrade } from "@/features/train/useGrade";
import { useSessionExtend, type Extender } from "@/features/train/useSessionExtend";
import { createdSessionSource, noteCreatedSession } from "@/features/train/created-sessions";
import { useTrainerKeys } from "@/features/train/useTrainerKeys";
import { trackTrain } from "@/lib/analytics/train-events";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { trainSessionPath } from "@/lib/api/queries/train";
import { getAttemptsScheduler, installAttemptsSync } from "@/lib/offline/attempts-sync";
import { markStaleEverywhere } from "@/lib/offline/crossTab";
import { pendingAttempts, subscribeOutbox } from "@/lib/offline/outbox";
import { saveSessionSnapshot } from "@/lib/offline/snapshots";
import { registerPageShortcuts, TRAINER_SHORTCUTS } from "@/lib/shell/shortcuts";
import { useStore } from "zustand";
import { RunnerProvider, type ReportReason, type RunnerContextValue, type RunnerUi } from "./context";
import { EmptySession } from "./EmptySession";
import { TrainerBoard } from "./TrainerBoard";
import { PhoneControls } from "./TrainerControls";
import { BottomLabelBar, ratingLine, TopLabelBar } from "./TrainerLabelBar";
import { TrainerPanel } from "./TrainerPanel";
import { useCurrentOf, useShownOf } from "./useCurrent";
import "./trainer.css";

const ThemePicker = dynamic(() => import("./ThemePicker"), { ssr: false });
const ReportDialog = dynamic(() => import("./ReportDialog"), { ssr: false });

/** The summary waits this long for the outbox before navigating (§4.4 "saving"). */
export const SUMMARY_FLUSH_WAIT_MS = 3_000;

export type { DemoStep };

export type TrainerDemo = {
  script: DemoStep[];
  /** `saving`: the done block shows "Saving your results…" for this many queued attempts. */
  pendingOutbox?: number;
  extender?: Extender;
};

export type TrainerRunnerProps = {
  payload: SessionPayload;
  userRef: string;
  source: SessionSource;
  /** The service created this session now (false: resumed with `?s=`, or an active one reused). */
  created?: boolean;
  /** `/train/puzzles?pick=1`: the theme picker opens on load. */
  initialThemesOpen?: boolean;
  demo?: TrainerDemo;
};

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
  }
}

async function createSession(body: SessionCreateInput): Promise<SessionPayload> {
  const { data } = await api(endpoints.trainSessionCreate, { method: "POST", body, idempotencyKey: newIdempotencyKey() });
  return data as SessionPayload;
}

function runnerPath(payload: Pick<SessionPayload, "kind">, ref: string): string {
  return `${payload.kind === "puzzles" ? "/train/puzzles" : "/train/bank/session"}?s=${encodeURIComponent(ref)}`;
}

export function TrainerRunner({ payload, userRef, source, created = false, initialThemesOpen = false, demo }: TrainerRunnerProps) {
  const qc = useQueryClient();
  const router = useRouter();
  const isDemo = demo !== undefined;
  const [store, setStore] = useState<RunnerStore>(() => {
    const s = createRunnerStore({ payload });
    if (demo) applyScript(s, demo.script);
    return s;
  });
  const [ui, setUi] = useState<RunnerUi>(() => ({
    menuOpen: null,
    themesOpen: demo ? demo.script.some((st) => st.type === "themes") : initialThemesOpen,
    reportOpen: false,
    pending: demo?.pendingOutbox ?? 0,
    leaving: false,
  }));
  const statusRef = useRef<HTMLParagraphElement>(null);
  const lastPuzzleAttempt = useRef<string | null>(null);
  const startedAt = useRef(Date.now());
  const mode = useStore(store, (s) => s.mode);
  const done = useStore(store, (s) => s.done);
  const index = useStore(store, (s) => s.index);
  const items = useStore(store, (s) => s.items);
  const broken = useStore(store, (s) => s.broken);
  const solveStreak = useStore(store, (s) => s.solveStreak);
  const rating = useStore(store, (s) => s.rating);
  const ratingDelta = useStore(store, (s) => s.ratingDelta);
  const cur = useCurrentOf(store);
  const shown = useShownOf(store);
  const routeClass = mode;
  const reduceMotion = useReducedMotion();

  // ── seed the cache, mirror for P11, merge the outbox (attempts not flushed yet: resume past them) ──
  useEffect(() => {
    if (isDemo) return;
    qc.setQueryData(qk.train.session(payload.ref), payload);
    void saveSessionSnapshot(userRef, payload);
    // An entry URL (?plan, ?card, ?theme …) becomes the session's resume URL without a second render (§4.4 "a reload
    // resumes"), whether the service created the session or reused an active one.
    if (!new URLSearchParams(window.location.search).has("s")) {
      setResumeUrl(runnerPath(payload, payload.ref));
    }
    let cancelled = false;
    void pendingAttempts(userRef).then((entries) => {
      if (cancelled) return;
      const m = mergeOutbox(payload, entries);
      if (m.resumeIndex > payload.resumeIndex || m.pendingAgain.length) {
        setStore(createRunnerStore({ payload, resumeIndex: m.resumeIndex, pendingAgain: m.pendingAgain }));
      }
      setUi((u) => ({ ...u, pending: entries.filter((e) => e.attempt.sessionRef === payload.ref).length }));
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, qc, payload, userRef]);

  // ── the outbox: tab-wide reactions, this session's results (rating chip, cap, milestones), the pending count ──
  useEffect(() => {
    if (isDemo) return;
    const uninstall = installAttemptsSync(userRef, qc);
    const off = subscribeOutbox(userRef, (e) => {
      if (e.type === "result") {
        const mine = new Set(e.attempts.filter((a) => a.sessionRef === payload.ref).map((a) => a.clientAttemptId));
        const results = e.result.results.filter((r) => mine.has(r.clientAttemptId));
        if (!results.length) return;
        store.getState().applyResults(results, { capRemaining: e.result.capRemaining, ratingFrom: lastPuzzleAttempt.current, rating: e.result.rating ?? null });
        for (const r of results) {
          if (r.status === "ok" && r.theme?.milestone) {
            const label = store.getState().items.find((it) => it.theme.key === r.theme?.key)?.theme.label ?? r.theme.key;
            notify.achievement(`Milestone · ${label.toLowerCase()} ${r.theme.milestone}%`, { id: `milestone-${r.theme.key}` });
          }
        }
      } else if (e.type === "change" || e.type === "flushed") {
        void pendingAttempts(userRef).then((entries) => setUi((u) => ({ ...u, pending: entries.filter((x) => x.attempt.sessionRef === payload.ref).length })));
      } else if (e.type === "paywall") {
        store.getState().end();
      }
    });
    return () => {
      off();
      uninstall();
    };
  }, [isDemo, userRef, qc, store, payload.ref]);

  // The `?` dialog lists the trainer's keys while the runner is mounted.
  useEffect(() => registerPageShortcuts("trainer", TRAINER_SHORTCUTS), []);

  // ── phase timers: setup 400 ms, reply 450 ms, solution 600 ms per ply ──
  const run = useStore(store, (s) => s.run);
  useEffect(() => {
    if (!run) return;
    const t = timerFor(run);
    if (!t) return;
    const ev: RunEvent = t.event;
    const id = setTimeout(() => store.getState().dispatch(ev), t.ms);
    return () => clearTimeout(id);
  }, [run, store]);

  // ── broken items: skipped already by the store; one toast, an auto-report and a Sentry event each ──
  const reportedBroken = useRef(0);
  useEffect(() => {
    if (broken.length <= reportedBroken.current) return;
    const fresh = broken.slice(reportedBroken.current);
    reportedBroken.current = broken.length;
    notify.warning("Skipped a position we couldn't load.", { id: "train-broken" });
    if (isDemo) return;
    for (const id of fresh) {
      const it = store.getState().items.find((x) => x.itemId === id);
      if (!it) continue;
      captureBrokenItem(it.cardRef ?? it.puzzleId, it.kind);
      const targetRef = it.kind === "puzzle" ? it.puzzleId : it.cardRef;
      if (targetRef) void sendReport({ targetType: it.kind === "puzzle" ? "puzzle" : "mistake", targetRef, reason: "illegal_move", fen: it.fen }).catch(() => undefined);
    }
  }, [broken, isDemo, store]);

  // ── telemetry: started once; each item shown; completed / abandoned ──
  const startedSent = useRef(false);
  useEffect(() => {
    if (startedSent.current) return;
    startedSent.current = true;
    const s = store.getState();
    // A session this tab just created (hub, bank, theme picker) opens with `?s=`: report its creating surface, not a resume.
    const local = createdSessionSource(payload.ref);
    trackTrain("train_session_started", {
      kind: s.kind,
      source: local ?? source,
      theme: payload.theme?.key ?? null,
      size: Math.min(40, payload.targetCount ?? payload.items.length),
      items: Math.min(40, payload.items.length),
      counts_toward_cap: payload.countsTowardCap,
      resumed: payload.resumeIndex > 0 || !(created || local !== null),
      widened: payload.widened !== null,
    });
  }, [store, source, payload, created]);
  const shownKey = cur ? `${cur.item.itemId}:${index}` : null;
  const shownLast = useRef<string | null>(null);
  useEffect(() => {
    if (!cur || shownKey === shownLast.current) return;
    shownLast.current = shownKey;
    trackTrain("train_item_shown", { kind: cur.item.kind, theme: cur.item.theme.key, rating: cur.item.rating, pass: cur.item.pass, index: Math.min(1000, index) });
  }, [cur, shownKey, index]);
  const doneSent = useRef(false);
  useEffect(() => {
    if (!done || doneSent.current) return;
    doneSent.current = true;
    const s = store.getState();
    const solved = new Set(s.graded.filter((g) => g.solved).map((g) => g.itemId.replace(/b$/, ""))).size;
    const total = new Set(s.items.map((it) => it.itemId.replace(/b$/, ""))).size;
    const perfect = total >= 3 && s.graded.length > 0 && s.graded.every((g) => g.firstTry);
    trackTrain("train_session_completed", { kind: s.kind, solved: Math.min(40, solved), total: Math.min(40, total), perfect, duration_s: Math.min(86_400, Math.round((Date.now() - startedAt.current) / 1000)) });
  }, [done, store]);
  useEffect(
    () => () => {
      const s = store.getState();
      if (s.done || doneSent.current || isDemo) return;
      const solved = new Set(s.graded.filter((g) => g.solved).map((g) => g.itemId.replace(/b$/, ""))).size;
      const total = new Set(s.items.map((it) => it.itemId.replace(/b$/, ""))).size;
      trackTrain("train_session_abandoned", { kind: s.kind, solved: Math.min(40, solved), total: Math.min(40, total), perfect: false, duration_s: Math.min(86_400, Math.round((Date.now() - startedAt.current) / 1000)) });
    },
    [store, isDemo],
  );

  // ── after a grade: focus the next status line, measure grade → next board ──
  const focusNext = useRef(false);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    statusRef.current?.focus({ preventScroll: true });
    return measureGradeToNext(routeClass);
  }, [index, routeClass]);

  const grade = useGrade({
    store,
    userRef,
    sessionRef: payload.ref,
    demo: isDemo,
    onGraded: (commit, attempt) => {
      focusNext.current = true;
      // Only a rated grade moves the chip (pass 1 outside practice, as the server rates: FIX-1 rating-sync).
      if (commit.item.kind === "puzzle" && commit.item.pass === 1 && payload.kind !== "practice") lastPuzzleAttempt.current = attempt.clientAttemptId;
      if (!isDemo) markStaleEverywhere(qc, [qk.train.today(), ["train", "bank"], qk.home()]);
    },
  });

  useSessionExtend(store, { userRef, extender: demo?.extender, persist: !isDemo });

  // ── actions ──
  const sendReport = async (body: ReportBody): Promise<ReportResult> => {
    const { data } = await api(endpoints.reports, { method: "POST", body, idempotencyKey: newIdempotencyKey() });
    return data as ReportResult;
  };

  const leave = async (reason: "done" | "user") => {
    const s = store.getState();
    if (isDemo) {
      router.push(`/dev/ui/train/summary?state=${s.graded.every((g) => g.firstTry) && s.graded.length >= 3 ? "perfect" : "default"}`);
      return;
    }
    setUi((u) => ({ ...u, leaving: true }));
    // Attempts made on this device for the session: those before this mount (the resume point) and this mount's.
    const graded = s.startIndex + s.graded.length;
    const flush = getAttemptsScheduler(userRef).flush();
    await Promise.race([flush, new Promise((r) => setTimeout(r, SUMMARY_FLUSH_WAIT_MS))]);
    try {
      const { data } = await api(trainSessionPath(endpoints.trainSessionEnd, payload.ref), { method: "POST", body: { reason } });
      qc.setQueryData<SessionSummary>(qk.train.summary(payload.ref), data as SessionSummary);
    } catch {
      // The summary page ends nothing itself; it shows what the server holds and refetches while "Saving…".
    }
    markStaleEverywhere(qc, [qk.train.all(), qk.home(), qk.badges()]);
    if (graded === 0 && reason === "user") router.push("/train");
    else router.push(`/train/session/${encodeURIComponent(payload.ref)}/summary?n=${graded}`);
  };

  const actions: RunnerContextValue["actions"] = {
    move: (m) => {
      markMoveStart();
      const before = store.getState().run;
      store.getState().dispatch({ type: "move", uci: m.uci });
      const after = store.getState().run;
      if (after?.phase === "wrong" && before?.phase !== "wrong" && cur) {
        trackTrain("train_wrong_move", { kind: cur.item.kind, is_game_move: after.wrong?.isGameMove ?? false });
      }
    },
    hint: () => {
      const r = store.getState().run;
      if (!r || r.phase !== "solve" || r.hints >= 2) return false;
      store.getState().dispatch({ type: "hint" });
      trackTrain("train_hint_used", { step: (r.hints + 1) as 1 | 2 });
      return true;
    },
    retry: () => {
      if (store.getState().run?.phase !== "wrong") return false;
      store.getState().dispatch({ type: "retry" });
      return true;
    },
    showSolution: () => {
      const r = store.getState().run;
      if (!r || (r.phase !== "solve" && r.phase !== "wrong")) return false;
      store.getState().dispatch({ type: "show_solution" });
      setUi((u) => ({ ...u, menuOpen: null }));
      if (cur) trackTrain("train_solution_shown", { kind: cur.item.kind, after_wrong: r.phase === "wrong" });
      return true;
    },
    grade: (g) => void grade(g),
    skip: () => {
      const it = store.getState().skip();
      setUi((u) => ({ ...u, menuOpen: null }));
      if (!it) return;
      trackTrain("train_item_skipped", { kind: it.kind });
      if (isDemo || !it.cardRef) return;
      const path = trainSessionPath(endpoints.trainCardSkip, it.cardRef);
      api(path, { method: "POST", body: { sessionRef: payload.ref } })
        .then(() => markStaleEverywhere(qc, [qk.train.today(), ["train", "bank"]]))
        .catch(() => notify.error("Couldn't skip that position. It stays due."));
    },
    endSession: () => {
      setUi((u) => ({ ...u, menuOpen: null }));
      store.getState().end();
      void leave("user");
    },
    seeSummary: () => void leave("done"),
    startAgain: () => {
      if (isDemo) {
        setStore(createRunnerStore({ payload }));
        return;
      }
      createSession({ kind: "practice", fromSessionRef: payload.ref })
        .then((next) => {
          noteCreatedSession(next.ref, "picker");
          qc.setQueryData(qk.train.session(next.ref), next);
          router.replace(runnerPath(next, next.ref));
        })
        .catch(() => notify.error("Couldn't start a practice session. Try again."));
    },
    report: async (reason: ReportReason, note: string) => {
      const it = store.getState().items[store.getState().index];
      setUi((u) => ({ ...u, reportOpen: false }));
      if (!it) return;
      store.getState().skip();
      trackTrain("train_item_reported", { kind: it.kind, reason });
      if (isDemo) return;
      const targetRef = it.kind === "puzzle" ? it.puzzleId : it.cardRef;
      if (!targetRef) return;
      try {
        await sendReport({ targetType: it.kind === "puzzle" ? "puzzle" : "mistake", targetRef, reason, note: note || undefined, fen: it.fen });
        notify.success("Thanks, we'll look at this position.");
      } catch {
        notify.error("Couldn't send the report. Try again later.");
      }
    },
    pickTheme: (key) => {
      const s = store.getState();
      const from = s.theme?.key ?? null;
      setUi((u) => ({ ...u, themesOpen: false }));
      if (key === from) return;
      const pct = payload.themes?.find((t) => t.key === key)?.pct ?? null;
      trackTrain("puzzle_theme_changed", { from, to: key, pct, surface: "picker" });
      if (isDemo) return;
      createSession({ kind: "puzzles", source: "picker", theme: key })
        .then((next) => {
          noteCreatedSession(next.ref, "picker");
          qc.setQueryData(qk.train.session(next.ref), next);
          router.replace(runnerPath(next, next.ref));
        })
        .catch((err: unknown) =>
          notify.error(
            isApiError(err) && err.code === "upstream_unavailable" && err.details?.kind === "disabled"
              ? "Puzzles are taking a break. Your Mistake Bank still works."
              : "Puzzles are unavailable right now. Your Mistake Bank still works.",
          ),
        );
    },
    setMenu: (menuOpen) => setUi((u) => ({ ...u, menuOpen })),
    setThemes: (themesOpen) => setUi((u) => ({ ...u, themesOpen })),
    setReport: (reportOpen) => setUi((u) => ({ ...u, reportOpen, menuOpen: null })),
  };

  useTrainerKeys({
    hint: actions.hint,
    retry: actions.retry,
    solution: actions.showSolution,
    "grade-1": () => gradeKey("again"),
    "grade-2": () => gradeKey("hard"),
    "grade-3": () => gradeKey("good"),
    "grade-4": () => gradeKey("easy"),
    primary: () => {
      if (store.getState().done) {
        actions.seeSummary();
        return true;
      }
      const v = cur?.view;
      if (!v?.graded || !v.suggested) return false;
      actions.grade(v.suggested);
      return true;
    },
    themes: () => {
      if (mode !== "puzzles") return false;
      setUi((u) => ({ ...u, themesOpen: !u.themesOpen }));
      return true;
    },
  });
  function gradeKey(g: GradeKey): boolean {
    if (!cur?.view.graded) return false;
    actions.grade(g);
    return true;
  }

  const ctx: RunnerContextValue = { store, actions, ui, demo: isDemo, backHref: isDemo ? "/dev/ui/train/hub" : "/train" };
  const next = upcomingItem({ items, index });
  const titleLabel = `${payload.header.title} · ${Math.min(done ? items.length : index + 1, items.length)} of ${items.length}`;

  if (payload.empty || (!items.length && !payload.stream)) {
    return <EmptySession reason={payload.empty ?? "caughtup"} mode={mode} demo={isDemo} />;
  }

  return (
    <RunnerProvider value={ctx}>
      <TopBarTitle>
        <span className="tr-topbar">
          <span className="tr-lbl tr-topbar__t" data-testid="trainer-topbar-title">
            {titleLabel}
          </span>
          {mode === "puzzles" ? (
            <button
              type="button"
              className="tr-topbar__ib"
              aria-label="Choose a theme"
              aria-haspopup="dialog"
              aria-expanded={ui.themesOpen}
              onClick={() => actions.setThemes(!ui.themesOpen)}
              data-testid="trainer-topbar-themes"
            >
              <Shapes aria-hidden="true" size={20} />
            </button>
          ) : null}
        </span>
      </TopBarTitle>
      <div data-rc-trainer="" data-mode={mode} style={{ display: "contents" }} data-testid="trainer" data-done={done ? "" : undefined} data-phase={run?.phase ?? "done"}>
        <BoardStage
          label="Puzzle board"
          asideWidth="trainer"
          bars="labels"
          top={shown ? <TopLabelBar item={shown.item} status={done ? "Session done" : shown.view.status} rating={ratingLine(mode, solveStreak, rating, ratingDelta)} streakReset={!done && shown.view.streakReset} /> : <span />}
          bottom={shown ? <BottomLabelBar item={shown.item} side={shown.prepared.userSide} demo={isDemo} /> : <span />}
          board={
            shown ? (
              <TrainerBoard current={shown} next={done ? null : next} routeClass={routeClass} animate={!reduceMotion} onMove={actions.move} />
            ) : (
              <div className="tr-boards" data-testid="trainer-board" />
            )
          }
          aside={<TrainerPanel queueLabels={payload.queueLabels} statusRef={statusRef} />}
          footer={<PhoneControls mode={mode} />}
        />
      </div>
      {mode === "puzzles" ? (
        <ThemePicker open={ui.themesOpen} onOpenChange={actions.setThemes} options={payload.themes} current={payload.theme?.key ?? null} onPick={actions.pickTheme} />
      ) : null}
      {ui.reportOpen ? <ReportDialog open={ui.reportOpen} onOpenChange={actions.setReport} onSubmit={actions.report} /> : null}
    </RunnerProvider>
  );
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

