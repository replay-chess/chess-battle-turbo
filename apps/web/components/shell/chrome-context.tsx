"use client";

// The chrome decision (SPEC D2, 9.3). `app/(app)/layout.tsx` decides once per
// render and provides it here; pages only read it. Without a provider the
// mode is "marketing", so pages outside `(app)` keep today's chrome.
import { createContext, useContext } from "react";
import type { ChromeMode } from "@/lib/shell/types";

const ChromeContext = createContext<ChromeMode>("marketing");

export function ChromeProvider({ mode, children }: { mode: ChromeMode; children: React.ReactNode }): React.JSX.Element {
  return <ChromeContext value={mode}>{children}</ChromeContext>;
}

export function useChrome(): ChromeMode {
  return useContext(ChromeContext);
}

/** Renders its children only in marketing chrome (Navbar, Footer). */
export function MarketingOnly({ children }: { children: React.ReactNode }): React.ReactNode {
  return useChrome() === "marketing" ? children : null;
}

/** Renders its children only inside the app shell. */
export function ShellOnly({ children }: { children: React.ReactNode }): React.ReactNode {
  return useChrome() === "shell" ? children : null;
}

/** Picks the class string for the mode. */
export function chromeClass(mode: ChromeMode, classes: { marketing: string; shell: string }): string {
  return mode === "shell" ? classes.shell : classes.marketing;
}

type ChromeBoxTag = "div" | "section" | "main" | "header" | "article";

export type ChromeBoxProps = Omit<React.HTMLAttributes<HTMLElement>, "className"> & {
  as?: ChromeBoxTag;
  /** Classes for both modes. */
  className?: string;
  /** Extra classes in marketing chrome (fixed-navbar offsets). */
  marketing?: string;
  /** Extra classes inside the app shell. */
  shell?: string;
};

/**
 * A box whose classes depend on the chrome, for server pages. A plain join,
 * not `cn`, so the marketing class set stays exactly as it was.
 */
export function ChromeBox({
  as: Tag = "div",
  className,
  marketing,
  shell,
  ...rest
}: ChromeBoxProps): React.JSX.Element {
  const mode = useChrome();
  const classes = [className, mode === "shell" ? shell : marketing].filter(Boolean).join(" ");
  return <Tag className={classes || undefined} {...rest} />;
}
