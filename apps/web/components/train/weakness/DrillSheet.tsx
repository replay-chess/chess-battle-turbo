"use client";

// DrillSheet (phase-06 plan §4.7 "iPad P and phones"): the drill config in a bottom Sheet over the profile, max 70 % of
// the viewport, titled "Drill {label lower}", the CTA pinned to its bottom with the safe-area padding. The screen
// pushes `/train/weakness/{slug}` when it opens it, so Back and Esc close it. Loaded with next/dynamic (phones only).
import type { WeaknessRow } from "@repo/contracts/http/weakness";
import { drillTitle } from "@repo/chess-training/weakness/drill";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DrillConfig, type DrillControls } from "./DrillConfig";

export default function DrillSheet({ row, rating, controls, onClose }: { row: WeaknessRow; rating: number | null; controls: DrillControls; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent title={drillTitle(row.pattern)} className="max-h-[70dvh]" bodyClassName="pb-0" data-testid="weakness-drill-sheet">
        <DrillConfig row={row} rating={rating} controls={controls} layout="sheet" />
      </SheetContent>
    </Sheet>
  );
}
