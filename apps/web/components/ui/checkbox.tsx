"use client";

// Checkbox and CheckboxRow (SPEC 3.5, 6.2; README disclosure patterns).
import { useId } from "react";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "children">;

/**
 * An 18px square box; checked | "indeterminate". Square, never rounded. The
 * border uses --cb-border-input (3:1 against the surface, WCAG 1.4.11), the same
 * choice D9 made for text inputs. tap-target keeps a 44px hit box.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "tap-target inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-none border border-cb-border-input bg-cb-surface text-cb-accent-fg [-webkit-tap-highlight-color:transparent]",
        "data-[state=checked]:border-cb-accent data-[state=checked]:bg-cb-accent data-[state=indeterminate]:border-cb-accent data-[state=indeterminate]:bg-cb-accent",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "forced-colors:data-[state=checked]:outline forced-colors:data-[state=checked]:outline-2 forced-colors:data-[state=checked]:-outline-offset-2",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group inline-flex">
        <Check aria-hidden="true" className="size-3.5 group-data-[state=indeterminate]:hidden" strokeWidth={2.5} />
        <Minus aria-hidden="true" className="hidden size-3.5 group-data-[state=indeterminate]:block" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** A min-h-11 <label> row; the box is named by the label line and described by the description. */
export function CheckboxRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  "data-testid": testId,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean | "indeterminate";
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const autoId = useId();
  const boxId = id ?? `checkbox-${autoId}`;
  const labelId = `${boxId}-label`;
  const descId = `${boxId}-desc`;
  return (
    <label
      htmlFor={boxId}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 py-1.5 [-webkit-tap-highlight-color:transparent] data-disabled:cursor-not-allowed",
        description && "items-start [&>button]:mt-0.5",
        className,
      )}
    >
      <Checkbox
        id={boxId}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className={cn("text-body text-cb-text", disabled && "text-cb-text-disabled")}>
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-ui text-cb-text-soft">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
