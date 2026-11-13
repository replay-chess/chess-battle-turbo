"use client";

// /settings/connected, wired (phase-04 plan §4.10, §5.2–§5.8). The RSC seeds `qk.accounts()` (listLinkedAccounts);
// this screen reads it through WP-C's hooks and renders ConnectedPanel.
//
// - Reads: useLinkedAccounts() (socket-first; the HTTP fallback polls only while a sync runs and the socket is down),
//   useImportProgress() (the `import:*` events patch the caches; the "user" hold keeps the socket up), and the
//   cross-tab "rc-sync" channel.
// - Writes: link (`context: "settings"`, Idempotency-Key per mount), sync (optimistic `syncing`), the daily-import
//   switch (optimistic), unlink (after the inline confirm). Errors render inline (`meta.errorUi = "inline"`); a 402
//   on sync renders "Importing starts when your trial begins." (`meta.paywall = "inline"`).
// - `?lichess=linked|denied|error[&reason=]` from the OAuth callback is consumed once and removed with replaceState.
// - Toasts: "Sync finished · N new games" (socket `import:finished`, or a polled run that turned done), "Lichess
//   linked · importing N games", "<Provider> disconnected. …"; "SAVED · SYNCED" for 2.6 s after a settings write.
import { useEffect, useRef, useState } from "react";
import type { AccountsData, LinkedAccountView } from "@repo/contracts/http/accounts";
import { CHESSCOM_USERNAME_RE, type ProviderSlug } from "@repo/contracts/http/p04-plain";
import type { ImportFinishedEvent } from "@repo/contracts/socket/user";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { notify } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/errors";
import {
  useCrossTabAccountsSync,
  useLinkChessCom,
  useSetAutoImport,
  useSyncAccount,
  useUnlinkAccount,
} from "@/lib/api/mutations/accounts";
import { useMe } from "@/lib/api/queries/me";
import { useLinkedAccounts } from "@/lib/api/queries/accounts";
import { useImportProgress } from "@/lib/realtime/useImportProgress";
import { AUTO_IMPORT_FAILED, DISCONNECT_FAILED, disconnectedToast, lichessLinkedToast, syncFinishedToast } from "./copy";
import { ConnectedPanel } from "./ConnectedPanel";
import { linkErrorOf, syncErrorOf } from "./errors";
import type { LichessReturn } from "./LichessConnect";
import { lichessReturnOf, lichessStartHref, withoutLichessParams, type LichessParam } from "./lichess-return";
import { SAVED_FLASH_MS, isSyncingView, panelModels } from "./model";
import { trackAccounts } from "./telemetry";
import { useNow } from "./useNow";

function accountOf(d: AccountsData | undefined, provider: ProviderSlug): LinkedAccountView | null {
  return d?.items.find((a) => a.provider === provider) ?? null;
}

