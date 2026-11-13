"use client";
// Connected-accounts mutations (phase-04 plan §5.2, §5.5, §5.8; api-perf AP-30). Every one renders its own errors
// (`meta.errorUi = "inline"`); sync also renders a 402 inline (`meta.paywall = "inline"`: "Importing starts when your
// trial begins."). 429s are never auto-retried (the screen shows a RetryCountdown from `retryAfterSec`).
//
//   useChessComLookup()        ACC-2 as a mutation: retry 0, a new submit aborts the previous one.
//   useLinkChessCom(context)   ACC-3 with an Idempotency-Key minted per mount and reused for retries of the same
//                              handle; on success sets accounts / me / imports, marks the archive stale and tells other
//                              tabs (BroadcastChannel "rc-sync").
//   useUnlinkAccount(p)        ACC-6, not optimistic (the screen confirms first).
//   useSyncAccount(p)          ACC-4, optimistic `syncing` (rolled back on error; 429 → `rate_limited` with the
//                              countdown; 409 sync_running keeps `syncing`).
//   useSetAutoImport(p)        ACC-5, optimistic toggle; sends the browser's zone when it differs from the stored one.
//   useCrossTabAccountsSync()  the listening side of "rc-sync".
import type {
  AccountsData,
  LinkContext,
  LinkData,
  LinkedAccountView,
  LookupData,
  ProviderSlug,
  RunView,
  SyncData,
  UnlinkData,
} from "@repo/contracts/http/accounts";
import {
  LinkData as LinkSchema,
  LinkedAccountView as AccountSchema,
  LookupData as LookupSchema,
  SyncData as SyncSchema,
  UnlinkData as UnlinkSchema,
} from "@repo/contracts/http/accounts";
import type { ImportStatusData } from "@repo/contracts/http/import";
import type { MeData } from "@repo/contracts/http/me";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { ApiError } from "../errors";
import { qk } from "../keys";

export const SYNC_CHANNEL = "rc-sync";
type SyncMessage = { type: "accounts" };

const providerPath = (path: string, provider: ProviderSlug) => path.replace("{provider}", encodeURIComponent(provider));

function broadcast(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    ch.postMessage({ type: "accounts" } satisfies SyncMessage);
    ch.close();
  } catch {
    // no BroadcastChannel (old Safari, workers): other tabs catch up on focus
  }
}

