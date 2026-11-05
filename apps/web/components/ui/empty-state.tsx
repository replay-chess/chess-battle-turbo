// EmptyState (SPEC 3.5, 6.2; 03 §12.1, V3EmptyStates): a ghost of the filled state,
// a serif Title Case headline, one line on what fills it, one primary and at most
// one secondary text link, centred in its region.
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title: string;
  body?: React.ReactNode;
  /** A 40px icon disc above the title (mostly for the card size). */
  icon?: React.ReactNode;
  /** Dashed ghost rows of the filled state; default 3 (page), 0 (card). */
  ghostRows?: number;
  /** Default page. */
  size?: "page" | "card";
  /** One primary action (a Button, or Button asChild around a Link). */
  primary?: React.ReactNode;
  /** At most one secondary text link. */
  secondary?: React.ReactNode;
  /** Default 2. */
  headingLevel?: 2 | 3;
  className?: string;
  "data-testid"?: string;
};

/** Dashed border alpha steps 0.22 → 0.16 → 0.10 over --cb-border-dashed (0.22). */
const GHOST_OPACITY = ["opacity-100", "opacity-[0.73]", "opacity-[0.45]"];

export function EmptyState({
  title,
  body,
  icon,
  ghostRows,
  size = "page",
  primary,
  secondary,
  headingLevel = 2,
  className,
  "data-testid": testId,
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const rows = Math.max(0, ghostRows ?? (size === "page" ? 3 : 0));
  const page = size === "page";
  return (
    <div
      data-testid={testId}
      data-size={size}
      className={cn(
        "flex w-full flex-col items-center justify-center text-center",
        page ? "flex-1 gap-4 px-6 py-12" : "gap-2.5 border border-cb-border bg-cb-surface p-4.5",
        className,
      )}
    >
      {rows > 0 ? (
        <div aria-hidden="true" className={cn("flex w-full flex-col gap-2", page ? "mb-2 max-w-md" : "max-w-xs")}>
          {Array.from({ length: rows }, (_, i) => (
            <span
              key={i}
              className={cn(
                "block h-11 border border-dashed border-cb-border-dashed",
                GHOST_OPACITY[Math.min(i, GHOST_OPACITY.length - 1)],
              )}
            />
          ))}
        </div>
      ) : null}
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex size-10 items-center justify-center rounded-full bg-cb-fill text-cb-text-soft [&_svg]:size-[18px]"
        >
          {icon}
        </span>
      ) : null}
      <Heading
        className={cn(
          "font-serif font-normal tracking-[-0.01em] text-balance text-cb-text",
          page ? "text-[2.25rem]/[1.05]" : "text-2xl/[1.1]",
        )}
      >
        {title}
      </Heading>
      {body ? <div className="max-w-md text-body text-pretty text-cb-text-soft">{body}</div> : null}
      {primary || secondary ? (
        <div className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-2", page ? "mt-2" : "mt-1")}>
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
