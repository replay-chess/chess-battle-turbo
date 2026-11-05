"use client";

// Tabs (SPEC 6.2; 02 §5.5): underline (`.tabs`), overline (TrainHub `.tab`) and
// segmented (panel switchers drawn like Segmented). Automatic activation.
import { createContext, use } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type TabsVariant = "underline" | "overline" | "segmented";
type TabsFit = "fill" | "auto";

const VariantContext = createContext<TabsVariant>("underline");
const FitContext = createContext<TabsFit>("fill");

export type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
  /** Default underline. */
  variant?: TabsVariant;
};

export function Tabs({ variant = "underline", className, ...props }: TabsProps) {
  return (
    <VariantContext value={variant}>
      <TabsPrimitive.Root data-variant={variant} className={cn("flex min-w-0 flex-col", className)} {...props} />
    </VariantContext>
  );
}

export type TabsListProps = React.ComponentProps<typeof TabsPrimitive.List> & {
  /** fill: triggers share the width; auto: triggers keep their own width. Default fill. */
  fit?: TabsFit;
};

/**
 * The tab row. Underline and overline lists scroll sideways when the tabs don't
 * fit (no visible scrollbar); the active tab scrolls into view when it changes.
 * The 1px rule is an inset shadow, so the scrolling box never clips the 2px underline.
 */
export function TabsList({ fit = "fill", className, ...props }: TabsListProps) {
  const variant = use(VariantContext);
  return (
    <FitContext value={fit}>
      <TabsPrimitive.List
        data-fit={fit}
        className={cn(
          variant === "segmented"
            ? cn("border border-cb-border-strong bg-cb-surface", fit === "fill" ? "flex w-full" : "inline-flex max-w-full")
            : "scrollbar-hide flex overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--cb-border)]",
          className,
        )}
        {...props}
      />
    </FitContext>
  );
}

export type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  icon?: React.ReactNode;
};

const TRIGGER_BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 [-webkit-tap-highlight-color:transparent] focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-cb-text-disabled [&_svg]:size-4 [&_svg]:shrink-0 forced-colors:data-[state=active]:outline forced-colors:data-[state=active]:outline-2 forced-colors:data-[state=active]:-outline-offset-2";

const TRIGGER: Record<TabsVariant, string> = {
  underline:
    "min-h-11 border-0 border-b-2 border-transparent bg-transparent px-2.5 text-ui text-cb-text-soft hover:text-cb-text data-[state=active]:border-cb-accent data-[state=active]:font-medium data-[state=active]:text-cb-text",
  overline:
    "min-h-12 border-0 border-b-2 border-transparent bg-transparent px-2.5 font-mono text-label font-medium tracking-label uppercase text-cb-text-soft hover:text-cb-text data-[state=active]:border-cb-accent data-[state=active]:text-cb-text",
  segmented:
    "tap-target min-h-[2.375rem] border-0 border-r border-cb-border-strong bg-transparent px-3.5 text-ui text-cb-text-soft last:border-r-0 hover:bg-cb-fill hover:text-cb-text active:bg-cb-fill pointer-coarse:min-h-11 data-[state=active]:bg-cb-accent data-[state=active]:text-cb-accent-fg",
};

const TRIGGER_FIT: Record<TabsVariant, Record<TabsFit, string>> = {
  underline: { fill: "flex-auto", auto: "flex-none" },
  overline: { fill: "flex-1 basis-0", auto: "flex-none" },
  segmented: { fill: "flex-1 basis-0", auto: "flex-none" },
};

function revealActive(el: HTMLElement) {
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function TabsTrigger({ icon, className, children, onFocus, onClick, ...props }: TabsTriggerProps) {
  const variant = use(VariantContext);
  const fit = use(FitContext);
  const text = typeof children === "string" ? children : undefined;
  return (
    <TabsPrimitive.Trigger
      className={cn(TRIGGER_BASE, TRIGGER[variant], TRIGGER_FIT[variant][fit], className)}
      onFocus={(e) => {
        onFocus?.(e);
        revealActive(e.currentTarget);
      }}
      onClick={(e) => {
        onClick?.(e);
        revealActive(e.currentTarget);
      }}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {variant === "underline" && text ? (
        // Reserves the bold width, so the row doesn't shift when the active tab turns medium.
        <span
          data-label={text}
          className="inline-flex flex-col items-center after:invisible after:block after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]"
        >
          {children}
        </span>
      ) : (
        children
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("min-h-0 min-w-0", className)} {...props} />;
}
