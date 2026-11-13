"use client";
// Checkout start (phase-04 plan 5.2 `useStartCheckout`, 7.5.1). POST /api/checkout with an Idempotency-Key per
// (plan, page view): a double click or a retry replays the same checkout URL. Not optimistic. On success the browser
// leaves for Dodo's hosted page; when the user comes Back from Dodo, the page may be restored from the bfcache with a
// spinning button, so a `pageshow` with `persisted` resets the mutation (and keeps the key, so a second Start replays
// the session that already exists). Errors are rendered by the caller (`meta.errorUi = "inline"`):
//   409 already_subscribed → the viewer is refetched; 402 payment_update_required → the billing portal;
//   503 not_configured / 502 upstream_unavailable / 429 rate_limited → inline.
import { CheckoutData, type CheckoutBody } from "@repo/contracts/http/billing";
import type { EndpointById } from "@repo/contracts/http/registry";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { trackBilling } from "@/lib/billing/telemetry";
import { api } from "../client";
import { ApiError } from "../errors";
import { qk } from "../keys";

export const CHECKOUT_PATH: EndpointById<"billing.checkout">["path"] = "/api/checkout";

export async function postCheckout(body: CheckoutBody, idempotencyKey: string): Promise<CheckoutData> {
  // devSchema written inline: only then does webpack drop the contract (and zod) from production chunks.
  const schema = process.env.NODE_ENV === "production" ? undefined : CheckoutData;
  const { data } = await api(CHECKOUT_PATH, { method: "POST", body, idempotencyKey, schema });
  return data;
}

/** One Idempotency-Key per (plan, source, returnPath) for the life of the page view. */
export function checkoutKeyName(body: Pick<CheckoutBody, "plan" | "source" | "returnPath">): string {
  return `${body.plan}|${body.source}|${body.returnPath ?? ""}`;
}

export type StartCheckoutOptions = {
  /** Default true: `window.location.assign(checkoutUrl)` on success. */
  navigate?: boolean;
};

export function useStartCheckout(options: StartCheckoutOptions = {}) {
  const qc = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const navigate = options.navigate ?? true;

  const mutation = useMutation({
    mutationKey: ["billing", "checkout"],
    meta: { errorUi: "inline" },
    mutationFn: (body: CheckoutBody) => {
      const name = checkoutKeyName(body);
      let key = keys.current.get(name);
      if (!key) {
        key = globalThis.crypto.randomUUID();
        keys.current.set(name, key);
      }
      return postCheckout(body, key);
    },
    onSuccess: (data, body) => {
      trackBilling("checkout_started", { source: body.source, plan: body.plan, is_trial: data.trial });
      if (navigate && typeof window !== "undefined") window.location.assign(data.checkoutUrl);
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : "network";
      trackBilling("checkout_start_failed", { code });
      if (err instanceof ApiError && err.code === "already_subscribed") void qc.invalidateQueries({ queryKey: qk.me() });
      if (err instanceof ApiError && err.code === "payment_update_required" && typeof window !== "undefined") {
        window.location.assign("/api/customer-portal");
      }
    },
  });

  const { reset } = mutation;
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [reset]);

  return mutation;
}
