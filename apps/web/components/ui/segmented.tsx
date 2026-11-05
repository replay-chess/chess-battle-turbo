"use client";

// Segmented (SPEC 6.2; 02 §5.4, C13): a value picker with radio semantics, so the
// arrow keys move the selection. Never role="tab"; a control that switches panels
// is <Tabs variant="segmented">.
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type SegmentedItem<T extends string = string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

export type SegmentedProps<T extends string = string> = {
  value: T;
  onValueChange: (v: T) => void;
  items: SegmentedItem<T>[];
  "aria-label": string;
  /** Full width, equal segments. */
  fill?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  "data-testid"?: string;
};

export function Segmented<T extends string = string>({
  value,
  onValueChange,
  items,
  "aria-label": ariaLabel,
  fill = false,
  disabled,
  name,
  className,
  "data-testid": testId,
}: SegmentedProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={ariaLabel}
      orientation="horizontal"
      loop
      disabled={disabled}
      name={name}
      data-testid={testId}
      className={cn(
        "border border-cb-border-strong bg-cb-surface",
        fill ? "flex w-full" : "inline-flex max-w-full",
        className,
      )}
    >
      {items.map((item) => (
        <RadioGroupPrimitive.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          className={cn(
            "tap-target inline-flex min-h-[2.375rem] items-center justify-center gap-1.5 border-0 border-r border-cb-border-strong bg-transparent px-3.5 whitespace-nowrap last:border-r-0 pointer-coarse:min-h-11",
            "cursor-pointer text-ui text-cb-text-soft transition-colors duration-150 [-webkit-tap-highlight-color:transparent] [&_svg]:size-4 [&_svg]:shrink-0",
            "hover:bg-cb-fill hover:text-cb-text active:bg-cb-fill focus-visible:-outline-offset-2",
            "data-[state=checked]:bg-cb-accent data-[state=checked]:text-cb-accent-fg",
            "forced-colors:data-[state=checked]:outline forced-colors:data-[state=checked]:outline-2 forced-colors:data-[state=checked]:-outline-offset-2",
            "disabled:cursor-not-allowed disabled:text-cb-text-disabled",
            // Equal segments may wrap their label rather than push the row past its box.
            fill && "min-w-0 flex-1 basis-0 py-1 text-center leading-tight whitespace-normal",
          )}
        >
          {item.icon ? (
            <span aria-hidden="true" className="inline-flex">
              {item.icon}
            </span>
          ) : null}
          {item.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
