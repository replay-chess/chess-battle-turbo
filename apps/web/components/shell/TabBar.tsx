"use client";

import Link from "next/link";
import { destinationHref, tabBarDestinations, type NavFlags } from "@/lib/nav/destinations";
import type { DestinationKey } from "@/lib/shell/types";

/** Phone and iPad-portrait tab bar: Play, Learn, Profile in Phase 1. */
export function TabBar({
  me,
  current,
  navFlags,
  demo = false,
  preview = false,
  previewLabel,
  onNavigate,
}: {
  me: { referenceId: string };
  current: Set<DestinationKey>;
  /** Flag-gated destinations (P3: Review). */
  navFlags?: NavFlags;
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
        return (
          <Link
            key={d.key}
            href={destinationHref(d, me, { demo, preview })}
            data-testid={`tab-item-${d.key}`}
            aria-current={current.has(d.key) ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-cb-text-soft aria-[current=page]:font-semibold aria-[current=page]:text-cb-text focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] active:bg-cb-fill"
            onClick={() => onNavigate?.(d.key)}
          >
            {Icon ? <Icon aria-hidden="true" size={20} strokeWidth={1.75} /> : null}
            <span>{d.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
