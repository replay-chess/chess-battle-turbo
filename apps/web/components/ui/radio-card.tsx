"use client";

// RadioCardGroup and RadioCard (SPEC 6.2; 02 §5.11 `.radio` and the `.thm` swatch).
import { createContext, use } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type RadioCardVariant = "row" | "swatch";
const VariantContext = createContext<RadioCardVariant>("row");

export type RadioCardGroupProps = Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, "dir"> & {
  /** row = 56px option rows; swatch = theme swatches in a grid. Default row. */
  variant?: RadioCardVariant;
};

/** A labelled radio group (aria-label or aria-labelledby is required); arrow keys move the selection. */
export function RadioCardGroup({ variant = "row", className, ...props }: RadioCardGroupProps) {
  return (
    <VariantContext value={variant}>
      <RadioGroupPrimitive.Root
        data-variant={variant}
        loop
        className={cn(
          variant === "swatch" ? "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2" : "flex flex-col gap-2",
          className,
        )}
        {...props}
      />
    </VariantContext>
  );
}

export type RadioCardProps = Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, "children"> & {
  label: React.ReactNode;
  /** row only: a second line under the label. */
  description?: React.ReactNode;
  /** row only: right-aligned content (a price, a tag). */
  meta?: React.ReactNode;
  /** swatch only: the 2:1 preview drawn above the label. */
  swatch?: React.ReactNode;
};

const ITEM =
  "group cursor-pointer border border-cb-border-strong bg-cb-surface text-left text-cb-text transition-colors duration-150 [-webkit-tap-highlight-color:transparent] " +
  "hover:bg-cb-fill active:bg-cb-fill data-[state=checked]:border-cb-accent data-[state=checked]:shadow-[inset_0_0_0_1px_var(--cb-accent)] " +
  "forced-colors:data-[state=checked]:outline forced-colors:data-[state=checked]:outline-2 forced-colors:data-[state=checked]:-outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:text-cb-text-disabled";

function Ring() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-cb-border-input group-data-[state=checked]:border-cb-accent"
    >
      <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-cb-accent" />
    </span>
  );
}

export function RadioCard({ label, description, meta, swatch, className, ...props }: RadioCardProps) {
  const variant = use(VariantContext);
  if (variant === "swatch") {
    return (
      <RadioGroupPrimitive.Item {...props} className={cn(ITEM, "flex min-h-12 flex-col gap-1.5 p-2 text-ui", className)}>
        {swatch ? (
          <span aria-hidden="true" className="block aspect-[2/1] w-full overflow-hidden">
            {swatch}
          </span>
        ) : null}
        <span className="flex items-center gap-2">
          <Ring />
          <span className="min-w-0">{label}</span>
        </span>
      </RadioGroupPrimitive.Item>
    );
  }
  return (
    <RadioGroupPrimitive.Item
      {...props}
      className={cn(ITEM, "grid min-h-14 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-body", className)}
    >
      <Ring />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description ? <span className="text-ui text-cb-text-soft">{description}</span> : null}
      </span>
      {meta ? <span className="text-ui text-cb-text-soft">{meta}</span> : <span />}
    </RadioGroupPrimitive.Item>
  );
}
