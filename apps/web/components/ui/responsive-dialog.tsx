"use client";

// ResponsiveDialog (SPEC 7.2): a bottom Sheet in tab-bar mode (phones, tablet
// portrait), a centred Dialog otherwise. The mode is read when the dialog opens
// and held while it stays open, so rotating a phone doesn't swap the surface
// under the user. Both surfaces are the same Radix Dialog root, so the trigger
// and focus return don't change.
import { useState } from "react";
import { TABBAR_MQ } from "@/lib/layout/media-queries";
import { Dialog, DialogBody, DialogContent, DialogTrigger } from "./dialog";
import { SheetContent } from "./sheet";
import { useMediaQuery } from "./use-media-query";

export type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Rendered with asChild, so pass one element (a Button). */
  trigger?: React.ReactElement;
  children: React.ReactNode;
  /** Dialog width; the sheet is always full width. Default md. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Sheet height in tab-bar mode. Default auto. */
  sheetHeight?: "auto" | "60" | "90";
  /** Dialog only; the sheet shows the title as its overline. */
  description?: React.ReactNode;
  /** On the dialog or sheet content. */
  "data-testid"?: string;
  /** The close button's accessible name (default "Close"). */
  closeLabel?: string;
};

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  trigger,
  children,
  size = "md",
  sheetHeight = "auto",
  description,
  "data-testid": testId,
  closeLabel,
}: ResponsiveDialogProps) {
  const tabbar = useMediaQuery(TABBAR_MQ);
  // Follows the media query while closed and freezes while open (state adjusted during render).
  const [asSheet, setAsSheet] = useState(tabbar);
  if (!open && asSheet !== tabbar) setAsSheet(tabbar);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      {asSheet ? (
        <SheetContent title={title} height={sheetHeight} data-testid={testId} data-surface="sheet" closeLabel={closeLabel}>
          {children}
        </SheetContent>
      ) : (
        <DialogContent title={title} description={description} size={size} data-testid={testId} data-surface="dialog" closeLabel={closeLabel}>
          <DialogBody>{children}</DialogBody>
        </DialogContent>
      )}
    </Dialog>
  );
}
