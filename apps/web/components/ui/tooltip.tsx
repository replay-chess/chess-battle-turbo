"use client";

// Tooltip (SPEC 3.5, 7.2). Opens on hover and keyboard focus. Radix doesn't open
// tooltips on touch, so never put essential information in one.
import { Tooltip as TooltipPrimitive } from "radix-ui";

/** Mounted once in app/layout.tsx; Tooltip doesn't wrap its own. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export type TooltipProps = {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
  children: React.ReactElement;
  /** On the visible tooltip box. */
  "data-testid"?: string;
};

export function Tooltip({
  content,
  side = "top",
  align = "center",
  delayDuration,
  disabled,
  children,
  "data-testid": testId,
}: TooltipProps) {
  if (disabled) return children;
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          data-testid={testId}
          className="z-(--cb-z-popover) max-w-xs bg-cb-accent px-2 py-1 text-ui text-cb-accent-fg data-[state=delayed-open]:animate-rc-fade motion-reduce:animate-none"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
