"use client";

// WeaknessList (phase-06 plan §4.6 "Left section Top weaknesses", §4.11 keyboard): the list label, the 1–3 top rows
// (rows 4–5 with "See all"), one open at a time; ↓ / ↑ / Home / End move between the row headers (WAI-ARIA accordion
// optional keys). "See all" moves the focus to row 4's header. In drill mode (a selected pattern, inline surface) the
// rows switch to the drill board's anatomy and a selected row of `more` is shown even while rows 4–5 are folded.
import { useEffect, useId, useRef } from "react";
import type { WeaknessPayload, WeaknessRow } from "@repo/contracts/http/weakness";
import { cn } from "@/lib/utils";
import { IPAD_L_SR_ONLY } from "./classes";
import { listLabel, rateScaleMax, showsBand, visibleRows } from "./model";
import { MoreRow } from "./MoreRow";
import { WeaknessRowView, type RowMode } from "./WeaknessRow";

const KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function WeaknessList({
  payload,
  openIndex,
  showAll,
  selectedSlug,
  inlineDrill,
  onToggleRow,
  onToggleShowAll,
  onDrill,
  config,
  className,
}: {
  payload: WeaknessPayload;
  openIndex: number;
  showAll: boolean;
  /** The pattern the drill config is open for (from the URL), or null. */
  selectedSlug: string | null;
  /** The config renders inside the list (desktop, iPad L); phones and iPad P use the sheet. */
  inlineDrill: boolean;
  onToggleRow: (index: number, row: WeaknessRow) => void;
  onToggleShowAll: () => void;
  onDrill: (row: WeaknessRow) => void;
  config: (row: WeaknessRow) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-rows`;
  const ref = useRef<HTMLDivElement>(null);
  const drillMode = inlineDrill && selectedSlug !== null && [...payload.top, ...payload.more].some((r) => r.slug === selectedSlug);
  const selectedInMore = drillMode && payload.more.some((r) => r.slug === selectedSlug);
  const rows = visibleRows(payload, showAll || selectedInMore);
  const scaleMax = rateScaleMax([...payload.top, ...payload.more]);
  const withBand = showsBand(payload);
  const moreable = payload.listMode !== "most_frequent" && payload.more.length > 0;

  // "See all" → focus row 4's header (only after the member asked, never on mount).
  const focusRow4 = useRef(false);
  useEffect(() => {
    if (!showAll || !focusRow4.current) return;
    focusRow4.current = false;
    ref.current?.querySelectorAll<HTMLElement>("[data-wk-head]")[3]?.focus();
  }, [showAll]);

  return (
    <section
      aria-label="Top weaknesses"
      // shrink-0 (FIX-1): in the scrolling column (FIT_COL) a shrinkable list was squeezed to the column's height and
      // its rows 4–5, See all and the drill config spilled under the week plan, unclickable; the column now scrolls.
      className={cn("flex shrink-0 flex-col gap-2.5 tabbar:gap-2", className)}
      data-testid="weakness-list"
      data-mode={drillMode ? "drill" : "profile"}
      ref={ref}
      onKeyDown={(e) => {
        if (!KEYS.has(e.key)) return;
        const target = e.target as HTMLElement;
        if (!target.hasAttribute("data-wk-head")) return;
        const heads = [...(ref.current?.querySelectorAll<HTMLElement>("[data-wk-head]") ?? [])];
        const i = heads.indexOf(target);
        if (i < 0 || heads.length === 0) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? heads.length - 1 : e.key === "ArrowDown" ? (i + 1) % heads.length : (i - 1 + heads.length) % heads.length;
        heads[next]?.focus();
      }}
    >
      <span className={cn("text-overline", IPAD_L_SR_ONLY)} data-testid="weakness-list-label">
        <span className="tabbar:hidden">{listLabel(payload, false)}</span>
        <span className="hidden tabbar:inline">{listLabel(payload, true)}</span>
      </span>
      <div id={listId} className="flex flex-col gap-2.5 tabbar:gap-2">
        {rows.map((row, i) => {
          const mode: RowMode = drillMode ? (row.slug === selectedSlug ? "drill-selected" : "drill-other") : "accordion";
          return (
            <WeaknessRowView
              key={row.pattern}
              row={row}
              rank={row.rank}
              open={!drillMode && openIndex === i}
              mode={mode}
              scaleMax={scaleMax}
              withBand={withBand}
              onToggle={() => onToggleRow(i, row)}
              onDrill={onDrill}
              bodyId={`${id}-body-${i}`}
              config={mode === "drill-selected" ? config(row) : undefined}
            />
          );
        })}
      </div>
      {moreable ? (
        <MoreRow
          more={payload.more.length}
          total={payload.top.length + payload.more.length}
          showAll={showAll}
          controls={listId}
          onToggle={() => {
            focusRow4.current = !showAll;
            onToggleShowAll();
          }}
        />
      ) : null}
    </section>
  );
}
