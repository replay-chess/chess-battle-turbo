"use client";

// Sheet (SPEC 3.5, 7.2, 02 §5.14): a Radix Dialog anchored to the bottom. The
// grabber is decorative; there's no swipe gesture in Phase 1. It closes from the
// close button, a scrim tap or Esc.
import { X } from "lucide-react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  /** The accessible name (DialogTitle). */
  title: React.ReactNode;
  hideTitle?: boolean;
  /** Overline header text; defaults to title. */
  label?: React.ReactNode;
  /** Default auto (max 90dvh). */
  height?: "auto" | "60" | "90";
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
  /** The close button's accessible name (default "Close"; e.g. "Close filters"). */
  closeLabel?: string;
};

export function SheetContent({
  title,
  hideTitle = false,
  label,
  height = "auto",
  bodyClassName,
  closeLabel = "Close",
  className,
  children,
  ...props
}: SheetContentProps) {
  // The visible overline is the title unless a separate label is given (or the
  // title is hidden); then the title is announced but not shown.
  const visibleText = label ?? (hideTitle ? null : title);
  const titleIsVisible = !hideTitle && label == null;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--cb-z-dialog) bg-cb-scrim data-[state=open]:animate-rc-fade motion-reduce:animate-none" />
      <DialogPrimitive.Content
        aria-modal="true"
        aria-describedby={undefined}
        {...props}
        data-height={height}
        className={cn(
          "fixed inset-x-0 bottom-0 z-(--cb-z-dialog) flex max-h-[90dvh] flex-col rounded-none border-t border-cb-border bg-cb-surface pb-[var(--safe-bottom)] text-cb-text outline-none data-[state=open]:animate-rc-sheet motion-reduce:data-[state=open]:animate-rc-fade",
          height === "60" && "h-[60dvh]",
          height === "90" && "h-[90dvh]",
          className,
        )}
      >
        <span aria-hidden="true" data-rc-grabber className="mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full bg-cb-border-strong" />
        {titleIsVisible ? null : (
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
        )}
        <div className="flex shrink-0 items-center justify-between gap-3 pl-4 pr-2 pt-1">
          {titleIsVisible ? (
            <DialogPrimitive.Title asChild>
              <p className="text-overline">{title}</p>
            </DialogPrimitive.Title>
          ) : visibleText != null ? (
            <p className="text-overline">{visibleText}</p>
          ) : (
            <span />
          )}
          <DialogPrimitive.Close asChild>
            <IconButton variant="ghost" size="sm" label={closeLabel} icon={<X />} />
          </DialogPrimitive.Close>
        </div>
        <div className={cn("flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-3 pt-2", bodyClassName)}>
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
