"use client";

// FilterPopover (SPEC 7.2; README Filter pattern, V4Profile): a "Filter" button
// with an active-count badge, opening the active chips, the filter controls and
// a Clear All / Show footer.
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "./button";
import { CountBadge } from "./count-badge";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type FilterPopoverProps = {
  /** Active filters; the badge hides at 0. */
  count: number;
  /** The active-filter chips row. */
  chips?: React.ReactNode;
  children: React.ReactNode;
  onClearAll?: () => void;
  /** Primary footer button, e.g. "Show 24 Games". Clicking it calls onShow and closes. */
  showLabel?: string;
  onShow?: () => void;
  /** px, default 340. */
  width?: number;
  /** Overline and aria-label of the content. Default "Filters". */
  title?: string;
  /** On the trigger. */
  "data-testid"?: string;
  /** On the popover content. */
  contentTestId?: string;
  className?: string;
};

export function FilterPopover({
  count,
  chips,
  children,
  onClearAll,
  showLabel,
  onShow,
  width = 340,
  title = "Filters",
  "data-testid": testId,
  contentTestId,
  className,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          iconStart={<SlidersHorizontal />}
          data-testid={testId}
          className={className}
        >
          {/* Accessible name "Filter, {n} active" from the content rather than an
              aria-label, so the visible text stays a prefix of the name (axe
              label-content-name-mismatch). */}
          <span aria-hidden="true">Filter</span>
          <span className="sr-only">{count > 0 ? `Filter, ${count} active` : "Filter"}</span>
          <CountBadge count={count} />
        </Button>
      </PopoverTrigger>
      <PopoverContent width={width} title={title} data-testid={contentTestId}>
        {chips ? <div className="flex flex-wrap gap-2">{chips}</div> : null}
        {children}
        {onClearAll || showLabel ? (
          <div className="flex items-center justify-between border-t border-cb-border pt-3">
            {onClearAll ? (
              <Button variant="text" size="sm" onClick={onClearAll}>
                Clear All
              </Button>
            ) : (
              <span />
            )}
            {showLabel ? (
              <Button
                size="sm"
                onClick={() => {
                  onShow?.();
                  setOpen(false);
                }}
              >
                {showLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
