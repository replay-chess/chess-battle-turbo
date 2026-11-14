"use client";

// The runner's controls (§4.4 "Footer controls"):
//   solving   Hint (→ Show Arrow → Hint Used) + ⋯ menu
//   wrong     Try Again (primary, R) + Solution (S)
//   graded    the grade bar is in the panel; the phone bar says "Grade it above to get the next puzzle"
// `PanelControls` sits at the panel's foot (desktop, iPad); `PhoneControls` is BoardStage's footer (phones).
import { useRunnerContext } from "./context";
import { GRADE_LABELS, GRADE_ORDER } from "./GradeBar";
import { HintButton } from "./HintButton";
import { seeInGameHref } from "./TrainerLabelBar";
import { TrainerMenu } from "./TrainerMenu";
import { useCurrent } from "./useCurrent";

function useControls() {
  const { actions, ui, demo } = useRunnerContext();
  const cur = useCurrent();
  const v = cur?.view ?? null;
  const kind: "solve" | "wrong" | "graded" | "none" = !v ? "none" : v.wrong ? "wrong" : v.graded ? "graded" : "solve";
  return { actions, ui, v, kind, gameHref: cur ? seeInGameHref(cur.item, demo) : null };
}

/**
 * The four grades in the control bar, shown only on very short phones (Safari at 150 %: a 395 px stage), where the
 * board keeps its 220 px floor and the sheet has no room for the grade bar; the sheet's bar hides there (trainer.css).
 * Same buttons, names and keys as GradeBar (FIX-1).
 */
function CompactGrades() {
  const { actions } = useRunnerContext();
  const cur = useCurrent();
  const v = cur?.view;
  if (!cur || !v?.graded || !v.suggested) return null;
  const preview = cur.item.preview;
  return (
    <div className="tr-ctl__grades" role="group" aria-label="How well did you know it?" data-testid="trainer-grades-compact">
      {GRADE_ORDER.map((g, i) => (
        <button
          key={g}
          type="button"
          className={g === v.suggested ? "tr-btn-p" : "tr-btn-s"}
          onClick={() => actions.grade(g)}
          aria-keyshortcuts={String(i + 1)}
          data-grade={g}
        >
          <span>{GRADE_LABELS[g]}</span>
          {preview ? <span className="tr-vh">, next review in {preview[g].label}</span> : null}
          {g === v.suggested ? <span className="tr-vh">, suggested</span> : null}
        </button>
      ))}
    </div>
  );
}

function MenuButton({ phone }: { phone: boolean }) {
  const { actions, ui, v, gameHref } = useControls();
  return (
    <TrainerMenu
      open={ui.menuOpen === (phone ? "phone" : "panel")}
      onOpenChange={(open) => actions.setMenu(open ? (phone ? "phone" : "panel") : null)}
      canShowSolution={!!v && !v.graded && v.status !== "Here is the solution"}
      onSolution={() => void actions.showSolution()}
      onSkip={actions.skip}
      onEnd={actions.endSession}
      onReport={() => actions.setReport(true)}
      seeInGameHref={gameHref}
      label={phone ? "More: solution, skip, end session" : "More: solution, skip, end session, report"}
      testId={phone ? "trainer-menu-phone" : "trainer-menu"}
    />
  );
}

function WrongRow({ phone = false }: { phone?: boolean }) {
  const { actions } = useControls();
  return (
    <>
      <button type="button" className="tr-btn-p" onClick={() => void actions.retry()} aria-keyshortcuts="R" data-testid={phone ? "trainer-retry-phone" : "trainer-retry"}>
        Try Again
      </button>
      <button type="button" className="tr-btn-s" onClick={() => void actions.showSolution()} aria-keyshortcuts="S" data-testid={phone ? "trainer-solution-phone" : "trainer-solution"}>
        Solution
      </button>
    </>
  );
}

export function PanelControls() {
  const { actions, v, kind } = useControls();
  if (kind === "none" || kind === "graded" || !v) return null;
  return (
    <div className="tr-foot tr-side-only" data-testid="trainer-controls">
      {kind === "wrong" ? (
        <div className="tr-foot__row" data-wrong="">
          <WrongRow />
        </div>
      ) : (
        <div className="tr-foot__row">
          <HintButton label={v.hint.label} disabled={v.hint.disabled} onHint={() => void actions.hint()} />
          <MenuButton phone={false} />
        </div>
      )}
    </div>
  );
}

export function PhoneControls({ mode }: { mode: "bank" | "puzzles" }) {
  const { actions, v, kind } = useControls();
  if (kind === "none" || !v) return <div className="tr-ctl" data-k="done" />;
  if (kind === "graded") {
    return (
      <div className="tr-ctl" data-k="graded">
        <span className="tr-lbl tr-ctl__hint">Grade it above to get the next {mode === "puzzles" ? "puzzle" : "position"}</span>
        <CompactGrades />
      </div>
    );
  }
  if (kind === "wrong") {
    return (
      <div className="tr-ctl" data-k="wrong">
        <WrongRow phone />
      </div>
    );
  }
  return (
    <div className="tr-ctl" data-k="solve">
      <HintButton label={v.hint.label} disabled={v.hint.disabled} onHint={() => void actions.hint()} testId="trainer-hint-phone" />
      <MenuButton phone />
    </div>
  );
}
