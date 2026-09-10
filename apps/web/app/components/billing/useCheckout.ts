"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useUserStore } from "@/lib/stores";
import type { PlanKey } from "@/lib/billing/plans";

export function useCheckout(): {
  startCheckout: (plan: PlanKey, options?: { returnPath?: string }) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const storeUser = useUserStore((s) => s.user);
  const fetchSubscription = useUserStore((s) => s.fetchSubscription);

  async function startCheckout(plan: PlanKey, options?: { returnPath?: string }) {
    if (!storeUser) {
      const next = `/onboarding?plan=${plan}`;
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(next)}`;
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const theme =
        resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : "system";
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, returnPath: options?.returnPath, theme }),
      });
      const data: { checkoutUrl?: string; error?: unknown; code?: unknown } = await res
        .json()
        .catch(() => ({}));

      if (res.status === 409 && data.code === "already_subscribed") {
        // The store was stale: refresh it so callers switch to the
        // subscriber view.
        await fetchSubscription();
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : res.statusText);
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      throw new Error("Checkout did not return a payment link");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not start checkout. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return { startCheckout, loading, error, clearError: () => setError(null) };
}
