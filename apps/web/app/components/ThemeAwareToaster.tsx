"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";
import { toasterPlacement } from "@/components/ui/toast-config";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { NARROW_MQ, TABBAR_MQ, TABLET_PORTRAIT_MQ } from "@/lib/layout/media-queries";
import { useShellPresent } from "@/lib/shell/presence";
import "@/components/ui/toast.css";

// The global toaster (SPEC 7.2, D16). Every toast, including the legacy
// toast.success/toast.error call sites, gets the v3 box from classNames.toast.
// Placement follows the shell: top-centre outside it, top-right in it, and
// bottom-centre above the tab bar or game controls in tab-bar mode.

const ICON_BUTTON_GHOST_SM =
  "inline-flex size-9 shrink-0 items-center justify-center p-0 text-cb-text-soft transition-colors duration-150 hover:bg-cb-fill hover:text-cb-text cursor-pointer [-webkit-tap-highlight-color:transparent] tap-target pointer-coarse:size-11 [&_svg]:size-4";

export function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme();
  const placement = toasterPlacement({
    inShell: useShellPresent(),
    tabbar: useMediaQuery(TABBAR_MQ),
    tabletPortrait: useMediaQuery(TABLET_PORTRAIT_MQ),
    narrow: useMediaQuery(NARROW_MQ),
  });

  // toast.css pauses the timer bar while the document is hidden, as sonner pauses its timer.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute("data-rc-doc-hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      root.removeAttribute("data-rc-doc-hidden");
    };
  }, []);

  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position={placement.position}
      offset={placement.offset}
      mobileOffset={placement.mobileOffset}
      visibleToasts={placement.visibleToasts}
      style={{ "--width": `${placement.width}px` } as React.CSSProperties}
      expand
      gap={8}
      closeButton
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Dismiss",
        classNames: {
          toast:
            "group relative flex w-full items-center gap-2.5 min-h-12 py-1.5 pr-2 pl-3.5 rounded-none bg-cb-surface border border-cb-border-strong shadow-toast font-sans text-sm leading-[1.4] text-cb-text",
          icon: "inline-flex shrink-0 items-center [&>svg]:size-4",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "flex-1 min-w-0",
          description: "text-ui text-cb-text-soft",
          actionButton:
            "min-h-9 pointer-coarse:min-h-11 tap-target shrink-0 px-2.5 border border-cb-border-strong bg-cb-surface text-ui font-medium text-cb-text hover:bg-cb-fill cursor-pointer [-webkit-tap-highlight-color:transparent]",
          cancelButton:
            "min-h-9 pointer-coarse:min-h-11 tap-target shrink-0 px-2.5 text-ui text-cb-text-soft hover:text-cb-text cursor-pointer",
          closeButton: `order-last ${ICON_BUTTON_GHOST_SM}`,
          success: "[&_[data-icon]]:text-cb-good",
          error: "[&_[data-icon]]:text-cb-bad",
          warning: "[&_[data-icon]]:text-cb-warn",
          info: "[&_[data-icon]]:text-cb-text",
        },
      }}
    />
  );
}
