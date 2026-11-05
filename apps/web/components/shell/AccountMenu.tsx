"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { IOSInstallModal } from "@/app/components/IOSInstallModal";
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { ShellUser } from "@/lib/shell/types";
import { cn } from "@/lib/utils";
import { useAccountActions, type AccountItem } from "./useAccountActions";
import { useDeferredAction } from "./useDeferredAction";

/** Name and rating line at the top of the menu and the sheet. Non-interactive. */
function AccountHeader({ user }: { user: ShellUser }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-b border-cb-border px-3.5 pt-2 pb-2.5">
      <span className="truncate text-ui font-medium text-cb-text">{user.name}</span>
      {user.ratingLabel ? (
        <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-cb-text-soft uppercase">
          {user.ratingLabel}
        </span>
      ) : null}
    </div>
  );
}

function Icon({ item }: { item: AccountItem }) {
  const I = item.icon;
  return <I aria-hidden="true" size={16} strokeWidth={2} className="text-cb-text-soft" />;
}

/**
 * The account menu: a Radix Menu beside the sidebar/rail gear, or a bottom
 * Sheet from the phone top-bar avatar. Both read one list (useAccountActions).
 */
export function AccountMenu({
  user,
  demo = false,
  variant,
  trigger,
}: {
  user: ShellUser;
  demo?: boolean;
  variant: "menu" | "sheet";
  /** The trigger element (rendered asChild). */
  trigger: React.ReactElement;
}) {
  const { items, iosInstall } = useAccountActions(user, { demo });
  const { defer, onCloseAutoFocus } = useDeferredAction();
  const [sheetOpen, setSheetOpen] = useState(false);

  const modal = <IOSInstallModal isOpen={iosInstall.open} onClose={iosInstall.onClose} />;

  if (variant === "menu") {
    return (
      <>
        <Menu>
          <MenuTrigger asChild>{trigger}</MenuTrigger>
          <MenuContent side="right" align="end" data-testid="account-menu" onCloseAutoFocus={onCloseAutoFocus}>
            <AccountHeader user={user} />
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.separatorBefore ? <MenuSeparator /> : null}
                {item.href ? (
                  <MenuLinkItem
                    href={item.href}
                    icon={<Icon item={item} />}
                    data-testid={`account-item-${item.id}`}
                    onSelect={() => {
                      item.run?.();
                      if (item.afterClose) defer(item.afterClose);
                    }}
                  >
                    {item.label}
                  </MenuLinkItem>
                ) : (
                  <MenuItem
                    icon={<Icon item={item} />}
                    disabled={item.disabled}
                    data-testid={`account-item-${item.id}`}
                    onSelect={() => {
                      if (!item.run) return;
                      if (item.deferred) defer(item.run);
                      else item.run();
                    }}
                  >
                    {item.label}
                  </MenuItem>
                )}
              </Fragment>
            ))}
          </MenuContent>
        </Menu>
        {modal}
      </>
    );
  }

  const rowClass =
    "flex min-h-12 w-full items-center gap-3 px-1 text-left text-body text-cb-text hover:bg-cb-fill active:bg-cb-fill focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-cb-text-disabled [-webkit-tap-highlight-color:transparent]";

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent title="Account" data-testid="account-sheet" onCloseAutoFocus={onCloseAutoFocus}>
          <AccountHeader user={user} />
          <ul className="flex flex-col py-1">
            {items.map((item) => (
              <li key={item.id} className={cn(item.separatorBefore && "mt-1 border-t border-cb-border pt-1")}>
                {item.href ? (
                  <Link
                    href={item.href}
                    data-testid={`account-item-${item.id}`}
                    className={rowClass}
                    onClick={() => {
                      item.run?.();
                      if (item.afterClose) defer(item.afterClose);
                      setSheetOpen(false);
                    }}
                  >
                    <Icon item={item} />
                    {item.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    data-testid={`account-item-${item.id}`}
                    disabled={item.disabled}
                    aria-disabled={item.disabled || undefined}
                    className={rowClass}
                    onClick={() => {
                      if (item.run) {
                        if (item.deferred) defer(item.run);
                        else item.run();
                      }
                      setSheetOpen(false);
                    }}
                  >
                    <Icon item={item} />
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
      {modal}
    </>
  );
}
