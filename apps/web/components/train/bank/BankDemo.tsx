"use client";

// /dev/ui/train/bank (phase-05 plan §2.1 "Dev demo routes"): the Mistake Bank in every board state from WP-A's
// contract fixtures, with no server. Tabs, filters, selection and the filter surface work on the fixture rows exactly as
// on a complete bank (local state instead of the URL); the CTAs show their pending state and go nowhere. `remove` turns
// on the `bank-remove` row menu (D-2): Remove hides the row with a 6 s Undo toast.
import { useState } from "react";
import { bankDemo, P5_FIXTURE_NOW, type BankDemoState } from "@/app/dev/ui/_fixtures/train";
import { notify } from "@/components/ui/toast";
import { dayWord } from "../hub/when";
import { BankSkeleton } from "./BankSkeleton";
import { BankView } from "./BankView";
import { EMPTY_FILTER, type BankFilterState } from "./model";

const DEMO_NOW_MS = Date.parse(P5_FIXTURE_NOW);

export type BankDemoProps = { state: BankDemoState | "remove"; stress: boolean; routeSkeleton: boolean; filterOpen: boolean };

export function BankDemo({ state, stress, routeSkeleton, filterOpen: openOnMount }: BankDemoProps) {
  const demo = bankDemo(state === "remove" ? "default" : state, stress);
  const initial: BankFilterState = demo
    ? { ...EMPTY_FILTER, view: demo.filter.view ?? null, theme: demo.filter.theme ?? null, phase: demo.filter.phase ?? null, source: demo.filter.source ?? null }
    : EMPTY_FILTER;
  // `default`, `empty` and `caughtup` open with no tab chosen (the server's state decides the body), as the route does.
  const [filter, setFilter] = useState<BankFilterState>(state === "default" || state === "remove" ? EMPTY_FILTER : initial);
  const [sel, setSel] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(openOnMount);
  const [starting, setStarting] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

  if (!demo || (state === "loading" && routeSkeleton)) return <BankSkeleton />;
  const page = demo.page;
  const rows = page.rows.filter((r) => !removed.has(r.cardRef));
  const nextDay = page.nextBatch ? dayWord(page.nextBatch.at, DEMO_NOW_MS, "UTC") : null;

  return (
    <BankView
      page={page}
      rows={rows}
      complete={demo.complete}
      filter={filter}
      sel={sel}
      nextDay={nextDay}
      onFilter={setFilter}
      onSelect={setSel}
      onOpenRow={(row) => setSel(row.cardRef)}
      onStart={() => {
        setStarting(true);
        setTimeout(() => setStarting(false), 1_200);
      }}
      starting={starting}
      filterOpen={filterOpen}
      onFilterOpenChange={setFilterOpen}
      removable={state === "remove"}
      onRemove={(row) => {
        setRemoved((prev) => new Set(prev).add(row.cardRef));
        notify.undo("Removed from your Mistake Bank", {
          id: `bank-remove-${row.cardRef}`,
          onUndo: () =>
            setRemoved((prev) => {
              const next = new Set(prev);
              next.delete(row.cardRef);
              return next;
            }),
        });
      }}
    />
  );
}
