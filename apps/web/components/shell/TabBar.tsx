"use client";

import Link from "next/link";
import { destinationHref, tabBarDestinations, type NavFlags } from "@/lib/nav/destinations";
import type { DestinationKey } from "@/lib/shell/types";
import { NavDot, NavDotLabel } from "./NavDot";

/** Phone and iPad-portrait tab bar: Play, Learn, Profile in Phase 1. */
export function TabBar({
  me,
  current,
  navFlags,
  trainDot = false,
  demo = false,
  preview = false,
  previewLabel,
  onNavigate,
}: {
  me: { referenceId: string };
  current: Set<DestinationKey>;
  /** Flag-gated destinations (P3: Review). */
  navFlags?: NavFlags;
  /** P6: a new weakness profile is waiting (the Train tab's dot; `useTrainDot`). */
  trainDot?: boolean;
  demo?: boolean;
  preview?: boolean;
  previewLabel?: string;
  onNavigate?: (key: DestinationKey) => void;
}) {
  const items = tabBarDestinations(navFlags);
  return (
    <nav
      aria-label={previewLabel ?? "Main navigation"}
      data-testid="shell-tabbar"
      className="grid h-full border-t border-cb-border bg-cb-bg"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((d) => {
        const Icon = d.icon;
        const dot = d.key === "train" && trainDot;
        return (
          <Link
            key={d.key}
            href={destinationHref(d, me, { demo, preview })}
            data-testid={`tab-item-${d.key}`}
            aria-current={current.has(d.key) ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-cb-text-soft aria-[current=page]:font-semibold aria-[current=page]:text-cb-text focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] active:bg-cb-fill"
            onClick={() => onNavigate?.(d.key)}
          >
            {Icon && dot ? (
              <span className="relative inline-flex">
                <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                <NavDot testId={`tab-dot-${d.key}`} className="absolute -top-0.5 -right-1" />
              </span>
            ) : Icon ? (
              <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
            ) : null}
            <span>{d.label}</span>
            {dot ? <NavDotLabel /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
