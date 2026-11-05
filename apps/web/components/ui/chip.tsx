"use client";

// Chip, ChipGroup, RemovableChip (SPEC 6.2; 02 §5.3, C5).
import { createContext, use } from "react";
import { X } from "lucide-react";
import { cva } from "class-variance-authority";
import { Slot, Toggle as TogglePrimitive, ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type ChipSize = "sm" | "md";

const chipVariants = cva(
  [
    "tap-target inline-flex items-center gap-1.5 whitespace-nowrap rounded-none border border-cb-border-strong bg-cb-surface px-3.5 text-sm text-cb-text",
    "cursor-pointer transition-colors duration-150 select-none [-webkit-tap-highlight-color:transparent] [&_svg]:size-4 [&_svg]:shrink-0",
    "hover:bg-cb-fill active:bg-cb-fill",
    "data-[state=on]:border-cb-accent data-[state=on]:bg-cb-accent data-[state=on]:text-cb-accent-fg",
    "forced-colors:data-[state=on]:outline forced-colors:data-[state=on]:outline-2 forced-colors:data-[state=on]:-outline-offset-2",
    "disabled:cursor-not-allowed disabled:text-cb-text-disabled",
  ],
  {
    variants: {
      size: {
        sm: "min-h-9 pointer-coarse:min-h-11",
        md: "min-h-10 pointer-coarse:min-h-11",
      },
      mono: {
        true: "justify-center px-1 font-mono text-ui",
        false: "",
      },
    },
    defaultVariants: { size: "md", mono: false },
  },
);

type GroupContext = { inGroup: boolean; size?: ChipSize; mono?: boolean };
const ChipGroupContext = createContext<GroupContext>({ inGroup: false });

export type ChipProps = Omit<React.ComponentProps<"button">, "value"> & {
  /** Standalone chips only: a two-state toggle (aria-pressed). */
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  /** Inside a ChipGroup: the item value (required there). */
  value?: string;
  /** 36 / 40 px drawn, 44 on coarse pointers. Default md, or the group's size. */
  size?: ChipSize;
  /** Time controls: mono, centred, tight padding. Default false, or the group's setting. */
  mono?: boolean;
  /** Link chips (palette suggestions): renders the child with chip styles, no toggle semantics. */
  asChild?: boolean;
};

/**
 * A pressable chip (`.chip`). Standalone it is a Radix Toggle; inside a
 * ChipGroup it is a ToggleGroup item and needs `value`.
 */
export function Chip({
  pressed,
  defaultPressed,
  onPressedChange,
  value,
  size,
  mono,
  asChild = false,
  className,
  children,
  ...props
}: ChipProps) {
  const group = use(ChipGroupContext);
  const classes = cn(chipVariants({ size: size ?? group.size, mono: mono ?? group.mono }), className);

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  if (group.inGroup) {
    return (
      <ToggleGroupPrimitive.Item value={value ?? ""} className={classes} {...props}>
        {children}
      </ToggleGroupPrimitive.Item>
    );
  }
  return (
    <TogglePrimitive.Root
      pressed={pressed}
      defaultPressed={defaultPressed}
      onPressedChange={onPressedChange}
      className={classes}
      {...props}
    >
      {children}
    </TogglePrimitive.Root>
  );
}

type ChipGroupBase = {
  /** Required unless a visible <legend> labels the group (then pass aria-labelledby). */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Equal-width grid columns (time-control grid). Omitted: chips wrap in a row. */
  columns?: number;
  size?: ChipSize;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  children: React.ReactNode;
};

export type ChipGroupProps<T extends string = string> = ChipGroupBase &
  (
    | { type: "single"; value: T; onValueChange: (v: T) => void }
    | { type: "multiple"; value: T[]; onValueChange: (v: T[]) => void }
  );

/**
 * A group of chips with roving focus (arrow keys). `single` never deselects:
 * clicking the selected chip keeps it on.
 */
export function ChipGroup<T extends string = string>(props: ChipGroupProps<T>) {
  const { columns, size, mono, disabled, className, children } = props;
  const shared = {
    "aria-label": props["aria-label"],
    "aria-labelledby": props["aria-labelledby"],
    "data-testid": props["data-testid"],
    disabled,
    loop: true,
    style: columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined,
    className: cn(columns ? "grid gap-1 pointer-coarse:gap-1.5" : "flex flex-wrap gap-2", className),
  };
  const ctx: GroupContext = { inGroup: true, size, mono };
  return (
    <ChipGroupContext value={ctx}>
      {props.type === "single" ? (
        <ToggleGroupPrimitive.Root
          {...shared}
          type="single"
          value={props.value}
          onValueChange={(v) => {
            if (v) props.onValueChange(v as T);
          }}
        >
          {children}
        </ToggleGroupPrimitive.Root>
      ) : (
        <ToggleGroupPrimitive.Root
          {...shared}
          type="multiple"
          value={props.value}
          onValueChange={(v) => props.onValueChange(v as T[])}
        >
          {children}
        </ToggleGroupPrimitive.Root>
      )}
    </ChipGroupContext>
  );
}

export type RemovableChipProps = {
  children: React.ReactNode;
  onRemove: () => void;
  /** Default `Remove filter: <text>` when children is a string. */
  removeLabel?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
};

/** An applied filter: drawn pressed with a trailing 14px X. A plain button, not a toggle. */
export function RemovableChip({ children, onRemove, removeLabel, disabled, className, "data-testid": testId }: RemovableChipProps) {
  const text = typeof children === "string" || typeof children === "number" ? String(children) : "";
  return (
    <button
      type="button"
      data-state="on"
      data-testid={testId}
      disabled={disabled}
      onClick={onRemove}
      aria-label={removeLabel ?? (text ? `Remove filter: ${text}` : "Remove filter")}
      className={cn(chipVariants({ size: "sm" }), "gap-2 pr-2.5 [&_svg]:size-3.5", className)}
    >
      <span>{children}</span>
      <X aria-hidden="true" />
    </button>
  );
}
