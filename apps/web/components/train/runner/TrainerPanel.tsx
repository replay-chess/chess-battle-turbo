"use client";

// The runner's panel (BoardStage aside; V3BankSession / V3Puzzle* `.side`): the header (title, Bank link or Theme
// button, progress), the live region (status, tags, coach, hint note, grade bar, the source / puzzle / session cards,
// the queue, the done block) and the controls (Hint + ⋯, or Try Again + Solution). On phones the header and the
// controls hide (the status block and the control bar carry them) and the body is the sheet.
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { SessionPayload } from "@repo/contracts/http/train";
import { CoachLine } from "./CoachLine";
import { useRunner, useRunnerContext } from "./context";
import { DoneBlock, doneLine } from "./DoneBlock";
import { GradeBar } from "./GradeBar";
import { PuzzleCard, SessionCard } from "./PuzzleCards";
import { QueueList } from "./QueueList";
import { RuleLine } from "./RuleLine";
import { SessionProgress } from "./SessionProgress";
import { SourceCard } from "./SourceCard";
import { StatusLine } from "./StatusLine";
import { PanelControls } from "./TrainerControls";
import { useCurrent } from "./useCurrent";

/** The last results of this mount, newest last, at most 8 (V3PuzzleSolve `hist`). */
const RESULT_DOTS = 8;

export function TrainerPanel({ queueLabels, statusRef }: { queueLabels: SessionPayload["queueLabels"]; statusRef: React.Ref<HTMLParagraphElement> }) {
  const { actions, ui, demo } = useRunnerContext();
  const cur = useCurrent();
  const mode = useRunner((s) => s.mode);
  const title = useRunner((s) => s.title);
  const theme = useRunner((s) => s.theme);
  const items = useRunner((s) => s.items);
  const index = useRunner((s) => s.index);
  const done = useRunner((s) => s.done);
  const graded = useRunner((s) => s.graded);
  const solveStreak = useRunner((s) => s.solveStreak);
  const rating = useRunner((s) => s.rating);
  const stream = useRunner((s) => s.stream);
  const extend = useRunner((s) => s.extend);
  const kind = useRunner((s) => s.kind);

  const view = cur?.view ?? null;
  const solvedCurrent = view?.graded ?? false;
  const prefix = mode === "puzzles" ? "Session" : "Drill";
  const shownIndex = done ? items.length : index + 1;
  const progress = `${prefix} · ${Math.min(shownIndex, items.length)} of ${items.length}`;
  const results = graded.map((g) => g.grade !== "again").slice(-RESULT_DOTS);
  const ratingValue = rating ? Math.round(rating.value) : null;
  const sessLabel = `Puzzle ${Math.min(shownIndex, items.length)} of ${items.length} · Streak ${solveStreak}${ratingValue !== null ? ` · Rating ${ratingValue}` : ""}`;
  const pct = items.length ? Math.round(((index + (solvedCurrent ? 1 : 0)) / items.length) * 100) : 100;

  return (
    <div className="tr-panel" data-testid="trainer-panel">
      <header className="tr-head tr-side-only">
        <div className="tr-head__row">
          <h1 className="tr-h1">{title}</h1>
          {mode === "puzzles" ? (
            <button
              type="button"
              className="tr-chip"
              aria-haspopup="dialog"
              aria-expanded={ui.themesOpen}
              aria-keyshortcuts="T"
              onClick={() => actions.setThemes(!ui.themesOpen)}
              data-testid="trainer-theme-button"
            >
              Theme: {theme?.label ?? "Mixed"}
              <ChevronDown aria-hidden="true" size={14} />
            </button>
          ) : (
            <Link className="tr-chip" href={demo ? "/dev/ui/train/bank" : "/train/bank"} prefetch={false}>
              Bank
            </Link>
          )}
        </div>
        <SessionProgress label={progress} index={index} total={items.length} solvedCurrent={solvedCurrent} done={done} />
      </header>
      <div className="rc-scroll tr-body" data-rc-scroll="" role="region" aria-label="Puzzle details" tabIndex={0}>
        {!done && cur && view ? (
          <>
            <div className="tr-live" aria-live="polite" aria-atomic="false">
              <StatusLine ref={statusRef} text={view.status} />
              <div className="tr-tags tr-side-only">
                <span className="tr-tag">{cur.item.theme.label}</span>
                {mode === "puzzles" ? (
                  cur.item.rating !== null ? <span className="tr-tag">{cur.item.rating}</span> : null
                ) : (
                  <span className="tr-tag">{cur.item.context ? "From your game" : kind === "practice" ? "Practice" : "From your bank"}</span>
                )}
              </div>
              {view.coach ? <CoachLine text={view.coach.text} tone={view.coach.tone} verified={view.coach.verified} /> : null}
              {view.hintNote ? <span className="tr-hintnote tr-mono">{view.hintNote}</span> : null}
            </div>
            {view.graded && view.suggested && view.gradeNote ? (
              <GradeBar preview={cur.item.preview} suggested={view.suggested} note={view.gradeNote} onGrade={actions.grade} />
            ) : null}
            {!view.graded && mode === "bank" && cur.item.context ? <SourceCard context={cur.item.context} /> : null}
            {!view.graded && mode === "bank" && cur.item.preview ? <RuleLine preview={cur.item.preview} /> : null}
            {/* "This puzzle" shows while solving (§4.5): not in the wrong state, whose footer has no Hint (V3PuzzleSolve-wrong). */}
            {!view.graded && !view.wrong && mode === "puzzles" ? <PuzzleCard item={cur.item} hinted={view.hint.step > 0} /> : null}
            {mode === "bank" && !view.graded ? <QueueList items={items} labels={queueLabels} index={index} solvedCurrent={solvedCurrent} /> : null}
            {mode === "puzzles" ? <SessionCard label={sessLabel} pct={pct} results={results} /> : null}
          </>
        ) : null}
        {!done && !cur && stream && extend === "pending" ? (
          <p role="status" className="tr-status">
            Loading more puzzles…
          </p>
        ) : null}
        {done ? (
          <DoneBlock
            line={doneLine(graded.length, items.length, mode === "puzzles" && kind === "puzzles")}
            saving={ui.pending > 0}
            leaving={ui.leaving}
            note={extend === "failed" ? "No more puzzles right now." : null}
            onSummary={actions.seeSummary}
            onAgain={actions.startAgain}
            canAgain={graded.length > 0 && kind !== "practice"}
          />
        ) : null}
      </div>
      {!done ? <PanelControls /> : null}
    </div>
  );
}
