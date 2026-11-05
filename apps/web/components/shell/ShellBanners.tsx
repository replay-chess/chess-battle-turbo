"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { ShellUser } from "@/lib/shell/types";
import { openBillingPortal } from "./useAccountActions";

const DISMISS_KEY = "rc-payment-banner-dismissed";
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function dismissForSession(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Blocked storage: the banner simply comes back on the next load.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shell banner rows (SPEC 8.2 ShellBanners). Phase 1: the payment-failed
 * banner. The date label is preformatted on the server in UTC, so SSR and
 * hydration agree in every time zone.
 */
export function ShellBanners({ user, demo = false }: { user: ShellUser; demo?: boolean }) {
  const router = useRouter();
  // Server snapshot: not dismissed. A dismissal hides the banner right after hydration.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => false);

  if (!user.paymentFailed || dismissed) return null;

  return (
    <Banner
      tone="warn"
      live="polite"
      layout="bar"
      data-testid="shell-payment-banner"
      // viewport.css hides it on game screens too short for both it and the 220px board.
      className="rc-shell-banner"
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!demo) openBillingPortal(() => router.refresh());
          }}
        >
          Update Payment
        </Button>
      }
      onDismiss={dismissForSession}
    >
      {user.paymentFailedUntilLabel
        ? `Your last payment failed. You keep access until ${user.paymentFailedUntilLabel}.`
        : "Your last payment failed. Update your card to keep access."}
    </Banner>
  );
}
