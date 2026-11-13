// One step's stage (phase-04 plan §4.0): the panel (a <form>: Enter submits the primary action, also from a mobile
// keyboard's Go key), its scrolling body and pinned footer, and the aside. Compact layouts hide the aside and show
// `inline` instead: a board fills what the body leaves on phones and sits above the h1 on iPad portrait
// (`kind: "board"`, V3iPhoneOnbWelcome/V3iPadOnbWelcome); a card goes at the end of the body (`kind: "card"`,
// V3iPhoneOnbLink). No hooks, so step components (client) and server pages can both use it.
import { Fragment } from "react";

export type OnbInline =
  | {
      kind: "board";
      board: React.ReactNode;
      label?: React.ReactNode;
      /** iPad portrait board width (board: 440 or 380). */
      tabletWidth?: 440 | 380;
      /** iPad portrait: above the h1 (Welcome, Level, Done) or at the end of the body with `caption` (Activating). */
      tabletAt?: "top" | "end";
      /** iPad portrait, `tabletAt: "end"` only: the line under the board. */
      caption?: React.ReactNode;
    }
  | { kind: "card"; node: React.ReactNode };

export type OnbStageProps = {
  /** The panel's accessible name ("Link your account"). */
  label: string;
  /** The footer: secondary action left, primary right (OnbFooter). */
  footer: React.ReactNode;
  /** The desktop / iPad landscape aside (null: one column). */
  aside?: React.ReactNode;
  /** The compact copy of the aside. */
  inline?: OnbInline | null;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /**
   * Where the form goes WITHOUT JavaScript (a tap before hydration): a same-site path, sent as GET. Without it a
   * tap before hydration posts the page to itself (INTEGRATE-2: Activating's Continue on a slow phone reloaded
   * Activating instead of opening Done). After hydration `onSubmit` prevents the native submit.
   */
  action?: string;
  /** data-state for specs and the state-coverage tags. */
  state?: string;
  testId?: string;
  children: React.ReactNode;
};

export function OnbStage({ label, footer, aside, inline, onSubmit, action, state, testId, children }: OnbStageProps) {
  const top =
    inline?.kind === "board" && inline.tabletAt !== "end" ? (
      <div className="onb-inline-top">
        <div data-tb={inline.tabletWidth ?? 440}>
          {inline.board}
        </div>
      </div>
    ) : null;
  const end =
    inline?.kind === "board" ? (
      <div className="onb-inline-end onb-mboard" data-kind="board" role="group" aria-label="Preview">
        <div className="onb-mboard__b">{inline.board}</div>
        {inline.label ? <span className="onb-lbl onb-mboard__l">{inline.label}</span> : null}
        {inline.caption ? <p className="onb-p onb-mboard__c">{inline.caption}</p> : null}
      </div>
    ) : inline?.kind === "card" ? (
      <div className="onb-inline-end" data-kind="card">
        {inline.node}
      </div>
    ) : null;

  return (
    <div
      className="onb-stage"
      data-aside={aside ? "on" : "none"}
      data-tb-at={inline?.kind === "board" && inline.tabletAt === "end" ? "end" : undefined}
      data-state={state}
      data-testid={testId}
    >
      <section className="onb-panel" aria-label={label}>
        <form className="onb-form" onSubmit={onSubmit} noValidate {...(action ? { action, method: "get" } : {})}>
          <div className="onb-body">
            {top}
            <Fragment>{children}</Fragment>
            {end}
          </div>
          <div className="onb-foot">{footer}</div>
        </form>
      </section>
      {aside ? (
        <aside className="onb-aside" aria-label="Preview">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** The step's h1: focus target after navigation (tabIndex −1, `data-onb-h1`). */
export function StepHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h1 className="onb-h1" tabIndex={-1} data-onb-h1="" id={id}>
      {children}
    </h1>
  );
}

/** Footer layout: `secondary` (Skip / Back / Not Me) on the left, the primary on the right. */
export function OnbFooter({ secondary, primary }: { secondary?: React.ReactNode; primary: React.ReactNode }) {
  return (
    <>
      {secondary ?? null}
      <span className="onb-foot__spacer" />
      {primary}
    </>
  );
}
