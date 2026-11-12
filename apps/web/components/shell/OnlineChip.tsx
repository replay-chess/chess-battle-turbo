"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** navigator.onLine as a store; the server snapshot is online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

const BACK_ONLINE_MS = 3000;

/**
 * Desktop chip copy. What is true until Phase 11's offline shell: the service worker precaches static assets only
 * (no documents, RSC or /api), so the open page keeps working and any page not yet open needs the network. The
 * design's "Offline · cached pages still work" returns with the P11 offline page.
 */
export const OFFLINE_COPY = "Offline · new pages need a connection";

/**
 * Connection chip (V3Offline, V3iPhoneOffline). Floating at the top centre of
 * the page column in sidebar and rail modes; inline in the banner slot in
 * tab-bar mode. Shows "Back online" for 3s after reconnecting. The live region
 * is always mounted, so screen readers announce the change.
 */
export function OnlineChip({ placement }: { placement: "floating" | "inline" }) {
  const online = useOnline();
  const [wasOffline, setWasOffline] = useState(false);
  const [backOnline, setBackOnline] = useState(false);

  // Track the offline → online edge during render (no effect round trip).
  if (!online && !wasOffline) {
    setWasOffline(true);
    setBackOnline(false);
  } else if (online && wasOffline) {
    setWasOffline(false);
    setBackOnline(true);
  }

  useEffect(() => {
    if (!backOnline) return;
    const t = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    return () => window.clearTimeout(t);
  }, [backOnline]);

  const show = !online || backOnline;
  const floating = placement === "floating";

  let chip: React.ReactNode = null;
  if (!online) {
    chip = (
      <Tag tone="warn" variant="tint" icon={<WifiOff className="size-3" />}>
        {floating ? OFFLINE_COPY : "Offline"}
      </Tag>
    );
  } else if (backOnline) {
    chip = (
      <Tag tone="good" variant="tint" icon={<Wifi className="size-3" />}>
        Back online
      </Tag>
    );
  }

  return (
    <div
      role="status"
      data-testid={floating ? "shell-online-chip" : "shell-online-chip-inline"}
      className={cn(
        floating
          ? "pointer-events-none fixed top-[calc(var(--safe-top)+12px)] left-[calc(var(--rc-nav-w,0px)+(100vw-var(--rc-nav-w,0px))/2)] z-(--cb-z-popover) flex -translate-x-1/2 tabbar:hidden"
          : "hidden justify-center tabbar:flex",
        !floating && show && "py-1.5",
      )}
    >
      {chip}
    </div>
  );
}
