// The activation query (phase-04 plan 5.2, 5.3, 8.5): `qk.billing.activation(key)` → GET /api/billing/activation.
// `key` = subscription_id ?? session_id ?? "latest" (the RSC page seeds the same key with getActivation(..., {dodo:
// false})). staleTime 0, never retried by TanStack (the poller simply waits for its next tick, plan 5.8). The path is
// typed against the contracts registry, like lib/api/endpoints.ts.
import { ActivationData, type ActivationQuery } from "@repo/contracts/http/billing";
import type { EndpointById } from "@repo/contracts/http/registry";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../client";
import { qk } from "../keys";

export const ACTIVATION_PATH: EndpointById<"billing.activation">["path"] = "/api/billing/activation";

/** The cache key of one activation wait. */
export function activationKeyOf(params: Pick<ActivationQuery, "subscription_id" | "session_id">): string {
  return params.subscription_id || params.session_id || "latest";
}

/** The query string the server reads (status is a client hint the server ignores for decisions). */
export function activationParams(params: ActivationQuery): Record<string, string | undefined> {
  return { subscription_id: params.subscription_id, session_id: params.session_id, status: params.status, force: params.force };
}

export async function fetchActivation(params: ActivationQuery, signal?: AbortSignal): Promise<ActivationData> {
  // devSchema written inline: only then does webpack drop the contract (and zod) from production chunks.
  const schema = process.env.NODE_ENV === "production" ? undefined : ActivationData;
  const { data } = await api(ACTIVATION_PATH, { schema, signal, query: activationParams(params) });
  return data;
}

export function activationQuery(params: ActivationQuery) {
  return queryOptions({
    queryKey: qk.billing.activation(activationKeyOf(params)),
    queryFn: ({ signal }) => fetchActivation(params, signal),
    staleTime: 0,
    retry: false,
    meta: { object: "your membership" },
  });
}
