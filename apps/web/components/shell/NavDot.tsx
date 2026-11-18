// The nav status dot (phase-06 plan §1.1 "a dot appears on Train when the profile is ready"; DS README "Shape": round
// only what is a dot or a badge). The dot is decorative; `NavDotLabel`, placed after the item's label, names it for
// screen readers ("Train, new weakness profile"). On the sidebar's current item (accent background) the dot takes the
// accent's foreground.
import { cn } from "@/lib/utils";

export const NAV_DOT_LABEL = "new weakness profile";

export function NavDot({ className, testId }: { className?: string; testId?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={cn(
        "size-2 shrink-0 rounded-full bg-cb-accent group-aria-[current=page]:bg-cb-accent-fg forced-colors:bg-[CanvasText]",
        className,
      )}
    />
  );
}

export function NavDotLabel() {
  return <span className="sr-only">, {NAV_DOT_LABEL}</span>;
}
