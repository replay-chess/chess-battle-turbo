// Toast types and toaster placement (SPEC 7.2, D16). Pure: no React, no DOM, so
// node:test can cover it. toast.tsx and ThemeAwareToaster.tsx read it.
import type { ToasterProps } from "sonner";

export type ToastType = "success" | "info" | "error" | "warning" | "achievement" | "undo";
export type ToastIconName = "Check" | "Info" | "TriangleAlert" | "WifiOff" | "Trophy" | "Undo2";
export type ToastTone = "good" | "text" | "bad" | "warn" | "accent";

export const TOAST_TYPES: Record<ToastType, { duration: number; icon: ToastIconName; tone: ToastTone }> = {
  success: { duration: 3000, icon: "Check", tone: "good" },
  info: { duration: 3000, icon: "Info", tone: "text" },
  error: { duration: 8000, icon: "TriangleAlert", tone: "bad" },
  warning: { duration: 8000, icon: "WifiOff", tone: "warn" },
  achievement: { duration: 6000, icon: "Trophy", tone: "accent" },
  undo: { duration: 6000, icon: "Undo2", tone: "text" },
};

export type ToasterPlacementInput = {
  /** An app shell is mounted (lib/shell/presence.ts). */
  inShell: boolean;
  /** TABBAR_MQ matches. */
  tabbar: boolean;
  /** TABLET_PORTRAIT_MQ matches. */
  tabletPortrait: boolean;
  /** NARROW_MQ matches. */
  narrow: boolean;
};

export type ToasterOffset = ToasterProps["offset"];

export type ToasterPlacement = {
  position: NonNullable<ToasterProps["position"]>;
  offset: ToasterOffset;
  /** Always equal to `offset`: sonner's mobile CSS is max-width 600px, not TABBAR_MQ. */
  mobileOffset: ToasterOffset;
  visibleToasts: number;
  /** px, written to the toaster's --width. */
  width: number;
};

export function toasterPlacement({ inShell, tabbar, tabletPortrait, narrow }: ToasterPlacementInput): ToasterPlacement {
  if (!inShell) {
    // Outside the shell: today's position, the new look.
    return { position: "top-center", offset: undefined, mobileOffset: undefined, visibleToasts: 3, width: narrow ? 320 : 380 };
  }
  if (tabbar) {
    const offset = { bottom: "var(--rc-overlay-bottom)", left: 16, right: 16 };
    return { position: "bottom-center", offset, mobileOffset: { ...offset }, visibleToasts: 1, width: tabletPortrait ? 440 : 380 };
  }
  const offset = { top: "calc(16px + var(--safe-top))", right: "calc(24px + var(--safe-right))" };
  return { position: "top-right", offset, mobileOffset: { ...offset }, visibleToasts: 3, width: narrow ? 320 : 380 };
}
