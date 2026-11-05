"use client";

import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "danger-outline" | "control";
type ButtonSize = "sm" | "md" | "lg";

const SECONDARY =
  "border border-cb-border-strong bg-cb-surface text-cb-text px-3.5 hover:bg-cb-fill disabled:text-cb-text-disabled aria-disabled:text-cb-text-disabled aria-pressed:bg-cb-accent aria-pressed:text-cb-accent-fg aria-pressed:border-cb-accent";

const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm transition-colors duration-150 select-none cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed [-webkit-tap-highlight-color:transparent] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-cb-accent text-cb-accent-fg font-medium px-4.5 hover:bg-cb-accent-hover disabled:bg-cb-accent/35 aria-disabled:bg-cb-accent/35",
        secondary: SECONDARY,
        text: "px-1 gap-1.5 bg-transparent text-cb-text underline underline-offset-3 decoration-current/25 hover:decoration-current disabled:text-cb-text-disabled",
        danger:
          "bg-cb-danger text-white font-medium px-4.5 hover:bg-cb-danger-hover disabled:bg-cb-danger/35 aria-disabled:bg-cb-danger/35",
        "danger-outline": `${SECONDARY} text-cb-bad border-cb-bad/45`,
        control: `${SECONDARY} text-ui px-2.5 min-w-0 aria-expanded:bg-cb-accent aria-expanded:text-cb-accent-fg aria-expanded:border-cb-accent`,
      },
      size: {
        sm: "min-h-9 pointer-coarse:min-h-11 tap-target",
        md: "min-h-11",
        lg: "min-h-12",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export const buttonVariants = (opts?: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }): string =>
  cn(variants(opts));

export type ButtonProps = React.ComponentProps<"button"> & {
  /** Default primary. */
  variant?: ButtonVariant;
  /** min-height 36 + tap-target (coarse → 44) / 44 / 48. Default md. */
  size?: ButtonSize;
  /** w-full */
  block?: boolean;
  /** Spinner + aria-busy + aria-disabled; clicks ignored; width held. */
  loading?: boolean;
  loadingLabel?: React.ReactNode;
  /** aria-pressed */
  pressed?: boolean;
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
  /** Slot.Root, e.g. for next/link. */
  asChild?: boolean;
};

export function Button({
  variant,
  size,
  block,
  loading = false,
  loadingLabel,
  pressed,
  iconStart,
  iconEnd,
  asChild = false,
  className,
  children,
  onClick,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(variants({ variant, size, block }), className);
  const shared = {
    className: classes,
    "aria-pressed": pressed,
    "aria-busy": loading || undefined,
    "aria-disabled": loading ? true : props["aria-disabled"],
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (loading) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    },
  };

  if (asChild) {
    return (
      <Slot.Root {...props} {...shared}>
        {iconStart}
        <Slot.Slottable>{children}</Slot.Slottable>
        {iconEnd}
      </Slot.Root>
    );
  }

  // Both labels share one grid cell, so the width never jumps when loading flips.
  const label =
    loadingLabel != null ? (
      <span className="inline-grid">
        <span className={cn("[grid-area:1/1]", loading && "invisible")} aria-hidden={loading || undefined}>
          {children}
        </span>
        <span className={cn("[grid-area:1/1]", !loading && "invisible")} aria-hidden={!loading || undefined}>
          {loadingLabel}
        </span>
      </span>
    ) : (
      children
    );

  return (
    <button type={type ?? "button"} {...props} {...shared}>
      {loading ? <Spinner /> : iconStart}
      {label}
      {iconEnd}
    </button>
  );
}
