"use client";
// Import retry (phase-04 plan §5.2 `useRetryImport`, §7.4 ACC-8). Optimistic: the run shows `queued` at once and rolls
// back on error. Member only: a 402 renders inline (`meta.paywall = "inline"`); 409 `not_failed` / `sync_running` and
// 429 are rendered by the screen (`meta.errorUi = "inline"`).
import type { RetryImportData } from "@repo/contracts/http/import";
import { RetryImportData as RetrySchema } from "@repo/contracts/http/import";
import type { ImportStatusData } from "@repo/contracts/http/import";
import type { AccountsData } from "@repo/contracts/http/accounts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export async function retryImportRequest(ref: string): Promise<RetryImportData> {
  const { data } = await api(endpoints.importRetry.replace("{ref}", encodeURIComponent(ref)), {
    method: "POST",
    body: {},
    schema: process.env.NODE_ENV === "production" ? undefined : RetrySchema,
  });
  return data as RetryImportData;
}

/** The status cache with one run marked queued (error cleared). */
export function markRunQueued(d: ImportStatusData | undefined, ref: string): ImportStatusData | undefined {
  if (!d) return d;
  return { ...d, runs: d.runs.map((r) => (r.ref === ref ? { ...r, status: "queued" as const, trigger: "retry" as const, error: null } : r)) };
}

export function useRetryImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) => retryImportRequest(ref),
    onMutate: async (ref) => {
      await qc.cancelQueries({ queryKey: qk.imports(), exact: true });
      const previous = qc.getQueryData<ImportStatusData>(qk.imports());
      qc.setQueryData<ImportStatusData>(qk.imports(), (d) => markRunQueued(d, ref));
      return { previous };
    },
    onError: (_err, _ref, context) => {
      qc.setQueryData(qk.imports(), context?.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData<ImportStatusData>(qk.imports(), (d) => (d ? { ...d, runs: d.runs.map((r) => (r.ref === data.run.ref ? data.run : r)) } : d));
      qc.setQueryData<AccountsData>(qk.accounts(), (d) =>
        d ? { items: d.items.map((a) => (a.run?.ref === data.run.ref ? { ...a, run: data.run, status: "queued" as const, lastError: null } : a)) } : d,
      );
    },
    retry: 0,
    meta: { errorUi: "inline", paywall: "inline", object: "the import retry" },
  });
}
