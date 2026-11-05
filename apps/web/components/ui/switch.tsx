"use client";

// Switch and SwitchRow (SPEC 3.5, 6.2; 02 §5.10 `.tgl`).
import { useId } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type SwitchProps = Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "children">;

/**
 * A 44×26 track with an 18px thumb; accent when on. The track keeps a 44px hit
 * box through tap-target. In settings, prefer SwitchRow, whose whole row is the
 * target. The off-track border pair is the one literal colour the kit allows (02 §5.10).
 */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "tap-target inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full border border-[rgba(0,0,0,0.25)] bg-cb-surface transition-colors duration-150 [-webkit-tap-highlight-color:transparent] dark:border-[rgba(255,255,255,0.3)]",
        "data-[state=checked]:border-cb-accent data-[state=checked]:bg-cb-accent",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "forced-colors:data-[state=checked]:outline forced-colors:data-[state=checked]:outline-2 forced-colors:data-[state=checked]:-outline-offset-2",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] translate-x-[3px] rounded-full bg-cb-border-input transition-transform duration-150 ease-rc data-[state=checked]:translate-x-[21px] data-[state=checked]:bg-cb-accent-fg" />
    </SwitchPrimitive.Root>
  );
}

/** The whole min-h-14 row is a <label htmlFor>; the switch is named by the label line and described by the description. */
export function SwitchRow({
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
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;
  return (
    <label
      htmlFor={switchId}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "flex min-h-14 cursor-pointer items-center justify-between gap-4 py-2 [-webkit-tap-highlight-color:transparent] data-disabled:cursor-not-allowed",
        className,
      )}
    >
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
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
      />
    </label>
  );
}
