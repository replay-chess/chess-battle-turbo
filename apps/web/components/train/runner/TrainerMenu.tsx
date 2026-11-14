"use client";

// The ⋯ menu (§4.4 "menu ⋯"): Show Solution · Skip for Today · End Session · Report a Problem, and for a bank item
// See It in Your Game (FIX-2: the one entry to the game on a short phone, where the label bar under the board gives
// way to the board). "Analyse with the coach" is P7's and not rendered. Radix `role="menu"`, Esc closes and returns
// focus to the trigger.
import { MoreHorizontal } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuTrigger } from "@/components/ui/menu";
import { trackTrain } from "@/lib/analytics/train-events";

export function TrainerMenu({
  open,
  onOpenChange,
  canShowSolution,
  onSolution,
  onSkip,
  onEnd,
  onReport,
  seeInGameHref = null,
  label,
  testId = "trainer-menu",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canShowSolution: boolean;
  onSolution: () => void;
  onSkip: () => void;
  onEnd: () => void;
  onReport: () => void;
  /** The item's game in the review (bank items), else null. */
  seeInGameHref?: string | null;
  label: string;
  testId?: string;
}) {
  return (
    <Menu open={open} onOpenChange={onOpenChange} modal={false}>
      <MenuTrigger asChild>
        <button type="button" className="tr-ib" aria-label={label} data-testid={testId}>
          <MoreHorizontal aria-hidden="true" size={18} />
        </button>
      </MenuTrigger>
      <MenuContent side="top" minWidth={220} aria-label="Puzzle options">
        <MenuItem disabled={!canShowSolution} onSelect={onSolution} shortcut="S">
          Show Solution
        </MenuItem>
        <MenuItem onSelect={onSkip}>Skip for Today</MenuItem>
        <MenuItem onSelect={onEnd}>End Session</MenuItem>
        <MenuItem onSelect={onReport}>Report a Problem</MenuItem>
        {seeInGameHref ? (
          <MenuLinkItem href={seeInGameHref} onSelect={() => trackTrain("bank_see_in_game_clicked", {})} data-testid={`${testId}-see-in-game`}>
            See It in Your Game
          </MenuLinkItem>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
