import { cn } from "@/lib/utils";

export type ViewportStageProps = {
  /** Sidebar or rail; its column is var(--nav) wide. */
  nav?: React.ReactNode;
  /** Shown in tab-bar mode (or always with topbarAlways). */
  topbar?: React.ReactNode;
  /** Phone tab bar; pass nothing on game screens. */
  tabbar?: React.ReactNode;
  /** Rows above the page; they shrink the page and never overlay it. */
  banner?: React.ReactNode;
  /** 64px top bar on desktop too (48px at <= 640 tall). */
  topbarAlways?: boolean;
  /** Exactly one page child. */
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
};

/**
 * The root viewport primitive (SPEC 3.4). Server-compatible: no hooks.
 * Slots render only when passed; CSS in viewport.css drops their sizes to 0
 * otherwise. A page opts into lock mode by containing `[data-rc-lock]`.
 */
export function ViewportStage({
  nav,
  topbar,
  tabbar,
  banner,
  topbarAlways,
  children,
  className,
  "data-testid": testId,
}: ViewportStageProps) {
  const hasNav = nav != null && nav !== false;
  const hasTopbar = topbar != null && topbar !== false;
  const hasTabbar = tabbar != null && tabbar !== false;
  return (
    <div
      className={cn("rc-vs", topbarAlways && "rc-vs--topbar-always", className)}
      data-rc-viewport=""
      data-has-nav={hasNav ? "" : undefined}
      data-testid={testId}
    >
      {hasNav || hasTopbar ? (
        <a className="rc-skip" href="#main" data-testid="skip-link">
          Skip to Content
        </a>
      ) : null}
      {hasNav ? (
        <div className="rc-vs__nav" data-rc-nav="">
          {nav}
        </div>
      ) : null}
      {hasTopbar ? (
        <div className="rc-vs__top" data-rc-topbar="">
          {topbar}
        </div>
      ) : null}
      <main id="main" className="rc-vs__main" data-rc-main="" tabIndex={-1}>
        <div className="rc-vs__banner" data-rc-banner="">
          {banner}
        </div>
        <div className="rc-vs__page">{children}</div>
      </main>
      {hasTabbar ? (
        <div className="rc-vs__tab" data-rc-tabbar="">
          {tabbar}
        </div>
      ) : null}
    </div>
  );
}
