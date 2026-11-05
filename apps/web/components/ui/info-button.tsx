"use client";

// InfoButton (SPEC 7.2): the ⓘ next to a page title. The screen's description
// lives in its popover, which opens on click or tap (not hover).
import { Info } from "lucide-react";
import { IconButton } from "./icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type InfoButtonProps = {
  /** Trigger aria-label, and the popover's when there is no title. Default "About This Page". */
  label?: string;
  title?: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** On the trigger. */
  "data-testid"?: string;
  /** On the popover content. */
  contentTestId?: string;
  className?: string;
};

export function InfoButton({
  label = "About This Page",
  title,
  children,
  side = "bottom",
  align = "start",
  "data-testid": testId,
  contentTestId,
  className,
}: InfoButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton variant="ghost" size="sm" label={label} icon={<Info />} data-testid={testId} className={className} />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        width={320}
        title={title}
        aria-label={title ?? label}
        data-testid={contentTestId}
      >
        <div className="text-body text-cb-text">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
