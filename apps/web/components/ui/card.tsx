// Card, CardHeader, CardBody (SPEC 6.2; 02 §5.8 `.card`).
import { cloneElement, isValidElement } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Overline } from "./divider";

type CardPadding = "none" | "sm" | "md" | "lg" | "xl";

const PADDING: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-3.5",
  md: "px-4.5 py-4",
  lg: "p-5",
  xl: "p-7",
};

const cardVariants = cva("block min-h-0 rounded-none border border-cb-border bg-cb-surface text-cb-text", {
  variants: {
    interactive: {
      true: "cursor-pointer transition-colors duration-150 [-webkit-tap-highlight-color:transparent] hover:bg-cb-fill active:bg-cb-fill",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
});

export type CardProps = React.ComponentProps<"section"> & {
  /** Default section. A section is a landmark only when it has an accessible name (aria-labelledby). */
  as?: "section" | "article" | "div" | "a";
  /** With as="a". */
  href?: string;
  /** 0 / 14 / 18×16 / 20 / 28 px. Default md. */
  padding?: CardPadding;
  /** The whole card is one link or button (`.ovc`): hover fill, no nested interactive elements. */
  interactive?: boolean;
  /** Render the single child (e.g. next/link) with card styles. */
  asChild?: boolean;
};

export function Card({ as = "section", padding = "md", interactive = false, asChild = false, className, ...props }: CardProps) {
  const classes = cn(cardVariants({ interactive }), PADDING[padding], className);
  if (asChild && isValidElement<{ className?: string }>(props.children)) {
    // A server-safe slot: the single child keeps its own props and gains the card classes.
    const child = props.children;
    return cloneElement(child, { className: cn(classes, child.props.className) });
  }
  // Every allowed tag takes the same HTMLElement props; the cast only narrows the union for JSX.
  const Tag = as as "section";
  return <Tag className={classes} {...props} />;
}

export type CardHeaderProps = {
  title: React.ReactNode;
  action?: React.ReactNode;
  /** Id of the title, for the card's aria-labelledby. */
  id?: string;
  /** Default 2. */
  headingLevel?: 2 | 3;
  className?: string;
};

/** A header row with an overline title and an optional action, ruled below. */
export function CardHeader({ title, action, id, headingLevel = 2, className }: CardHeaderProps) {
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-3 border-b border-cb-border px-3.5 py-2.5", className)}>
      <Overline as={headingLevel === 3 ? "h3" : "h2"} id={id}>
        {title}
      </Overline>
      {action ? <div className="-my-1.5 flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  padding = "md",
  className,
  ...props
}: React.ComponentProps<"div"> & { padding?: CardPadding }) {
  return <div className={cn(PADDING[padding], className)} {...props} />;
}
