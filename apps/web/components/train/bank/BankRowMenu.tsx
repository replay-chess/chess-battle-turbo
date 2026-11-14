"use client";

// A bank row's ⋯ menu (phase-05 plan §4.3, D-2): Remove From Bank. Only behind the `bank-remove` flag, so BankView
// loads this module (and the dropdown primitives) lazily when the flag is on.
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { BankRow } from "@repo/contracts/http/train";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";

export function BankRowMenu({ row, onRemove }: { row: BankRow; onRemove: (row: BankRow) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton variant="ghost" label={`More for ${row.theme.label}, move ${row.moveNo}`} icon={<MoreHorizontal />} className="my-auto mr-1 shrink-0" data-testid="bank-row-more" />
      </MenuTrigger>
      <MenuContent minWidth={220}>
        <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => onRemove(row)} data-testid="bank-row-remove">
          Remove From Bank
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