/** The browser's IANA zone, or null. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function lookupChessCom(username: string, signal?: AbortSignal): Promise<LookupData> {
  const { data } = await api(endpoints.accountLookup, {
    method: "POST",
    body: { username },
    signal,
    schema: process.env.NODE_ENV === "production" ? undefined : LookupSchema,
  });
  return data as LookupData;
}

export async function linkChessComRequest(body: { username: string; context: LinkContext }, idempotencyKey: string): Promise<LinkData> {
  const { data } = await api(endpoints.accountLinkChessCom, {
    method: "POST",
    body,
    idempotencyKey,
    schema: process.env.NODE_ENV === "production" ? undefined : LinkSchema,
  });
  return data as LinkData;
}

export async function syncAccountRequest(provider: ProviderSlug): Promise<SyncData> {
  const { data } = await api(providerPath(endpoints.accountSync, provider), {
    method: "POST",
    body: {},
    schema: process.env.NODE_ENV === "production" ? undefined : SyncSchema,
  });
  return data as SyncData;
}

export async function setAutoImportRequest(provider: ProviderSlug, body: { autoImport: boolean; timeZone?: string }): Promise<LinkedAccountView> {
  const { data } = await api(providerPath(endpoints.account, provider), {
    method: "PATCH",
    body,
    schema: process.env.NODE_ENV === "production" ? undefined : AccountSchema,
  });
  return data as LinkedAccountView;
}

export async function unlinkAccountRequest(provider: ProviderSlug, deleteGames: boolean): Promise<UnlinkData> {
  const { data } = await api(providerPath(endpoints.account, provider), {
    method: "DELETE",
    query: { deleteGames: deleteGames ? "1" : "0" },
    schema: process.env.NODE_ENV === "production" ? undefined : UnlinkSchema,
  });
  return data as UnlinkData;
}

// ── Cache writers (pure, exported for tests) ─────────────────────────────────────────────────────────────────────

export function upsertAccount(d: AccountsData | undefined, account: LinkedAccountView): AccountsData {
  const items = (d?.items ?? []).filter((a) => a.provider !== account.provider);
  items.push(account);
  items.sort((a, b) => (a.provider < b.provider ? -1 : 1));
  return { items };
}

export function removeAccount(d: AccountsData | undefined, provider: ProviderSlug): AccountsData | undefined {
  return d ? { items: d.items.filter((a) => a.provider !== provider) } : d;
}

export function patchAccount(d: AccountsData | undefined, provider: ProviderSlug, patch: Partial<LinkedAccountView>): AccountsData | undefined {
  return d ? { items: d.items.map((a) => (a.provider === provider ? { ...a, ...patch } : a)) } : d;
}

export function prependRun(d: ImportStatusData | undefined, run: RunView): ImportStatusData | undefined {
  if (!d) return d;
  return { ...d, runs: [run, ...d.runs.filter((r) => r.ref !== run.ref)].slice(0, 5) };
}

/** MeData after a link: the account summary, the run and the onboarding state the link returned. */
export function meAfterLink(me: MeData | undefined, link: LinkData): MeData | undefined {
  if (!me) return me;
  const summary = { provider: link.account.provider, username: link.account.username, status: link.account.status, lastSyncAt: link.account.lastSyncAt };
  const accounts = [...(me.accounts ?? []).filter((a) => a.provider !== summary.provider), summary];
  const run = link.run;
  return {
    ...me,
    accounts,
    ...(run ? { import: { ref: run.ref, provider: run.provider, status: run.status, phase: run.phase, imported: run.imported, total: run.total } } : {}),
    ...(link.onboarding ? { onboarding: link.onboarding } : {}),
  };
}

function applyLink(qc: QueryClient, link: LinkData): void {
  qc.setQueryData<AccountsData>(qk.accounts(), (d) => upsertAccount(d, link.account));
  qc.setQueryData<MeData>(qk.me(), (me) => meAfterLink(me, link));
  if (link.run) qc.setQueryData<ImportStatusData>(qk.imports(), (d) => prependRun(d, link.run!));
  void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
}

/** An empty queued run for the optimistic `syncing` row (replaced by the 202's run). */
export function optimisticRun(provider: ProviderSlug, nowIso: string): RunView {
  return {
    ref: "coptimistic0000000000000000",
    provider,
    trigger: "manual",
    status: "queued",
    phase: null,
    seen: 0,
    total: null,
    imported: 0,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: nowIso,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function useChessComLookup() {
  const inflight = useRef<AbortController | null>(null);
  useEffect(() => () => inflight.current?.abort(), []);
  return useMutation({
    mutationFn: (username: string) => {
      inflight.current?.abort();
      const ctl = new AbortController();
      inflight.current = ctl;
      return lookupChessCom(username, ctl.signal);
    },
    retry: 0,
    meta: { errorUi: "inline", object: "the Chess.com lookup" },
  });
}

/** Link a Chess.com handle. The Idempotency-Key is minted per mount and kept while the handle stays the same. */
export function useLinkChessCom(context: LinkContext) {
  const qc = useQueryClient();
  const [mountKey] = useState(() => globalThis.crypto.randomUUID());
  const keys = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: (username: string) => {
      const handle = username.trim().replace(/^@/, "").toLowerCase();
      let key = keys.current.get(handle);
      if (!key) {
        key = keys.current.size === 0 ? mountKey : globalThis.crypto.randomUUID();
        keys.current.set(handle, key);
      }
      return linkChessComRequest({ username, context }, key);
    },
    onSuccess: (link) => {
      applyLink(qc, link);
      broadcast();
    },
    retry: 0,
    meta: { errorUi: "inline", object: "the Chess.com link" },
  });
}

