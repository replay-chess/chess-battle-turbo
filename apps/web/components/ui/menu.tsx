"use client";

// Menu (SPEC 3.5, 7.2, 02 §5.12): Radix DropdownMenu for ⋯ overflow menus.
// Radix handles the menu roles, roving focus, typeahead, Esc and focus return.
import Link from "next/link";
import { Check } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenuPrimitive.Root;
export const MenuTrigger = DropdownMenuPrimitive.Trigger;
export const MenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const ITEM =
  "relative flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3.5 text-sm text-cb-text outline-none data-[highlighted]:bg-cb-fill data-[disabled]:cursor-not-allowed data-[disabled]:text-cb-text-disabled [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]";

function ItemIcon({ icon }: { icon?: React.ReactNode }) {
  if (!icon) return null;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {icon}
    </span>
  );
}

export type MenuContentProps = React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  /** px, default 240. */
  minWidth?: number;
};

/** align "end", sideOffset 8, collisionPadding 16; forwards onCloseAutoFocus. */
export function MenuContent({
  minWidth = 240,
  align = "end",
  sideOffset = 8,
  collisionPadding = 16,
  className,
  style,
  ...props
}: MenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
        style={{ minWidth, ...style }}
        className={cn(
          "z-(--cb-z-popover) max-w-[calc(100vw-32px)] rounded-none border border-cb-border-strong bg-cb-surface py-1 text-cb-text shadow-pop data-[state=open]:animate-rc-fade motion-reduce:animate-none",
          className,
        )}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export type MenuItemProps = React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  shortcut?: string;
};

export function MenuItem({ icon, tone = "default", shortcut, className, children, ...props }: MenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item className={cn(ITEM, tone === "danger" && "text-cb-bad", className)} {...props}>
      <ItemIcon icon={icon} />
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut ? <span className="ml-auto font-mono text-xs text-cb-text-soft">{shortcut}</span> : null}
    </DropdownMenuPrimitive.Item>
  );
}

/** Item asChild + next/link, or <a target=_blank> when external. */
export function MenuLinkItem({
  href,
  icon,
  external = false,
  children,
  "data-testid": testId,
  onSelect,
}: {
  href: string;
  icon?: React.ReactNode;
  external?: boolean;
  children: React.ReactNode;
  "data-testid"?: string;
  onSelect?: () => void;
}) {
  const inner = (
    <>
      <ItemIcon icon={icon} />
      <span className="min-w-0 flex-1">{children}</span>
    </>
  );
  return (
    <DropdownMenuPrimitive.Item asChild className={ITEM} onSelect={onSelect}>
      {external ? (
        // noreferrer implies noopener; the repo's jsx-no-target-blank rule wants it.
        <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
          {inner}
        </a>
      ) : (
        <Link href={href} data-testid={testId}>
          {inner}
        </Link>
      )}
    </DropdownMenuPrimitive.Item>
  );
}

/** Trailing 16px check; the slot keeps its width when unchecked. */
function Indicator() {
  return (
    <span aria-hidden="true" className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  );
}

export function MenuCheckboxItem({
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & { icon?: React.ReactNode }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem className={cn(ITEM, className)} {...props}>
      <ItemIcon icon={icon} />
      <span className="min-w-0 flex-1">{children}</span>
      <Indicator />
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(ITEM, className)} {...props}>
      <span className="min-w-0 flex-1">{children}</span>
      <Indicator />
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DropdownMenuPrimitive.Separator className={cn("my-1 h-px bg-cb-border", className)} />;
}

export function MenuLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <DropdownMenuPrimitive.Label className={cn("px-3.5 pb-1 pt-2.5 text-overline", className)}>
      {children}
    </DropdownMenuPrimitive.Label>
  );
}
