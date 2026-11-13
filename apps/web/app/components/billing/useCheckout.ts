"use client";

// The legacy pricing page's checkout hook (phase-04 plan §3: "useCheckout stays as a thin facade for the legacy pricing
// page" until P11). Everything goes through `useStartCheckout()` (lib/api/mutations/billing.ts): POST /api/checkout
// with a `source` and an Idempotency-Key, the browser leaves for Dodo on success, and the return lands on
// `/checkout/activating`, which confirms the activation. This hook only keeps the old call shape and maps errors to a
// sentence for the pricing card.
import { useTheme } from "next-themes";
import type { CheckoutSource } from "@repo/contracts/http/billing";
import { ApiError } from "@/lib/api/errors";
import { useStartCheckout } from "@/lib/api/mutations/billing";
import { useUserStore } from "@/lib/stores";
import type { PlanKey } from "@/lib/billing/plans";

export type StartCheckoutOptions = {
  returnPath?: string;
  /** Default "pricing". The legacy onboarding page passes "onboarding". */
  source?: CheckoutSource;
};

/** The pricing card's sentence for a failed checkout start (null: no message, the hook handled it). */
export function checkoutErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return "Could not start checkout. Please try again.";
  switch (err.code) {
    case "already_subscribed":
    case "payment_update_required":
      return null;
    case "not_configured":
      return "This plan is not available right now.";
    case "upstream_unavailable":
      return "Checkout couldn't start. Try again in a moment.";
    case "rate_limited":
      return `Too many attempts. Try again in ${err.retryAfterSec ?? 30} seconds.`;
    default:
      return "Could not start checkout. Please try again.";
  }
}

export function useCheckout(): {
  startCheckout: (plan: PlanKey, options?: StartCheckoutOptions) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
} {
  const { resolvedTheme } = useTheme();
  const storeUser = useUserStore((s) => s.user);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);
  const mutation = useStartCheckout();

  async function startCheckout(plan: PlanKey, options?: StartCheckoutOptions) {
    if (!storeUser) {
      const next = `/onboarding?plan=${plan}`;
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(next)}`;
      return;
    }
    const theme = resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : "system";
    try {
      await mutation.mutateAsync({ plan, source: options?.source ?? "pricing", returnPath: options?.returnPath, theme });
    } catch (err) {
      // The store was stale: refresh it so the page switches to the subscriber view.
      if (err instanceof ApiError && err.code === "already_subscribed") await fetchSubscription();
    }
  }

  return {
    startCheckout,
    // Stays true after success: the browser is leaving for Dodo.
    loading: mutation.isPending || mutation.isSuccess,
    error: mutation.isError ? checkoutErrorMessage(mutation.error) : null,
    clearError: () => mutation.reset(),
  };
}
