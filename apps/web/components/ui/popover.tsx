"use client";

// Popover (SPEC 7.2, 02 §5.12): filters, ⓘ info, pickers. Radix handles focus,
// Esc, outside click and aria-expanded/controls; the content is role="dialog".
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export type PopoverContentProps = Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "title"> & {
  /** px; capped at the viewport minus 32. Default 340. */
  width?: number;
  /** Becomes the content's aria-label and a visible overline. */
  title?: string;
};

export function PopoverContent({
  width = 340,
  title,
  align = "end",
  sideOffset = 8,
  collisionPadding = 16,
  className,
  style,
  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        aria-label={title}
        {...props}
        style={{ ...style, ["--w" as string]: `${width}px` }}
        className={cn(
          "z-(--cb-z-popover) flex w-[var(--w)] max-w-[calc(100vw-32px)] flex-col gap-3.5 rounded-none border border-cb-border-strong bg-cb-surface p-4 text-cb-text shadow-pop data-[state=open]:animate-rc-fade motion-reduce:animate-none",
          className,
        )}
      >
        {title ? <p className="text-overline">{title}</p> : null}
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
