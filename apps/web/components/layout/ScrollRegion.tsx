import "./board-stage.css";
import { cn } from "@/lib/utils";

export type ScrollRegionProps = {
  /** Accessible name of the region, e.g. "Moves". */
  label: string;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "ol" | "ul" | "section";
  "data-testid"?: string;
};

/**
 * The only element allowed to scroll on a one-viewport page (SPEC 10.2, 04 §4.3).
 * Server component. `tabIndex={0}` keeps it keyboard-reachable even when its
 * content has nothing focusable (axe `scrollable-region-focusable`).
 * `overscroll-behavior: contain` stops the scroll chaining into the root.
 */
export function ScrollRegion({ label, className, children, as: Tag = "div", "data-testid": testId }: ScrollRegionProps) {
  return (
    <Tag
      className={cn("rc-scroll", className)}
      data-rc-scroll=""
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid={testId}
    >
      {children}
    </Tag>
  );
}
