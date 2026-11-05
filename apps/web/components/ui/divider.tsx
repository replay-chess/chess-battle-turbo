// Divider, Overline, Eyebrow (SPEC 6.2; 02 §5.18 `.or`, `.lbl`, `.eyebrow`).
import { cn } from "@/lib/utils";

/**
 * A hairline rule. With a label it is the `.or` divider (mono label between two
 * rules); without one it is an <hr> (implicit separator role).
 */
export function Divider({ label, className }: { label?: React.ReactNode; className?: string }) {
  if (label == null) return <hr className={cn("h-px w-full shrink-0 border-0 bg-cb-border", className)} />;
  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 text-overline before:h-px before:flex-1 before:bg-cb-border after:h-px after:flex-1 after:bg-cb-border",
        className,
      )}
    >
      {label}
    </div>
  );
}

type OverlineTag = "h2" | "h3" | "span" | "p" | "label" | "legend";

export type OverlineProps = React.HTMLAttributes<HTMLElement> & {
  /** Default span. */
  as?: OverlineTag;
  /** With as="label". */
  htmlFor?: string;
};

/**
 * The 11px mono uppercase label (`.lbl`, 6.1:1). It carries its own colour:
 * don't add a text-cb-* colour class.
 */
export function Overline({ as = "span", className, ...props }: OverlineProps) {
  const Tag = as;
  return <Tag className={cn("text-overline", className)} {...props} />;
}

/**
 * The spaced marketing eyebrow with 48px rules (`.eyebrow`).
 * Marketing pages only: the README forbids divider-plus-eyebrow stacks on app screens.
 */
export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-eyebrow", className)} {...props} />;
}
