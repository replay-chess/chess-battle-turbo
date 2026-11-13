"use client";

import { Children, cloneElement, isValidElement } from "react";
import { cva } from "class-variance-authority";
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
  /** Renders the one child element (e.g. a next/link) with the button's props and classes (slotInto). */
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

  if (asChild) return slotInto(children, { ...props, ...shared }, iconStart, iconEnd);

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

type SlotProps = Record<string, unknown> & { className?: string; style?: React.CSSProperties };

function composeRefs(...refs: unknown[]): (node: unknown) => void {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object" && "current" in ref) (ref as { current: unknown }).current = node;
    }
  };
}

/**
 * `asChild`: the one child element gets the button's props, as Radix Slot did (FIX-2: Radix Slot and compose-refs were
 * ~1.5 kB gzip on every page with a button, for this one merge). The child's own props win, except that the classes
 * are joined (the button's first), the styles merged, and event handlers both run (the child's first, then the
 * button's); the icons wrap the child's own children.
 */
export function slotInto(children: React.ReactNode, slot: SlotProps, iconStart?: React.ReactNode, iconEnd?: React.ReactNode): React.ReactElement {
  const child = Children.only(children);
  if (!isValidElement<SlotProps & { children?: React.ReactNode }>(child)) throw new Error("Button asChild needs one element child");
  const own = child.props;
  const merged: SlotProps = { ...slot, ...own };
  for (const key of Object.keys(slot)) {
    const mine = slot[key];
    const theirs = own[key];
    if (/^on[A-Z]/.test(key) && typeof mine === "function" && typeof theirs === "function") {
      merged[key] = (...args: unknown[]) => {
        const result = (theirs as (...a: unknown[]) => unknown)(...args);
        (mine as (...a: unknown[]) => unknown)(...args);
        return result;
      };
    }
  }
  if (slot.ref && own.ref && slot.ref !== own.ref) merged.ref = composeRefs(slot.ref, own.ref);
  merged.className = cn(slot.className, own.className);
  if (slot.style || own.style) merged.style = { ...slot.style, ...own.style };
  return cloneElement(child, merged, iconStart, own.children, iconEnd);
}
