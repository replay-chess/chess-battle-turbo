"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { trackSystem } from "@/lib/analytics/system-events";
import type { PaymentIssueState, ShellUser } from "@/lib/shell/types";
import { openBillingPortal } from "./useAccountActions";

const DISMISS_KEY = "rc-payment-banner-dismissed";
/** The banner state already reported as `payment_banner_shown` in this session. */
const SHOWN_KEY = "rc-payment-banner-shown";
const UNDO_TOAST_ID = "payment-banner-dismissed";
/** Plan §4.5 `expired`: B26 default target. P7 D18 / P11 S4 swap it for the in-place RenewSheet. */
export const RENEW_HREF = "/pricing?reason=ended";

const listeners = new Set<() => void>();

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Blocked storage: the banner simply comes back on the next load.
  }
}

function readDismissed(): boolean {
  return readSession(DISMISS_KEY) === "1";
}

function setDismissed(dismissed: boolean): void {
  writeSession(DISMISS_KEY, dismissed ? "1" : null);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The banner state for a viewer. Older ShellUser producers set only `paymentFailed`, which means `banner`. */
export function paymentBannerState(user: ShellUser): PaymentIssueState | null {
  if (user.paymentIssueState !== undefined) return user.paymentIssueState;
  return user.paymentFailed ? "banner" : null;
}

/** V3PaymentFailed copy (plan §4.5). The date label is preformatted on the server in UTC. */
export function paymentBannerCopy(state: PaymentIssueState, dateLabel: string | null): string {
  switch (state) {
    case "banner":
      return dateLabel
        ? `Your last payment failed. You keep access until ${dateLabel}.`
        : "Your last payment failed. Update your card to keep access.";
    case "last_day":
      return dateLabel
        ? `Your last payment failed. Access ends ${dateLabel} unless the card is updated.`
        : "Your last payment failed. Access ends soon unless the card is updated.";
    case "expired":
      return `Your membership ended${dateLabel ? ` on ${dateLabel}` : ""} after the payment failed. Renew to get new reviews, puzzles and the coach back. Your saved games stay.`;
  }
}

/**
 * Shell banner rows (SPEC 8.2 ShellBanners; V3PaymentFailed, 1A·P7):
 * - `banner`: Update Payment + dismiss. Dismissing hides it for the session and raises an undo toast
 *   (`dismissed` state); Undo brings it back.
 * - `last_day`: Update Payment, no dismiss.
 * - `expired`: Renew Membership → /pricing?reason=ended. Real expired users are non-members and never see
 *   the shell under the B26 default, so only the demo user reaches it in P1.
 * The date label is preformatted on the server in UTC, so SSR and hydration agree in every time zone.
 */
export function ShellBanners({ user, demo = false }: { user: ShellUser; demo?: boolean }) {
  const router = useRouter();
  // Server snapshot: not dismissed. A dismissal hides the banner right after hydration.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
  const state = paymentBannerState(user);
  // Only the plain banner can be dismissed; last_day and expired always show.
  const visible = state === "banner" && dismissed ? null : state;

  useEffect(() => {
    if (!visible || demo || readSession(SHOWN_KEY) === visible) return;
    writeSession(SHOWN_KEY, visible);
    trackSystem("payment_banner_shown", { state: visible });
  }, [visible, demo]);

  if (!visible) return null;

  const onDismiss = () => {
    setDismissed(true);
    if (!demo) trackSystem("payment_banner_dismissed", {});
    notify.undo("Hidden for this session. Membership shows the payment issue.", {
      id: UNDO_TOAST_ID,
      onUndo: () => {
        setDismissed(false);
        if (!demo) trackSystem("payment_banner_undo", {});
      },
    });
  };

  const action =
    visible === "expired" ? (
      <Link
        href={RENEW_HREF}
        className={buttonVariants({ size: "sm", variant: "secondary" })}
        onClick={() => {
          if (!demo) trackSystem("payment_banner_cta", { state: visible });
        }}
      >
        Renew Membership
      </Link>
    ) : (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (demo) return;
          trackSystem("payment_banner_cta", { state: visible });
          openBillingPortal(() => router.refresh());
        }}
      >
        Update Payment
      </Button>
    );

  return (
    <Banner
      tone="warn"
      live="polite"
      layout="bar"
      data-testid="shell-payment-banner"
      // viewport.css hides it on game screens too short for both it and the 220px board.
      className="rc-shell-banner"
      action={action}
      onDismiss={visible === "banner" ? onDismiss : undefined}
    >
      {paymentBannerCopy(visible, user.paymentFailedUntilLabel)}
    </Banner>
  );
}
