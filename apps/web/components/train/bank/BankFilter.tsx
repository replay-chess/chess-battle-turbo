"use client";

// The Mistake Bank's Filter (phase-05 plan §4.3 `filtered`, `BankFilter`; DR/V3MistakeBank popover, the phone and
// iPad portrait sheets): the button with its active count, and from the first open its surface (BankFilterSurface: a
// popover on desktop and iPad landscape, a bottom sheet in tab-bar mode). The surface and its popover, dialog and
// toggle primitives load on that first open (warmed on hover or focus), so they are not in /train/bank's First Load JS.
//
// Filters apply live (each chip updates the URL and, for a complete bank, the list behind it instantly, as the design
// does); "Show 4 Positions" closes the surface.
import { lazy, Suspense, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { BankPage } from "@repo/contracts/http/train";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/count-badge";
import { cn } from "@/lib/utils";
import { activeFilterCount, type BankFilterState } from "./model";

export type BankFilterProps = {
  filter: BankFilterState;
  facets: BankPage["facets"];
  onChange: (next: BankFilterState) => void;
  /** The positions the current filter shows; null while unknown (a large bank). */
  results: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Show n Positions": closes, and the screen records `bank_filter_applied`. */
  onShow: () => void;
  className?: string;
};

export function FilterButton({ count, className, ...rest }: { count: number } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="secondary" iconStart={<SlidersHorizontal />} data-testid="bank-filter" className={cn("px-3", className)} {...rest}>
      <span aria-hidden="true">Filter</span>
      <span className="sr-only">{count > 0 ? `Filter positions, ${count} active` : "Filter positions"}</span>
      <CountBadge count={count} />
    </Button>
  );
}

const loadSurface = () => import("./BankFilterSurface");
const BankFilterSurface = lazy(() => loadSurface().then((m) => ({ default: m.BankFilterSurface })));

export function BankFilter(props: BankFilterProps) {
  const { filter, open, onOpenChange, className } = props;
  // Mounted from the first open on, so later opens and every close keep the surface's own transitions.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const button = (
    <FilterButton
      count={activeFilterCount(filter)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={className}
      onClick={() => onOpenChange(true)}
      onPointerEnter={() => void loadSurface()}
      onFocus={() => void loadSurface()}
    />
  );
  if (!mounted) return button;
  return (
    <Suspense fallback={button}>
      <BankFilterSurface {...props} />
    </Suspense>
  );
}
