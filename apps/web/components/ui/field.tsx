"use client";

// Field, Input, Textarea, Select, Slider (SPEC 6.2; 02 §5.9, C15, C16).
import { cloneElement, isValidElement, useId } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { fieldA11yProps, fieldIds } from "./field-a11y";

export type FieldProps = {
  label: React.ReactNode;
  /** default = 13px medium; overline = the 11px mono `.lbl`. */
  labelVariant?: "default" | "overline";
  hint?: React.ReactNode;
  /** Shown only while set; the control gets aria-invalid. Name the field in the text ("Username is taken."). */
  error?: React.ReactNode;
  required?: boolean;
  /** The control id; generated when omitted. */
  id?: string;
  className?: string;
  "data-testid"?: string;
  /** Exactly one control. Field injects id, aria-describedby, aria-invalid and aria-required into it. */
  children: React.ReactElement<Record<string, unknown>>;
};

/**
 * Label, control, hint and error in one column. The error row replaces nothing:
 * the hint stays, and aria-describedby reads the hint, then the error.
 */
export function Field({
  label,
  labelVariant = "default",
  hint,
  error,
  required,
  id,
  className,
  "data-testid": testId,
  children,
}: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const ids = fieldIds(controlId);
  const hasHint = hint != null && hint !== false && hint !== "";
  const hasError = error != null && error !== false && error !== "";
  const control = isValidElement(children)
    ? cloneElement(
        children,
        fieldA11yProps({
          id: controlId,
          hasHint,
          hasError,
          required,
          describedBy: typeof children.props["aria-describedby"] === "string" ? children.props["aria-describedby"] : undefined,
        }),
      )
    : children;
  return (
    <div data-testid={testId} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <LabelPrimitive.Root
        id={ids.label}
        htmlFor={controlId}
        className={labelVariant === "overline" ? "text-overline" : "text-ui font-medium text-cb-text"}
      >
        {label}
      </LabelPrimitive.Root>
      {control}
      {hasHint ? (
        <p id={ids.hint} className="text-xs leading-[1.4] text-cb-text-soft">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={ids.error} className="flex items-start gap-1.5 text-ui leading-[1.4] text-cb-bad">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const INPUT =
  "w-full min-w-0 rounded-none border border-cb-border-input bg-cb-surface px-3 text-body text-cb-text pointer-coarse:text-base " +
  "focus:outline-2 focus:-outline-offset-1 focus:outline-cb-text focus-visible:outline-2 focus-visible:-outline-offset-1 " +
  "aria-invalid:border-cb-bad aria-invalid:shadow-[inset_0_0_0_1px_var(--cb-bad)] " +
  "disabled:cursor-not-allowed disabled:bg-cb-fill disabled:text-cb-text-secondary";

export type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  /** 44 / 48 px. Default md. */
  size?: "md" | "lg";
  /** A 16px icon inside the left edge (search). */
  leadingIcon?: React.ReactNode;
  /** Sets aria-invalid without a Field (a Field with an error sets it already). */
  invalid?: boolean;
};

/**
 * A text input (`.inp`). 15px text, 16px on coarse pointers so iOS Safari
 * doesn't zoom on focus. Uses :focus, not :focus-visible, so mouse users see the
 * ring too.
 */
export function Input({ size = "md", leadingIcon, invalid, className, ...props }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      {...props}
      className={cn(INPUT, size === "lg" ? "h-12" : "h-11", leadingIcon && "pl-9", !leadingIcon && className)}
    />
  );
  if (!leadingIcon) return input;
  return (
    <span className={cn("relative block w-full", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 inline-flex -translate-y-1/2 text-cb-text-soft [&_svg]:size-4"
      >
        {leadingIcon}
      </span>
      {input}
    </span>
  );
}

export type TextareaProps = React.ComponentProps<"textarea"> & { invalid?: boolean };

export function Textarea({ invalid, className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      rows={rows}
      {...props}
      className={cn(INPUT, "h-auto min-h-11 resize-none py-2.5 leading-normal", className)}
    />
  );
}

export type SelectProps = React.ComponentProps<"select"> & { invalid?: boolean };

/** A native <select> with the input look, square, with a 16px chevron. */
export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative block w-full", className)}>
      <select
        aria-invalid={invalid || undefined}
        {...props}
        className={cn(INPUT, "h-11 cursor-pointer appearance-none rounded-none pr-9")}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-cb-text-soft"
      />
    </span>
  );
}

export type SliderProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Mono tick labels under the track (aria-hidden; the value is announced by the input). */
  ticks?: React.ReactNode[];
};

/**
 * A native range input with the accent colour. The input box is 44px tall so the
 * hit area meets the 44px rule; the drawn track stays thin. WebKit keeps a round
 * thumb (accent-color doesn't reshape it); that is accepted.
 */
export function Slider({ ticks, className, ...props }: SliderProps) {
  const input = <input type="range" {...props} className={cn("h-11 w-full cursor-pointer accent-cb-accent", !ticks && className)} />;
  if (!ticks?.length) return input;
  return (
    <span className={cn("flex w-full flex-col", className)}>
      {input}
      <span aria-hidden="true" className="-mt-1.5 flex justify-between font-mono text-label text-cb-text-soft">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </span>
    </span>
  );
}
