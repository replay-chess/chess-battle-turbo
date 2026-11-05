import { cn } from "@/lib/utils";

export type SpinnerProps = {
  /** 12 / 14 px. Default md. */
  size?: "sm" | "md";
  /** With a label: role="status" plus sr-only text. Without: aria-hidden, the adjacent text carries the meaning. */
  label?: string;
  className?: string;
};

/** Under reduced motion the spin freezes; the label carries the meaning. */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full border-2 border-current border-r-transparent animate-rc-spin motion-reduce:animate-none",
        size === "sm" ? "size-3" : "size-3.5",
        !label && className,
      )}
    />
  );
  if (!label) return ring;
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
