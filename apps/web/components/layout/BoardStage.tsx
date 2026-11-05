import "./board-stage.css";

export type BoardStageProps = {
  /** `<ChessBoard squareSize="fill" …/>`. */
  board: React.ReactNode;
  /** Opponent player bar. */
  top?: React.ReactNode;
  /** Own player bar. */
  bottom?: React.ReactNode;
  /** Side panel in side mode, the strip under the board in stack mode. Compose a ScrollRegion inside. */
  aside?: React.ReactNode;
  /** Stack-mode control bar (phones, iPad portrait); hidden in side mode. */
  footer?: React.ReactNode;
  /** 300–360px (V3Game, default) or 300–400px (V3PlayHub). */
  asideWidth?: "game" | "hub";
  /** aria-label of the board section, e.g. "Board". */
  label: string;
};

/**
 * The board region inside `main` (SPEC 10.2, 04 §4.4): player bars, board,
 * aside and the phone control bar. Server component, CSS only; the board edge
 * is `--rc-board`, computed from the stage's own size with container-query units.
 *
 * The root carries `data-rc-lock`, which switches the enclosing ViewportStage
 * to lock mode (SPEC D15): 100dvh, and the document never scrolls.
 *
 * Gotchas (04 §5.2):
 * - Don't register `--rc-board` with `@property`. Unregistered, its cq units
 *   resolve where `var(--rc-board)` is used (the column, the board slot, the
 *   aside), against `.rc-stage`. Registered, it would compute to px where it is
 *   declared, and on `.rc-stage` itself cq falls back to the small viewport.
 * - The container needs a definite size from outside (the `minmax(0,1fr)` page
 *   track, or a grid cell with a set height). In a `flex:none` column or an
 *   auto-height block, `container-type:size` collapses to its 18.5rem minimum.
 * - Never read `--rc-board` inside ChessBoard. The fill board is its own
 *   inline-size container, so cq units there resolve against the board; it just
 *   fills `width:100%` of its slot.
 * - `container-type` makes `.rc-stage` (and the fill board) a containing block
 *   for `position: fixed` descendants. `PromotionPopup` (`fixed inset-0`,
 *   PromotionPopup.tsx:32,41) and any other overlay must portal to `body` when
 *   Phase 2 puts it inside a stage, or it is positioned and clipped by the stage.
 * - `--rc-mode` (side | stack) is readable from JS after hydration only. Never
 *   use it to choose the first render.
 */
export function BoardStage({ board, top, bottom, aside, footer, asideWidth = "game", label }: BoardStageProps) {
  const bars = (top ? 1 : 0) + (bottom ? 1 : 0);
  return (
    <div className="rc-stage" data-rc-stage="" data-rc-lock="">
      <div
        className="rc-stage__in"
        data-aside={aside ? "" : undefined}
        data-footer={footer ? "" : undefined}
        data-aside-w={asideWidth}
        style={{ "--rc-nbars": bars } as React.CSSProperties}
      >
        <section className="rc-stage__col" aria-label={label}>
          {top ? (
            <div className="rc-stage__bar" data-rc-bar="top">
              {top}
            </div>
          ) : null}
          <div className="rc-stage__board" data-rc-board-slot="">
            {board}
          </div>
          {bottom ? (
            <div className="rc-stage__bar" data-rc-bar="bottom">
              {bottom}
            </div>
          ) : null}
        </section>
        {aside ? (
          <aside className="rc-stage__aside" data-rc-aside="">
            {aside}
          </aside>
        ) : null}
        {footer ? (
          <div className="rc-stage__foot" data-rc-controls="">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
