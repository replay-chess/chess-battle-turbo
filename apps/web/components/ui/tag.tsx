// Tag (SPEC 3.5, 6.2; 02 §5.7): `.tag`, `.pill`, `.s5-chip` and `.stat`.
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type TagProps = React.ComponentProps<"span"> & {
  /** Default neutral. */
  tone?: "neutral" | "good" | "warn" | "bad" | "ink";
  /** .tag | .pill, default sm. */
  size?: "sm" | "md";
  /** outline (.tag/.pill) | tint (.s5-chip, the trial tag) | metric (.stat). Default outline. */
  variant?: "outline" | "tint" | "metric";
  icon?: React.ReactNode;
};

const tagVariants = cva(
  "inline-flex items-center whitespace-nowrap border font-mono font-medium uppercase tracking-label [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "gap-1 px-1.5 py-0.5 text-2xs",
        md: "gap-1.5 px-2 py-0.5 text-label leading-[1.5]",
      },
      variant: {
        outline: "",
        tint: "min-h-7 px-2.5",
        metric: "min-h-7 px-2.5 bg-cb-surface text-xs normal-case tracking-normal",
      },
      tone: {
        neutral: "border-cb-border-strong text-cb-text-soft",
        good: "border-cb-good/45 text-cb-good",
        warn: "border-cb-warn/45 text-cb-warn",
        bad: "border-cb-bad/45 text-cb-bad",
        ink: "border-cb-accent bg-cb-accent text-cb-accent-fg",
      },
    },
    compoundVariants: [
      { variant: "tint", tone: "neutral", className: "bg-cb-fill" },
      { variant: "tint", tone: "good", className: "bg-cb-good-bg" },
      { variant: "tint", tone: "warn", className: "bg-cb-warn-bg" },
      { variant: "tint", tone: "bad", className: "bg-cb-bad-bg" },
      { variant: "metric", tone: "neutral", className: "text-cb-text" },
      { variant: "metric", tone: "good", className: "bg-cb-good-bg" },
      { variant: "metric", tone: "warn", className: "bg-cb-warn-bg" },
      { variant: "metric", tone: "bad", className: "bg-cb-bad-bg" },
      { variant: "metric", tone: "ink", className: "bg-cb-accent" },
    ],
    defaultVariants: { size: "sm", variant: "outline", tone: "neutral" },
  },
);

/**
 * A non-interactive label. The meaning is always in the text ("Trial · 5 days
 * left", "Attack"); the tone only reinforces it. The shell's trial tag is
 * `<Tag tone="warn" variant="tint">`.
 */
export function Tag({ tone = "neutral", size = "sm", variant = "outline", icon, className, children, ...props }: TagProps) {
  return (
    <span
      data-tone={tone}
      data-size={size}
      data-variant={variant}
      className={cn(tagVariants({ size, variant, tone }), className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
