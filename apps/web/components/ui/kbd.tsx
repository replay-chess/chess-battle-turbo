"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[26px] min-w-[26px] items-center justify-center border border-b-2 border-cb-border-strong bg-cb-surface px-[7px] font-mono text-xs font-medium text-cb-text",
        className,
      )}
      {...props}
    />
  );
}

const noopSubscribe = () => () => {};

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "Ctrl" on the server and the first paint, then "⌘" after mount on Apple platforms. */
export function ModKey() {
  const apple = useSyncExternalStore(noopSubscribe, isApplePlatform, () => false);
  return <>{apple ? "⌘" : "Ctrl"}</>;
}
