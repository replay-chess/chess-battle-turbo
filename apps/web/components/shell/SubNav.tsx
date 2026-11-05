"use client";

import Link from "next/link";
import { destinationHref, isSubnavItemCurrent, type SubnavGroup } from "@/lib/nav/destinations";
import type { DestinationKey } from "@/lib/shell/types";
import { cn } from "@/lib/utils";

/**
 * Sub-destination strip for rail and tab-bar modes (C B2), so Tournaments and
 * Openings stay reachable when the sidebar's sub-list is hidden. Real links,
 * not tabs. Renders nothing when the current destination has no subs.
 */
export function SubNav({
  nav,
  current,
  me,
  hideInTabbar = false,
  demo = false,
  preview = false,
  onNavigate,
}: {
  nav: SubnavGroup | null;
  current: Set<DestinationKey>;
  me: { referenceId: string };
  /** Phone detail routes show Back instead. */
  hideInTabbar?: boolean;
  demo?: boolean;
  preview?: boolean;
  onNavigate?: (key: DestinationKey) => void;
}) {
  if (!nav) return null;
  return (
    <nav
      aria-label={nav.label}
      data-testid="subnav"
      className={cn(
        "hidden min-h-11 items-stretch gap-6 border-b border-cb-border px-4 rail:flex narrow:px-6 tablet-portrait:px-6 tabbar:px-4",
        hideInTabbar && "tabbar:hidden",
      )}
    >
      {nav.items.map((d) => (
        <Link
          key={d.key}
          href={destinationHref(d, me, { demo, preview })}
          data-testid={`subnav-item-${d.key}`}
          aria-current={isSubnavItemCurrent(d.key, current) ? "page" : undefined}
          className="relative inline-flex min-h-11 items-center text-ui text-cb-text-soft after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 hover:text-cb-text focus-visible:-outline-offset-2 aria-[current=page]:font-medium aria-[current=page]:text-cb-text aria-[current=page]:after:bg-cb-accent [-webkit-tap-highlight-color:transparent]"
          onClick={() => onNavigate?.(d.key)}
        >
          {d.label}
        </Link>
      ))}
    </nav>
  );
}
