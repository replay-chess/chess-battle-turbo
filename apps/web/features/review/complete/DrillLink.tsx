"use client";

// Review complete's Drill These {n} Mistakes primary (P5, phase-05 plan §4.8, §10.1): the funnel's
// `drill_from_review_clicked` (then `train_session_started{source: review_complete}` on the runner). A client island
// in the server-rendered page: a plain link otherwise (never prefetched: it creates a session).
import Link from "next/link";
import { trackReview } from "../telemetry";

/** The funnel event, from the click and from CompleteKeys' Enter (FIX-2: the keyboard path counts too). */
export function trackDrillClicked(mistakes: number): void {
  trackReview("drill_from_review_clicked", { mistakes: Math.min(10, Math.max(1, mistakes)) });
}

export function DrillLink({ href, mistakes, className, children }: { href: string; mistakes: number; className: string; children: React.ReactNode }) {
  return (
    <Link
      className={className}
      href={href}
      prefetch={false}
      data-testid="complete-primary"
      data-kind="drill"
      onClick={() => trackDrillClicked(mistakes)}
    >
      {children}
    </Link>
  );
}