export function ConnectedScreen({ serverNowMs, lichessParam }: { serverNowMs: number; lichessParam: LichessParam }) {
  const accounts = useLinkedAccounts();
  useCrossTabAccountsSync();
  const profileRef = useMe((m) => m.user.ref).data ?? null;

  const chesscom = accountOf(accounts.data, "chesscom");
  const lichess = accountOf(accounts.data, "lichess");

  // ── Saved flash ────────────────────────────────────────────────────────────────────────────────────────────────
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [savedAt]);
  const flashSaved = () => setSavedAt(Date.now());

  // ── The OAuth return, consumed once ────────────────────────────────────────────────────────────────────────────
  const [initialReturn] = useState(() => lichessReturnOf(lichessParam));
  const [liReturned, setLiReturned] = useState<LichessReturn>(initialReturn.returned);
  const [liJustLinked, setLiJustLinked] = useState(initialReturn.linked);
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    if (lichessParam.lichess === null) return;
    window.history.replaceState(null, "", withoutLichessParams(window.location.href));
    if (initialReturn.linked) {
      const li = accountOf(accounts.data, "lichess");
      notify.success(lichessLinkedToast(li ? (li.run?.total ?? li.totalRatedGames) : null));
      flashSaved();
    } else if (initialReturn.returned?.kind === "denied") {
      trackAccounts("lichess_oauth_denied", { context: "settings" });
    }
    // The return is read once, from the first render's data.
  }, [lichessParam.lichess, initialReturn, accounts.data]);

  // ── Lichess connect (a full navigation) ───────────────────────────────────────────────────────────────────────
  const [liConnecting, setLiConnecting] = useState(false);
  useEffect(() => {
    // Back from lichess.org through the bfcache: the page is restored with the button still waiting.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLiConnecting(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const connectLichess = () => {
    if (liConnecting) return;
    trackAccounts("account_link_started", { provider: "lichess", context: "settings" });
    setLiReturned(null);
    setLiConnecting(true);
    window.location.assign(lichessStartHref());
  };

  // ── Chess.com link ─────────────────────────────────────────────────────────────────────────────────────────────
  const link = useLinkChessCom("settings");
  const linkCountdown = useRetryCountdown(link, { routeId: "accounts.chesscom.link" });
  const [ccInput, setCcInput] = useState("");
  const [typed, setTyped] = useState("");
  const [ccInvalid, setCcInvalid] = useState(false);
  const linkError = linkErrorOf(link.error);
  const ccError =
    ccInvalid
      ? ({ kind: "invalid", typed } as const)
      : linkError && linkError !== "rate_limited"
        ? ({ kind: linkError, typed } as const)
        : null;
  const submitChessCom = () => {
    if (linkCountdown.limited || link.isPending) return;
    const handle = ccInput.trim().replace(/^@/, "");
    setTyped(handle);
    if (!CHESSCOM_USERNAME_RE.test(handle)) {
      setCcInvalid(true);
      return;
    }
    setCcInvalid(false);
    trackAccounts("account_link_started", { provider: "chesscom", context: "settings" });
    link.mutate(handle, {
      onSuccess: () => {
        setCcInput("");
        flashSaved();
      },
    });
  };

  // ── Per-provider writes ────────────────────────────────────────────────────────────────────────────────────────
  const ccSync = useSyncAccount("chesscom");
  const liSync = useSyncAccount("lichess");
  const ccAuto = useSetAutoImport("chesscom");
  const liAuto = useSetAutoImport("lichess");
  const ccUnlink = useUnlinkAccount("chesscom");
  const liUnlink = useUnlinkAccount("lichess");
  const syncOf = { chesscom: ccSync, lichess: liSync };
  const autoOf = { chesscom: ccAuto, lichess: liAuto };
  const unlinkOf = { chesscom: ccUnlink, lichess: liUnlink };

  const sync = (provider: ProviderSlug) => {
    trackAccounts("account_sync_requested", { provider });
    syncOf[provider].mutate(undefined, {
      onError: (err) => {
        if (isApiError(err) && err.code === "rate_limited") trackAccounts("account_sync_rate_limited", { provider });
      },
    });
  };

  const setAutoImport = (provider: ProviderSlug, on: boolean) => {
    trackAccounts("account_autoimport_toggled", { provider, is_on: on });
    autoOf[provider].mutate(on, {
      onSuccess: flashSaved,
      onError: () => notify.error(AUTO_IMPORT_FAILED),
    });
  };

  const [confirmOpen, setConfirmOpen] = useState<ProviderSlug | null>(null);
  const disconnect = (provider: ProviderSlug, deleteGames: boolean) => {
    trackAccounts("account_unlink_confirmed", { provider, has_delete_games: deleteGames });
    unlinkOf[provider].mutate(
      { deleteGames },
      {
        onSuccess: () => {
          setConfirmOpen(null);
          if (provider === "lichess") setLiJustLinked(false);
          notify.success(disconnectedToast(provider, deleteGames));
          flashSaved();
        },
      },
    );
  };
  const disconnectPending: ProviderSlug | null = ccUnlink.isPending ? "chesscom" : liUnlink.isPending ? "lichess" : null;
  const disconnectError =
    confirmOpen && unlinkOf[confirmOpen].isError ? { provider: confirmOpen, message: DISCONNECT_FAILED } : null;

  // ── Import events and "Sync finished" ─────────────────────────────────────────────────────────────────────────
  const toasted = useRef(new Set<string>());
  useImportProgress({
    onEvent: (name, payload) => {
      if (name !== "import:finished" || toasted.current.has(payload.runRef)) return;
      toasted.current.add(payload.runRef);
      notify.success(syncFinishedToast((payload as ImportFinishedEvent).newGames), { id: `sync-${payload.runRef}` });
    },
  });

  const syncPending = { chesscom: ccSync.isPending, lichess: liSync.isPending };
  const syncError = { chesscom: syncErrorOf(ccSync.error), lichess: syncErrorOf(liSync.error) };
  const cc = {
    input: ccInput,
    onInput: (value: string) => {
      setCcInput(value);
      setCcInvalid(false);
      if (link.isError) link.reset();
    },
    onSubmit: submitChessCom,
    looking: link.isPending,
    error: ccError,
    countdown: linkCountdown,
  };
  const li = { connecting: liConnecting, returned: liReturned, justLinked: liJustLinked, onConnect: connectLichess };

  // The clock ticks every second while a countdown or a sync is on screen.
  const preview = panelModels({ nowMs: serverNowMs, chesscom, lichess, syncPending, cc, li });
  const fast = isSyncingView(preview.chesscom) || isSyncingView(preview.lichess) || [preview.chesscom, preview.lichess].some((c) => c.linked && c.view === "rate_limited");
  const nowMs = useNow(serverNowMs, fast);
  const models = panelModels({ nowMs, chesscom, lichess, syncPending, cc, li });

  // A polled run that turned done (socket down): the same toast, once per run.
  const lastSyncing = useRef<Record<ProviderSlug, string | null>>({ chesscom: null, lichess: null });
  useEffect(() => {
    for (const [provider, model, account] of [
      ["chesscom", models.chesscom, chesscom],
      ["lichess", models.lichess, lichess],
    ] as const) {
      const run = account?.run ?? null;
      const syncingNow = isSyncingView(model);
      const was = lastSyncing.current[provider];
      if (syncingNow && run) lastSyncing.current[provider] = run.ref;
      else if (!syncingNow) {
        if (was && run && run.ref === was && run.status === "done" && !toasted.current.has(run.ref)) {
          toasted.current.add(run.ref);
          notify.success(syncFinishedToast(run.imported), { id: `sync-${run.ref}` });
        }
        lastSyncing.current[provider] = null;
      }
    }
  }, [models.chesscom, models.lichess, chesscom, lichess]);

  // `settings_connected_viewed` once, with the state the page opened in.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !accounts.data) return;
    viewed.current = true;
    trackAccounts("settings_connected_viewed", { state: models.state });
  }, [accounts.data, models.state]);

  return (
    <ConnectedPanel
      nowMs={nowMs}
      chesscom={chesscom}
      lichess={lichess}
      saved={savedAt !== null}
      profileHref={profileRef ? `/profile/${profileRef}` : null}
      cc={cc}
      li={li}
      syncPending={syncPending}
      syncError={syncError}
      onSync={sync}
      onAutoImport={setAutoImport}
      confirmOpen={confirmOpen}
      onConfirmOpen={(p) => {
        setConfirmOpen(p);
        if (p) unlinkOf[p].reset();
      }}
      disconnectPending={disconnectPending}
      disconnectError={disconnectError}
      onDisconnect={disconnect}
    />
  );
}