export function useUnlinkAccount(provider: ProviderSlug) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { deleteGames: boolean }) => unlinkAccountRequest(provider, input.deleteGames),
    onSuccess: () => {
      qc.setQueryData<AccountsData>(qk.accounts(), (d) => removeAccount(d, provider));
      qc.setQueryData<MeData>(qk.me(), (me) => (me ? { ...me, accounts: (me.accounts ?? []).filter((a) => a.provider !== provider) } : me));
      void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
      void qc.invalidateQueries({ queryKey: qk.imports(), refetchType: "none" });
      broadcast();
    },
    retry: 0,
    meta: { errorUi: "inline", object: "the disconnect" },
  });
}

export function useSyncAccount(provider: ProviderSlug) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncAccountRequest(provider),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.accounts(), exact: true });
      const previous = qc.getQueryData<AccountsData>(qk.accounts());
      const run = optimisticRun(provider, new Date().toISOString());
      qc.setQueryData<AccountsData>(qk.accounts(), (d) => patchAccount(d, provider, { status: "syncing", run }));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (err instanceof ApiError && err.code === "conflict" && err.reason === "sync_running") return; // stays syncing
      qc.setQueryData(qk.accounts(), context?.previous);
      if (err instanceof ApiError && err.code === "rate_limited" && err.retryAfterSec) {
        const until = new Date(Date.now() + err.retryAfterSec * 1000).toISOString();
        qc.setQueryData<AccountsData>(qk.accounts(), (d) => patchAccount(d, provider, { status: "rate_limited", nextAllowedSyncAt: until }));
      }
    },
    onSuccess: (data) => {
      qc.setQueryData<AccountsData>(qk.accounts(), (d) => patchAccount(d, provider, { status: "queued", run: data.run }));
      qc.setQueryData<ImportStatusData>(qk.imports(), (d) => prependRun(d, data.run));
    },
    retry: 0,
    meta: { errorUi: "inline", paywall: "inline", object: "the sync" },
  });
}

export function useSetAutoImport(provider: ProviderSlug) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoImport: boolean) => {
      const tz = browserTimeZone();
      const stored = qc.getQueryData<MeData>(qk.me())?.user.timeZone;
      return setAutoImportRequest(provider, { autoImport, ...(tz && tz !== stored ? { timeZone: tz } : {}) });
    },
    onMutate: async (autoImport) => {
      await qc.cancelQueries({ queryKey: qk.accounts(), exact: true });
      const previous = qc.getQueryData<AccountsData>(qk.accounts());
      qc.setQueryData<AccountsData>(qk.accounts(), (d) => patchAccount(d, provider, { autoImport }));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      qc.setQueryData(qk.accounts(), context?.previous);
    },
    onSuccess: (account) => {
      qc.setQueryData<AccountsData>(qk.accounts(), (d) => upsertAccount(d, account));
      const tz = browserTimeZone();
      if (tz) qc.setQueryData<MeData>(qk.me(), (me) => (me ? { ...me, user: { ...me.user, timeZone: tz } } : me));
      broadcast();
    },
    retry: 0,
    meta: { errorUi: "inline", object: "the setting" },
  });
}

/** Other tabs re-read the account caches after a link, unlink or settings change in this one. */
export function useCrossTabAccountsSync(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(SYNC_CHANNEL);
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      if (e.data?.type !== "accounts") return;
      void qc.invalidateQueries({ queryKey: qk.accounts(), exact: true });
      void qc.invalidateQueries({ queryKey: qk.me(), exact: true });
      void qc.invalidateQueries({ queryKey: qk.imports(), exact: true });
    };
    return () => ch.close();
  }, [qc]);
}
