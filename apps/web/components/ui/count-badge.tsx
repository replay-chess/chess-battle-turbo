import { cn } from "@/lib/utils";

export type CountBadgeProps = {
  count: number;
  /** Counts above max render as "max+". Default 99. */
  max?: number;
  /** sr-only text; omitted → aria-hidden. */
  label?: string;
  tone?: "accent" | "neutral";
  className?: string;
};

/** Returns null when count <= 0. */
export function CountBadge({ count, max = 99, label, tone = "accent", className }: CountBadgeProps) {
  if (!(count > 0)) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none tabular-nums",
        tone === "accent"
          ? "bg-cb-accent text-cb-accent-fg"
          : "border border-cb-border-strong bg-cb-fill text-cb-text",
        className,
      )}
    >
      {text}
      {label ? <span className="sr-only">{` ${label}`}</span> : null}
    </span>
  );
}
