"use client";

import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex shrink-0 items-center justify-center p-0 rounded-none transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:text-cb-text-disabled [-webkit-tap-highlight-color:transparent] aria-expanded:bg-cb-accent aria-expanded:text-cb-accent-fg aria-expanded:border-cb-accent aria-pressed:bg-cb-accent aria-pressed:text-cb-accent-fg aria-pressed:border-cb-accent [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline: "border border-cb-border-strong bg-cb-surface text-cb-text hover:bg-cb-fill",
        ghost: "border-0 bg-transparent text-cb-text-soft hover:bg-cb-fill hover:text-cb-text",
        solid: "border border-cb-accent bg-cb-accent text-cb-accent-fg hover:bg-cb-accent-hover",
      },
      size: {
        sm: "size-9 tap-target pointer-coarse:size-11",
        md: "size-11",
        lg: "size-12",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type IconButtonProps = Omit<React.ComponentProps<"button">, "children"> & {
  /** Required → aria-label. Wrap in <Tooltip> for a visible hint. */
  label: string;
  icon: React.ReactNode;
  /** Default outline. */
  variant?: "outline" | "ghost" | "solid";
  /** 36 (tap-target, coarse → 44) / 44 / 48 square. Default md. */
  size?: "sm" | "md" | "lg";
  pressed?: boolean;
  asChild?: boolean;
  /** With asChild only: the element to render as (e.g. <Link href="…"/>); the icon goes inside it. */
  children?: React.ReactElement;
};

export function IconButton({
  label,
  icon,
  variant,
  size,
  pressed,
  asChild = false,
  className,
  children,
  type,
  ...props
}: IconButtonProps) {
  const classes = cn(variants({ variant, size }), className);
  const glyph = (
    <span aria-hidden="true" className="inline-flex">
      {icon}
    </span>
  );
  if (asChild && children) {
    return (
      <Slot.Root {...props} className={classes} aria-label={label} aria-pressed={pressed}>
        <Slot.Slottable>{children}</Slot.Slottable>
        {glyph}
      </Slot.Root>
    );
  }
  return (
    <button type={type ?? "button"} {...props} className={classes} aria-label={label} aria-pressed={pressed}>
      {glyph}
    </button>
  );
}
