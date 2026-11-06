"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TOPBAR_TITLE_ID } from "./TopBar";

/**
 * Renders `children` in the phone/iPad-portrait top bar's title slot (next to Back). Nothing on the server or when
 * the shell has no top bar (the slot element is absent); the top bar itself is hidden by CSS outside tab-bar mode.
 */
export function TopBarTitle({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(TOPBAR_TITLE_ID));
  }, []);
  return slot ? createPortal(children, slot) : null;
}
