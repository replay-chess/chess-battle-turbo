"use client";

// The ⋯ menu (plan §4.1 "Overlays"; V3ReviewSummary .menu): Flip Board; Share Analysis (flag review-share; disabled
// until DONE); Download PGN; Compare with {Legend} (legend games; hover or focus prefetches the comparison, which is
// safe because A9 queues nothing, P3-D23); How We Grade Moves; Back to the Game. Radix handles the roles, roving focus,
// typeahead, Esc and focus return. Imported eagerly by ReviewFooter (it renders on the server; a next/dynamic copy
// streamed as a Suspense segment); `MenuButton` is its trigger.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, GitCompareArrows, Info, RefreshCcw, Share } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuTrigger } from "@/components/ui/menu";
import { legendCompareQuery } from "@/lib/api/queries/review";
import { BUTTONS } from "../copy";
import { useReview, useView } from "../context";
import { gamePath, reviewSharePath } from "../paths";
import { MenuButton } from "./MenuButton";

export default function ReviewMenu({ testId = "review-menu" }: { testId?: string }) {
  const { dto, refId, actions, flags, demo } = useReview();
  const qc = useQueryClient();
  // Hover or focus on Compare prefetches A9 (a pure read: it never queues engine work, P3-D23).
  const prefetchLegend = () => {
    if (!demo) void qc.prefetchQuery(legendCompareQuery(refId));
  };
  // Local, not in the view store: the side footer and the phone action bar each render a menu (one is hidden by CSS).
  const [open, setOpen] = useState(false);
  const flip = useView((v) => v.flip);
  const router = useRouter();
  const legend = dto.game.legend;
  const done = dto.status === "done";
  const go = (href: string) => (demo ? undefined : router.push(href));

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <MenuButton aria-haspopup="menu" data-testid={testId} />
      </MenuTrigger>
      <MenuContent aria-label="Review options" minWidth={240}>
        <MenuItem icon={<RefreshCcw />} onSelect={flip} data-testid="menu-flip">
          {BUTTONS.flip}
        </MenuItem>
        {flags.share ? (
          <MenuItem icon={<Share />} disabled={!done} onSelect={() => go(reviewSharePath(refId))} data-testid="menu-share">
            {BUTTONS.share}
          </MenuItem>
        ) : null}
        <MenuItem icon={<Download />} onSelect={actions.downloadPgn} data-testid="menu-pgn">
          {BUTTONS.downloadPgn}
        </MenuItem>
        {legend ? (
          <MenuItem
            icon={<GitCompareArrows />}
            onSelect={() => go(legend.compareHref)}
            onPointerEnter={prefetchLegend}
            onFocus={prefetchLegend}
            data-testid="menu-compare"
          >
            {BUTTONS.compareWith(legend.name)}
          </MenuItem>
        ) : null}
        <MenuLinkItem icon={<Info />} href={demo ? "#how-we-grade" : "/how-we-grade"} data-testid="menu-how-we-grade">
          {BUTTONS.howWeGrade}
        </MenuLinkItem>
        <MenuLinkItem icon={<ChevronLeft />} href={demo ? "#game" : gamePath(refId)} data-testid="menu-back-to-game">
          {BUTTONS.backToGame}
        </MenuLinkItem>
      </MenuContent>
    </Menu>
  );
}
