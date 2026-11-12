"use client";

// The review menu's ⋯ trigger, on its own so the footer can show it (disabled) while the menu itself (ReviewMenu, a
// next/dynamic chunk) is still loading, without importing the menu eagerly.
import { BUTTONS } from "../copy";

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** The ⋯ trigger's look (the loading placeholder renders the same button, disabled). */
export function MenuButton(props: React.ComponentProps<"button">) {
  return (
    <button type="button" className="rv-ib" aria-label={BUTTONS.more} title={BUTTONS.more} {...props}>
      <DotsIcon />
    </button>
  );
}
