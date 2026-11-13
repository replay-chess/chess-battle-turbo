"use client";

// The /games source tabs (phase-04 plan §4.11; DR/V3GamesArchive.dc.html `.tabs` role="tablist" aria-label="Source"):
// `All · Replay Chess · Chess.com · Lichess`, each with its count. A tablist over one panel (the list + aside, whose
// id the selected tab controls). Roving tabindex; arrows / Home / End move the focus, Enter or Space (or a click)
// picks the tab, so arrowing through the tabs does not refetch the list on every key (manual activation).
import { useRef } from "react";
import type { GameSourceWire } from "@repo/contracts/http/review";
import { cn } from "@/lib/utils";
import { formatCount } from "@/components/accounts/copy";
import type { SourceTab, SourceTabId } from "../model/sources";

export function SourceTabs({
  tabs,
  current,
  panelId,
  onPick,
}: {
  tabs: SourceTab[];
  current: GameSourceWire | undefined;
  panelId: string;
  onPick: (source: GameSourceWire | null) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active: SourceTabId = current ?? "all";
  const focusAt = (i: number) => refs.current[(i + tabs.length) % tabs.length]?.focus();
  return (
    <div
      role="tablist"
      aria-label="Source"
      data-testid="games-source-tabs"
      className="scrollbar-hide flex max-w-[560px] shrink-0 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--cb-border)] tabbar:max-w-none"
    >
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            data-testid={`games-source-${t.id}`}
            onClick={() => {
              if (!selected) onPick(t.id === "all" ? null : t.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") focusAt(i + 1);
              else if (e.key === "ArrowLeft") focusAt(i - 1);
              else if (e.key === "Home") focusAt(0);
              else if (e.key === "End") focusAt(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
            className={cn(
              "inline-flex min-h-11 flex-auto cursor-pointer items-center justify-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-2.5 text-ui whitespace-nowrap text-cb-text-soft transition-colors duration-150 [-webkit-tap-highlight-color:transparent] hover:text-cb-text focus-visible:-outline-offset-2 vh700:min-h-10",
              selected && "border-cb-accent font-medium text-cb-text forced-colors:outline forced-colors:outline-2 forced-colors:-outline-offset-2",
            )}
          >
            {t.label}
            <span className="font-mono text-xs font-normal text-cb-text-soft">{formatCount(t.count)}</span>
          </button>
        );
      })}
    </div>
  );
}
