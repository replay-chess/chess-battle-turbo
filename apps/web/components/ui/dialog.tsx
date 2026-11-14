"use client";

// Dialog and AlertDialog (SPEC 3.5, 7.2, 02 §5.13). Radix gives the focus trap,
// Esc, outside click and focus return; we add aria-modal="true" (F M1: Radix sets
// only the role) and pass aria-describedby={undefined} when there is no
// description, so Radix doesn't warn.
import { X } from "lucide-react";
import {
  AlertDialog as AlertDialogPrimitive,
  Dialog as DialogPrimitive,
  VisuallyHidden,
} from "radix-ui";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { IconButton } from "./icon-button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const WIDTHS = { sm: "440px", md: "560px", lg: "640px", xl: "1040px" } as const;

const OVERLAY =
  "fixed inset-0 z-(--cb-z-dialog) bg-cb-scrim-modal data-[state=open]:animate-rc-fade motion-reduce:animate-none";

const BOX =
  "fixed left-1/2 z-(--cb-z-dialog) flex w-[min(var(--w),calc(100vw-32px))] -translate-x-1/2 flex-col rounded-none border border-cb-border-strong bg-cb-surface text-cb-text shadow-modal outline-none data-[state=open]:animate-rc-pop motion-reduce:data-[state=open]:animate-rc-fade";

const TITLE = { serif: "font-serif text-heading", sans: "text-body font-semibold" } as const;

export type DialogContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  /** Required, rendered as DialogTitle. */
  title: React.ReactNode;
  /** Absent → aria-describedby={undefined} (no Radix warning). */
  description?: React.ReactNode;
  /** VisuallyHidden title + description. */
  hideTitle?: boolean;
  hideClose?: boolean;
  /** 440 / 560 / 640 / 1040 px. Default md. */
  size?: "sm" | "md" | "lg" | "xl";
  /** top = 12vh (command palette). */
  align?: "center" | "top";
  /** serif text-heading (default) | sans 600 (in-game confirms). */
  titleVariant?: "serif" | "sans";
  overlayClassName?: string;
  /** The close button's accessible name (default "Close"). */
  closeLabel?: string;
};

export function DialogContent({
  title,
  description,
  hideTitle = false,
  hideClose = false,
  size = "md",
  align = "center",
  titleVariant = "serif",
  overlayClassName,
  closeLabel = "Close",
  className,
  style,
  children,
  ...props
}: DialogContentProps) {
  const titleNode = <DialogPrimitive.Title className={TITLE[titleVariant]}>{title}</DialogPrimitive.Title>;
  const descriptionNode = description ? (
    <DialogPrimitive.Description className="text-ui text-cb-text-soft">{description}</DialogPrimitive.Description>
  ) : null;
  const close = hideClose ? null : (
    <DialogPrimitive.Close asChild>
      <IconButton variant="ghost" size="sm" label={closeLabel} icon={<X />} className="-mr-2 shrink-0" />
    </DialogPrimitive.Close>
  );
  const showHeader = !hideTitle || close;
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn(OVERLAY, overlayClassName)} />
      <DialogPrimitive.Content
        aria-modal="true"
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
        data-align={align}
        style={{ ...style, ["--w" as string]: WIDTHS[size] }}
        className={cn(
          BOX,
          align === "top"
            ? "top-[12vh] max-h-[calc(88dvh-24px)] translate-y-0"
            : "top-1/2 max-h-[calc(100dvh-48px)] -translate-y-1/2",
          className,
        )}
      >
        {hideTitle ? (
          <VisuallyHidden.Root>
            {titleNode}
            {descriptionNode}
          </VisuallyHidden.Root>
        ) : null}
        {showHeader ? (
          <div className={cn("flex items-start justify-between gap-3 px-6 pt-5", hideTitle && "absolute right-6 top-0 px-0")}>
            {hideTitle ? null : (
              <div className="flex min-w-0 flex-col gap-1 pt-1">
                {titleNode}
                {descriptionNode}
              </div>
            )}
            {close}
          </div>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2.5 border-t border-cb-border px-6 py-3.5", className)}
      {...props}
    />
  );
}

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export type AlertDialogContentProps = Omit<
  React.ComponentProps<typeof AlertDialogPrimitive.Content>,
  "title" | "children"
> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 440 / 560 px. Default sm. */
  size?: "sm" | "md";
  /** The footer buttons: AlertDialogCancel first, then AlertDialogAction. */
  children?: React.ReactNode;
  titleVariant?: "serif" | "sans";
};

/** Radix focuses Cancel (the safe action) on open; keep it that way. */
export function AlertDialogContent({
  title,
  description,
  size = "sm",
  titleVariant = "serif",
  children,
  className,
  style,
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={OVERLAY} />
      <AlertDialogPrimitive.Content
        aria-modal="true"
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
        style={{ ...style, ["--w" as string]: WIDTHS[size] }}
        className={cn(BOX, "top-1/2 max-h-[calc(100dvh-48px)] -translate-y-1/2", className)}
      >
        <div className="flex flex-col gap-2 px-6 pb-5 pt-6">
          <AlertDialogPrimitive.Title className={TITLE[titleVariant]}>{title}</AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="text-body text-cb-text-soft">
              {description}
            </AlertDialogPrimitive.Description>
          ) : null}
        </div>
        {children ? (
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-cb-border px-6 py-3.5">
            {children}
          </div>
        ) : null}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "secondary" }), className)} {...props} />;
}

export function AlertDialogAction({
  tone = "primary",
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & { tone?: "primary" | "danger" }) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant: tone === "danger" ? "danger" : "primary" }), className)}
      {...props}
    />
  );
}
