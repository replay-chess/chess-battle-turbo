"use client";

// WeaknessHeader (phase-06 plan §4.4–§4.6 header row): h1 "Weakness profile", the scope label, a spacer, "How this is
// calculated" and (ready) "‹ Train". In the tab-bar form the row is replaced by the shell's top bar: Back (to Train,
// ShellBackOverride), the title and an ⓘ link to /how-we-grade#weakness portalled into its title slot; the h1 stays
// for screen readers.
import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import { ShellBackOverride } from "@/components/shell/back-override";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IPAD_L_HIDDEN } from "./classes";
import { copy } from "./copy";

const TRAIN_BACK = { key: "train", href: copy.backHref, label: copy.backLabel } as const;

/** Moves the focus to the h1 the current form shows (the ready flash's "See your weakness profile", §4.11). */
export function focusWeaknessH1(): void {
  const all = document.querySelectorAll<HTMLElement>("[data-weakness-h1]");
  for (const h of all) {
    if (h.getClientRects().length > 0) {
      h.focus();
      return;
    }
  }
}

export function WeaknessHeader({ scopeLabel, showBack, hideScopeOnIpadL = false }: { scopeLabel: string | null; showBack: boolean; hideScopeOnIpadL?: boolean }) {
  return (
    <>
      <ShellBackOverride target={TRAIN_BACK} />
      <TopBarTitle>
        <span className="flex items-center gap-1">
          <span className="truncate text-overline text-cb-text">{copy.title}</span>
          <Link href={copy.howHref} prefetch={false} aria-label={copy.howLink} className="inline-flex size-11 shrink-0 items-center justify-center" data-testid="weakness-topbar-how">
            <Info aria-hidden="true" className="size-5" />
          </Link>
        </span>
      </TopBarTitle>
      <header className="flex items-end gap-3.5 tabbar:hidden" data-testid="weakness-header">
        <h1
          tabIndex={-1}
          data-weakness-h1=""
          className={cn(
            "m-0 shrink-0 font-serif font-normal tracking-[-0.01em] outline-none",
            // The profile board fits one viewport with a smaller title; the other boards use the page title size.
            showBack ? "text-[clamp(1.75rem,3.6vh,2.25rem)]/[1.05] rail:text-[28px]" : "text-[clamp(2rem,4.9vh,3rem)]/[1.05] rail:text-[28px]",
          )}
        >
          {copy.title}
        </h1>
        {scopeLabel ? (
          <span className={cn("min-w-0 shrink truncate pb-1.5 text-overline", hideScopeOnIpadL && IPAD_L_HIDDEN)} title={scopeLabel} data-testid="weakness-scope">
            {scopeLabel}
          </span>
        ) : null}
        <span className="min-w-0 flex-auto" />
        <Link href={copy.howHref} prefetch={false} className={cn(buttonVariants({ variant: "text" }), "min-h-11 shrink-0")}>
          {copy.howLink}
        </Link>
        {showBack ? (
          <Link href={copy.backHref} prefetch={false} className={cn(buttonVariants({ variant: "secondary" }), "min-h-11 shrink-0", IPAD_L_HIDDEN)} data-testid="weakness-back">
            <ChevronLeft aria-hidden="true" />
            {copy.backLabel}
          </Link>
        ) : null}
      </header>
      <h1 tabIndex={-1} data-weakness-h1="" className="sr-only hidden tabbar:block">
        {copy.title}
      </h1>
    </>
  );
}
